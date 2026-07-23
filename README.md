# sync

*schedule your next call*

sync is an anonymous group meeting scheduler. One person creates an event, shares one URL, everyone paints when they are free on a grid, sync ranks the windows where the most people can meet, the organizer picks one, and everyone gets calendar links to add it.

No accounts. No emails. Access control is capability-based: unguessable tokens in URLs. The frontend is a static SPA on GitHub Pages; shared state lives in Supabase behind row-level security. See `SECURITY.md` for exactly what that protects and what it does not.

## Setup

Follow these steps in order.

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is fine).
2. **Run the schema.** Open the SQL editor in your Supabase dashboard, paste the entire contents of `supabase/schema.sql`, and run it once. It is idempotent — running it again is safe.
3. **Copy the URL and anon key into GitHub repo secrets.** In Supabase: Settings → API. In GitHub: repo → Settings → Secrets and variables → Actions → New repository secret. Create:
   - `VITE_SUPABASE_URL` — the project URL
   - `VITE_SUPABASE_ANON_KEY` — the `anon` `public` key (this key is public by design; RLS is the security boundary)
4. **Enable Pages.** Repo → Settings → Pages → Source: **GitHub Actions**.
5. **Push to `main`.** The committed workflow builds and deploys automatically. Your app is at `https://<user>.github.io/<repo>/`.

For local development:

```sh
cp .env.example .env   # fill in the Supabase values
npm ci
npm run dev
```

`npm test` runs the slot-resolver unit tests (DST, day-shift badges, ranking). `npm run build` typechecks (`strict: true`) and builds.

## Optional: calendar import

Everything above ships without this. If the client IDs below are not configured, the import buttons simply do not render and the app works exactly as it does today.

Calendar import is read-only OAuth that pre-fills a participant's grid from their busy times. Tokens never leave the browser; only derived slot indices are stored. Google and Microsoft only.

### Google

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and an **OAuth client ID** of type **Web application**.
2. Add your Pages URL (e.g. `https://<user>.github.io`) as an **authorized JavaScript origin**. No redirect URI is needed (popup token flow).
3. On the OAuth consent screen, add the scope `https://www.googleapis.com/auth/calendar.freebusy` — the narrowest scope that exists for this job; it returns busy intervals only, never titles or attendees.
4. Add the client ID as the repo secret `VITE_GOOGLE_CLIENT_ID` and redeploy.

Note: users will see Google's **unverified app** interstitial until the app completes sensitive-scope verification. That is expected; the app works through it.

### Microsoft

1. In [Microsoft Entra admin center](https://entra.microsoft.com), register an application. Supported account types: **accounts in any organizational directory and personal Microsoft accounts** (multi-tenant).
2. Add a **Single-page application** platform with your Pages URL as the redirect URI.
3. API permissions: Microsoft Graph → Delegated → `Calendars.ReadBasic` (event times without subject or body).
4. Add the application (client) ID as the repo secret `VITE_MS_CLIENT_ID` and redeploy.

## Renaming the repo

`vite.config.ts` reads the repo name from `GITHUB_REPOSITORY` in CI, so renaming the repo requires no code changes. If you rename, update the Google JavaScript origin and Entra redirect URI only if your Pages URL changed.
