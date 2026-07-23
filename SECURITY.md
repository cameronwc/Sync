# Security model

sync has no accounts, no passwords, and no login screen. This document explains
what actually stands between "anyone with a URL" and your event data, so you
can decide whether to trust it with a real meeting.

## The short version

sync is a static single-page app hosted on GitHub Pages. It talks straight to
Supabase (hosted Postgres + PostgREST) using the public `anon` API key —
the same key ships to every visitor's browser and is not a secret. There is
no server-side application code, no session cookies, and no concept of "the
logged-in user." Every permission decision — who can read what, who can
write what — is enforced entirely by the database itself, through Postgres
row-level security, table grants, and a small set of `security definer`
functions that validate everything the client sends.

In place of accounts, sync uses **capability tokens**: long random strings
embedded in a URL or held in your browser's local storage. Possessing the
token *is* the permission. There's no way to prove you're "really" the
organizer beyond holding the admin token, and no way to recover access if
you lose one. This is a deliberate, load-bearing tradeoff in exchange for
zero signup friction — treat sync links the way you'd treat a Google Doc
"anyone with the link can edit" share, not the way you'd treat a bank login.

## The tokens, what they guard, and how strong they are

| Token | Length / alphabet | Entropy | Lives in | Grants |
|---|---|---|---|---|
| **slug** | 16 chars, base58 | ~93 bits | The event URL | Read the event and its participants; join as a new participant; submit/update your own availability |
| **admin\_token** | 32 chars, base58 | ~187 bits | The organizer's URL only, generated server-side, never echoed by any read path | Everything the slug grants, plus finalize/unfinalize the meeting time |
| **edit\_token** | 32 chars, base58 | ~187 bits | Your browser's local storage, generated server-side when you join | Overwrite *your own* availability row, and nothing else |
| **room\_code** | 8 chars, Crockford base32 | 40 bits | Shared verbally or typed in by hand | Resolves to a slug — nothing more (see below) |

Base58 here is the standard Bitcoin-style alphabet (digits and letters minus
`0`, `O`, `I`, `l` — the visually ambiguous ones), so every character a
person actually has to read or type is unambiguous. All three long tokens
are generated **inside** the database with Postgres's own cryptographic
random source (`gen_random_uuid()`), using rejection sampling so the
mapping from random bytes to base58 characters is unbiased — never `Math.random()`,
never generated in the browser, never predictable from anything else about
the event.

At 93 and 187 bits, the slug and both secret tokens are not brute-forceable
by any realistic attacker — you'd need control of botnets orders of
magnitude larger than exist today, running for longer than the sun will
last, to have a meaningful chance of guessing one. The practical risk with
these tokens isn't cracking them; it's them leaking — pasted into the wrong
Slack channel, screenshotted, logged by an overzealous browser extension.
Treat a sync link exactly as sensitive as its contents deserve.

## The anon key is not a secret, and that's fine

The Supabase `anon` key embedded in the built app is public by design — it
identifies "this is a client of the sync project," not "this is an
authorized user." Anyone can extract it from the page source and call the
same Postgres RPC functions directly with `curl`, bypassing the UI entirely.
This does not weaken anything: the RPC functions themselves re-validate
every input and re-check every token, so a hand-crafted request is
constrained exactly the same way a browser request is. The security
boundary is **inside Postgres** — row-level security, table grants, and the
functions — not in the JavaScript.

Concretely: the `events` and `participants` tables have `select`/`insert`/
`update`/`delete` revoked from both the `anon` and `authenticated` roles, and
row-level security is turned on with **zero policies**, so even if a grant
were ever accidentally reinstated, RLS would still block every row. Event
data is projected through two narrow internal views (`events_public`,
`participants_public`) that omit `admin_token` and `edit_token` respectively
— but the views themselves are **not** readable by anon either. A blanket
`select` grant on a view is all-or-nothing across every row, which would
have let anyone with the anon key list every event, slug, and room code on
the instance with one unfiltered PostgREST query. Instead, the only read
paths are two parameterized `security definer` functions, `get_event(slug)`
and `get_participants(slug)`: you must already hold the slug capability to
read anything at all. The only way to write anything is through six more
`security definer` functions that run as the table owner — bypassing RLS by
design, but only after validating the request and checking the caller's
token — with every parameter checked server-side regardless of what the
client-side form validation already did.

## What each token can and can't do

- **Holding just the slug** (the normal event link): you can see the event's
  title, organizer, time window, and every participant's submitted
  availability; you can add yourself as a new participant. You cannot see
  the admin token, cannot see anyone else's edit token, cannot finalize the
  meeting, and cannot modify or delete another participant's row.
- **Holding an edit\_token**: you can overwrite the availability slots for
  the one participant row it was issued for. It does nothing for any other
  participant, and does nothing administrative.
- **Holding the admin\_token**: everything above, plus locking in
  (`finalize_event`) or reopening (`unfinalize_event`) the final meeting
  time. It is generated once at event creation, shown once, and never
  appears in any subsequent read — if the organizer loses it, there is no
  recovery path (create a new event). Note that the organizer link carries
  this token in the URL fragment: it briefly appears in the address bar
  before the app moves it to `localStorage` and strips it from the URL.
  The fragment is never sent to any server, but treat the organizer link
  like a password — anyone who sees it (screen share, synced browser
  history) holds organizer control.
- **Holding neither** (a random stranger with no link at all): nothing.
  There's no way to list events, browse slugs, or discover that an event
  exists without either the slug or a valid room code.

All token comparisons in the database use hashed comparison
(`md5(stored) = md5(supplied)`) rather than a raw string `=`. A raw
comparison short-circuits on the first mismatched byte, so its timing can
theoretically leak how many leading characters an attacker has already
guessed correctly; hashing both sides first removes that signal. `md5()` is
used purely as a fixed-length comparison here, not for any cryptographic
property — it's built into core Postgres with no extension required.

## The room-code tradeoff — read this if you're relying on codes

The slug (93 bits) is deliberately, enormously strong. The **room code**
exists purely for the "someone reads eight characters out loud in a
meeting" case, and it makes a real, explicit tradeoff to stay short enough
to read aloud: 8 characters of Crockford base32 is **40 bits of entropy —
about 1 trillion possible combinations, roughly 8 billion times weaker than
the slug.**

The function that turns a room code into an event, `resolve_room_code`, is
callable by anyone holding the (public, non-secret) anon key — which is
everyone — and is therefore an **enumeration oracle**: nothing stops a
script from trying codes in a loop looking for a hit. Three things bound
that risk:

1. **Unbiased generation.** Every code is 8 bytes of Postgres's random
   source mapped onto the 32-symbol Crockford alphabet with zero modulo
   bias (`256 / 32` divides evenly, so no rejection sampling is even needed
   here — unlike the base58 tokens above). No code is more guessable than
   any other.
2. **A fixed, unconditional 300ms delay** at the very top of
   `resolve_room_code`, before any lookup happens, on every call — hit,
   miss, or malformed input alike. This caps a realistic guessing rate at a
   few requests per second per connection and, just as importantly, means
   response timing itself never distinguishes "found it" from "no such
   code" from "you typo'd it."
3. **A 14-day expiry, measured from the event's `week_start`.** A room code
   only resolves while `week_start + 14 days >= today`; the moment that
   window closes, `resolve_room_code` returns null for it forever, shrinking
   the pool of live targets to whatever's scheduled in the current and
   upcoming weeks. **The slug link itself has no expiry and keeps working
   indefinitely** — only the short-code shortcut times out.

Even a successful guess is bounded in what it hands over: it resolves to a
slug and nothing else — never the title, organizer, participant count, or
any other detail, so a near-miss teaches an attacker nothing. From there,
whoever guessed it is in exactly the same position as anyone else who has
the slug: they can view the event and add themselves as a participant, but
they cannot finalize the meeting or touch anyone else's availability. Worst
case for a guessed room code is an uninvited guest seeing the event and
adding a row to the participant list — not a takeover.

If that residual risk matters for a specific event (something sensitive
enough that an uninvited viewer is unacceptable), don't rely on the room
code for it — share the slug link directly instead, and let the code lapse
after the two-week window.

## No accounts means anyone with a link is a legitimate participant

There's no identity layer beneath any of this. sync doesn't know or care
who "Alice" is beyond the fact that someone typed that name in while holding
a valid slug. If you forward an event link to someone, they are — by
design — now exactly as capable as everyone else who has it. There's no
admin approval step for new participants, and participant names are
free-text with no uniqueness check. Don't forward a scheduling link
anywhere you wouldn't want an uninvited person turning up in the attendee
list.

## Calendar integration never touches the server

If you connect a Google or Microsoft calendar to see your own conflicts
overlaid on the grid, that OAuth flow runs entirely in your browser via a
popup, and the resulting access token never leaves it — it is never sent to
Supabase, never logged, never stored anywhere sync controls. The busy/free
intervals fetched with that token are used to shade the grid client-side and
are discarded once the tab closes; they are never written to the database.
The only thing that ever reaches the server is the slot indices you
explicitly submit as your availability.

## Tokens are stored in plaintext today

`admin_token` and `edit_token` are stored as plain text in the `events` and
`participants` tables in this version of the schema. They're never exposed
through any read path available to a client — the public views omit them
entirely, and the only queries that ever touch those columns are the
security-definer functions running as the table owner — so a client-side
bug or a malicious request can't extract them. But a direct database
compromise (a leaked service-role key, a stolen backup, an insider with
console access) would expose every live admin and edit token outright. That
would be bad: whoever obtained them could finalize events, wipe out
participant availability, or add themselves everywhere.

Hashing these tokens at rest — so that even a raw database dump wouldn't
hand out working credentials — is the intended v2 hardening step, deferred
out of this version to keep the schema and the RPC layer simple for launch.

## Why 60 participants

Every `join_event` call is validated against a hard cap of 60 participants
per event, enforced with a row lock on the event (`select ... for update`)
so two people joining at the exact same instant can't both slip in over the
limit. This isn't a product decision about meeting size — it's an abuse
guard. Supabase's free tier has finite database storage and request budget;
without a cap, a single link posted somewhere public (or hit by an
automated script) could let one event balloon into thousands of rows and
exhaust the project's quota for every other event sharing it. 60 is
generous for any real meeting and cheap enough that even a determined,
manually-driven abuser gains very little for the effort.
