-- sync database schema
--
-- Zero-auth anonymous scheduler. Postgres + PostgREST via Supabase, accessed
-- directly from the browser with the public anon key. There is no user
-- session, ever — every "who can do what" question is answered entirely by
-- this file: table grants, row level security, and security-definer RPC
-- functions that validate everything themselves because the client cannot
-- be trusted with anything.
--
-- IDEMPOTENCY: this file is written to be pasted into the Supabase SQL
-- editor and re-run from top to bottom any number of times, on a fresh
-- project or an existing one, without erroring and without losing data.
--   - tables: `create table if not exists` — we NEVER drop a table here.
--   - indexes: `create index if not exists <name>` (named, so the
--     existence check actually works).
--   - views/functions: `drop ... if exists` immediately before
--     `create`, since `create or replace` cannot change a view's column
--     list or a function's parameter names/types, and this file's
--     functions may evolve those over time.
--   - grants/revokes/RLS toggles: all idempotent by nature in Postgres.
--
-- Randomness: `gen_random_uuid()` has been built into core Postgres since
-- v13 (no longer requires pgcrypto), and every Supabase project runs a
-- version well past that, so no `create extension` is needed anywhere in
-- this file.

-- =============================================================================
-- TABLES
-- =============================================================================

create table if not exists events (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,          -- 16 chars, base58, generated client-side
  room_code         text unique not null,          -- 8 chars, Crockford base32, generated in create_event
  admin_token       text not null,                 -- 32 chars, base58, never exposed via public read
  title             text not null,
  organizer_name    text not null,
  event_tz          text not null,                 -- IANA
  week_start        date not null,                 -- Monday of the target week
  duration_minutes  int  not null check (duration_minutes between 15 and 480),
  slot_minutes      int  not null default 30 check (slot_minutes in (15, 30, 60)),
  day_start_min     int  not null default 480,
  day_end_min       int  not null default 1080,
  days_enabled      int[] not null default '{0,1,2,3,4}',  -- 0 = Monday
  finalized_start   timestamptz,
  created_at        timestamptz not null default now()
);

create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  edit_token  text not null,                       -- 32 chars, base58, generated in join_event
  name        text not null check (length(name) between 1 and 60),
  viewer_tz   text not null,
  slots       int[] not null default '{}',
  updated_at  timestamptz not null default now()
);

create index if not exists participants_event_id_idx on participants (event_id);

-- =============================================================================
-- LOCK DOWN THE BASE TABLES
-- =============================================================================
--
-- Belt and suspenders: even if a grant ever slipped through, RLS with zero
-- policies blocks every row for every non-superuser role, on both tables,
-- unconditionally. The only way in is through the security-definer
-- functions below, which run as the table owner and therefore bypass RLS
-- entirely by design.

revoke all on events, participants from anon, authenticated;

-- Make sure future tables in this schema don't accidentally inherit
-- public/anon/authenticated access either. This only affects objects this
-- same role creates going forward, but it costs nothing to state the
-- intent here.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

alter table events enable row level security;
alter table participants enable row level security;
-- No policies are created for either table, intentionally. anon and
-- authenticated have no grants on these tables at all (see above), so RLS
-- never even gets a chance to matter for them — but if a future migration
-- ever adds a stray grant, RLS with zero policies still denies every row.

-- =============================================================================
-- PUBLIC READ VIEWS
-- =============================================================================
--
-- These are ordinary (definer-rights) views owned by the same role that
-- owns the tables, so they can read events/participants despite anon and
-- authenticated having no direct table grants. They exist specifically to
-- withhold the secret columns (admin_token, edit_token) from any client
-- read path.
--
-- IMPORTANT: the views themselves are NOT granted to anon/authenticated.
-- A blanket `grant select` on a view is all-or-nothing across every row,
-- which would let anyone with the anon key list every event, slug, and
-- room code on the instance via bare PostgREST queries — client-side
-- filters are a convenience, not a boundary. Instead, clients read through
-- the parameterized security-definer functions get_event(p_slug) and
-- get_participants(p_slug) below: you must already hold the slug
-- capability to read anything.
--
-- NOTE on `cascade`: dropping with cascade will also drop any FUTURE
-- object that comes to depend on these views (the get_* functions below
-- are recreated by this same file, so that's safe today). If you add new
-- dependents outside this file, revisit these drops.

drop view if exists events_public cascade;
create view events_public as
  select
    id,
    slug,
    room_code,
    title,
    organizer_name,
    event_tz,
    week_start,
    duration_minutes,
    slot_minutes,
    day_start_min,
    day_end_min,
    days_enabled,
    finalized_start,
    created_at
  from events;
  -- admin_token intentionally omitted.

drop view if exists participants_public cascade;
create view participants_public as
  select
    id,
    event_id,
    name,
    viewer_tz,
    slots,
    updated_at
  from participants;
  -- edit_token intentionally omitted.

revoke all on events_public, participants_public from public, anon, authenticated;
-- No grants to anon/authenticated on purpose — see the note above. All
-- client reads go through get_event / get_participants.

-- =============================================================================
-- RPC: get_event / get_participants (the only public read paths)
-- =============================================================================
--
-- Parameterized reads: the slug is the capability. Without it, nothing is
-- readable; with it, you get exactly one event's public projection. There
-- is deliberately no way to enumerate events or participants.

drop function if exists get_event(text) cascade;
create function get_event(p_slug text)
returns setof events_public
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from events_public where slug = p_slug;
$$;
revoke execute on function get_event(text) from public;
grant execute on function get_event(text) to anon, authenticated;

drop function if exists get_participants(text) cascade;
create function get_participants(p_slug text)
returns setof participants_public
language sql
security definer
set search_path = public, pg_temp
as $$
  select p.*
    from participants_public p
    join events e on e.id = p.event_id
   where e.slug = p_slug
   order by p.updated_at asc;
$$;
revoke execute on function get_participants(text) from public;
grant execute on function get_participants(text) to anon, authenticated;

-- =============================================================================
-- PRIVATE HELPERS
-- =============================================================================
--
-- Shared internal helpers. These are called only from the security-definer
-- functions below (which run as the owner and can therefore call them
-- regardless of grants). They are explicitly NOT executable by anon or
-- authenticated — there is no reason for a client to invoke them directly,
-- and every one pins search_path so it can never be tricked by a hostile
-- search_path into resolving to an attacker-controlled object.

drop function if exists private_is_valid_tz(text) cascade;
create function private_is_valid_tz(p_tz text)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_tz is null then
    return false;
  end if;
  -- Attempting the conversion is the simplest reliable IANA-zone check:
  -- Postgres raises for anything it doesn't recognize as a zone name.
  perform now() at time zone p_tz;
  return true;
exception when others then
  return false;
end;
$$;
revoke execute on function private_is_valid_tz(text) from public, anon, authenticated;

drop function if exists private_random_base58(int) cascade;
create function private_random_base58(p_len int)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Standard base58 alphabet: digits and letters minus 0, O, I, l (visually
  -- ambiguous characters), 58 symbols total.
  v_alphabet text := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  v_result   text := '';
  v_buf      bytea;
  v_byte     int;
  v_i        int;
begin
  if p_len is null or p_len < 1 then
    raise exception 'private_random_base58: p_len must be positive';
  end if;

  while length(v_result) < p_len loop
    -- uuid_send(gen_random_uuid()) is 16 cryptographically random bytes,
    -- straight from core Postgres — no pgcrypto extension required.
    v_buf := uuid_send(gen_random_uuid());
    v_i := 0;
    while v_i <= 15 and length(v_result) < p_len loop
      v_byte := get_byte(v_buf, v_i);
      -- 58 does NOT evenly divide 256 (256 = 4*58 + 24), so a plain `% 58`
      -- would be biased toward the low 24 symbols of the alphabet.
      -- Rejection sampling fixes this: only accept bytes below the largest
      -- multiple of 58 that fits in a byte (4*58 = 232) and discard the
      -- rest. Every accepted byte then maps to a uniformly random symbol.
      if v_byte < 232 then
        v_result := v_result || substr(v_alphabet, (v_byte % 58) + 1, 1);
      end if;
      v_i := v_i + 1;
    end loop;
  end loop;

  return v_result;
end;
$$;
revoke execute on function private_random_base58(int) from public, anon, authenticated;

drop function if exists private_room_code() cascade;
create function private_room_code()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Crockford base32: digits and letters minus I, L, O, U (avoids
  -- confusion with 1/1/0/V and profanity), 32 symbols total.
  v_alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_buf      bytea := uuid_send(gen_random_uuid()); -- 16 random bytes, need 8
  v_result   text := '';
  v_i        int;
begin
  for v_i in 0..7 loop
    -- 256 / 32 = 8 exactly, so `% 32` over a uniformly random byte has
    -- zero modulo bias — no rejection sampling needed here, unlike base58.
    v_result := v_result || substr(v_alphabet, (get_byte(v_buf, v_i) % 32) + 1, 1);
  end loop;
  return v_result;
end;
$$;
revoke execute on function private_room_code() from public, anon, authenticated;

-- =============================================================================
-- RPC: create_event
-- =============================================================================

drop function if exists create_event(jsonb) cascade;
create function create_event(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug          text := payload->>'slug';
  v_title         text := payload->>'title';
  v_organizer     text := payload->>'organizer_name';
  v_tz            text := payload->>'event_tz';
  v_week_start    date;
  v_duration      int;
  v_slot          int;
  v_day_start     int;
  v_day_end       int;
  v_days          int[];
  v_admin_token   text;
  v_room_code     text;
  v_event_id      uuid;
  v_attempt       int;
begin
  -- Every field is validated here, server-side. The client-supplied
  -- payload is never trusted, regardless of what the UI enforces.

  if v_slug is null or v_slug !~ '^[1-9A-HJ-NP-Za-km-z]{16}$' then
    raise exception 'create_event: slug must be exactly 16 base58 characters';
  end if;

  if v_title is null or length(v_title) < 1 or length(v_title) > 120 then
    raise exception 'create_event: title must be 1-120 characters';
  end if;

  if v_organizer is null or length(v_organizer) < 1 or length(v_organizer) > 60 then
    raise exception 'create_event: organizer_name must be 1-60 characters';
  end if;

  if not private_is_valid_tz(v_tz) then
    raise exception 'create_event: event_tz is not a recognized IANA time zone';
  end if;

  begin
    v_week_start := (payload->>'week_start')::date;
  exception when others then
    raise exception 'create_event: week_start is not a valid date';
  end;
  if v_week_start is null or extract(isodow from v_week_start) <> 1 then
    raise exception 'create_event: week_start must be a Monday';
  end if;

  begin
    v_duration := (payload->>'duration_minutes')::int;
  exception when others then
    raise exception 'create_event: duration_minutes must be an integer';
  end;
  if v_duration is null or v_duration < 15 or v_duration > 480 then
    raise exception 'create_event: duration_minutes must be 15-480';
  end if;

  begin
    v_slot := (payload->>'slot_minutes')::int;
  exception when others then
    raise exception 'create_event: slot_minutes must be an integer';
  end;
  if v_slot is null or v_slot not in (15, 30, 60) then
    raise exception 'create_event: slot_minutes must be 15, 30, or 60';
  end if;

  begin
    v_day_start := (payload->>'day_start_min')::int;
    v_day_end   := (payload->>'day_end_min')::int;
  exception when others then
    raise exception 'create_event: day_start_min/day_end_min must be integers';
  end;
  if v_day_start is null or v_day_end is null
     or v_day_start < 0 or v_day_end > 1440 or v_day_start >= v_day_end
     or v_day_start % v_slot <> 0 or v_day_end % v_slot <> 0 then
    raise exception 'create_event: day_start_min/day_end_min out of range or not aligned to slot_minutes';
  end if;

  begin
    select array_agg(distinct (x)::int order by (x)::int)
      into v_days
      from jsonb_array_elements_text(coalesce(payload->'days_enabled', '[]'::jsonb)) as x;
  exception when others then
    raise exception 'create_event: days_enabled must be an array of integers';
  end;

  if v_days is null or array_length(v_days, 1) is null or array_length(v_days, 1) = 0 then
    raise exception 'create_event: days_enabled must be a non-empty array';
  end if;
  if exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
    raise exception 'create_event: days_enabled values must be between 0 and 6';
  end if;

  v_admin_token := private_random_base58(32);

  for v_attempt in 1..5 loop
    v_room_code := private_room_code();
    begin
      insert into events (
        slug, room_code, admin_token, title, organizer_name, event_tz,
        week_start, duration_minutes, slot_minutes, day_start_min, day_end_min,
        days_enabled
      ) values (
        v_slug, v_room_code, v_admin_token, v_title, v_organizer, v_tz,
        v_week_start, v_duration, v_slot, v_day_start, v_day_end,
        v_days
      )
      returning id into v_event_id;

      return jsonb_build_object(
        'slug', v_slug,
        'room_code', v_room_code,
        'admin_token', v_admin_token
      );
    exception when unique_violation then
      -- Either room_code (8-char base32, retryable) or slug (16-char
      -- base58, generated client-side, effectively never collides) hit an
      -- existing row. Either way, retrying with a freshly generated
      -- room_code is safe and, for the slug case, will simply fail again
      -- until we give up below.
      if v_attempt = 5 then
        raise exception 'create_event: could not generate a unique event, please try again';
      end if;
    end;
  end loop;
end;
$$;
revoke execute on function create_event(jsonb) from public;
grant execute on function create_event(jsonb) to anon, authenticated;

-- =============================================================================
-- RPC: resolve_room_code
-- =============================================================================

drop function if exists resolve_room_code(text) cascade;
create function resolve_room_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_norm text;
  v_slug text;
begin
  -- Fixed, unconditional delay FIRST, before any lookup or validation, so
  -- that response timing cannot be used to distinguish "no such code" from
  -- "found it" from "malformed input". This function is an intentional
  -- enumeration surface (see SECURITY.md) and this is its main mitigation.
  perform pg_sleep(0.3);

  if p_code is null then
    return null;
  end if;

  -- Normalize the way a human might type a code back in: case-insensitive,
  -- ignore spaces/dashes, and map the classic Crockford look-alikes.
  v_norm := upper(regexp_replace(p_code, '[\s-]', '', 'g'));
  v_norm := replace(v_norm, 'I', '1');
  v_norm := replace(v_norm, 'L', '1');
  v_norm := replace(v_norm, 'O', '0');

  select slug
    into v_slug
    from events
    where room_code = v_norm
      and week_start + 14 >= current_date
    limit 1;

  -- Only the slug is ever returned — never title, organizer, participant
  -- counts, or any other detail that would leak information about a
  -- near-miss guess.
  return v_slug;
end;
$$;
revoke execute on function resolve_room_code(text) from public;
grant execute on function resolve_room_code(text) to anon, authenticated;

-- =============================================================================
-- RPC: join_event
-- =============================================================================

drop function if exists join_event(text, text, text) cascade;
create function join_event(p_slug text, p_name text, p_viewer_tz text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event          events%rowtype;
  v_name           text := trim(coalesce(p_name, ''));
  v_count          int;
  v_participant_id uuid;
  v_edit_token     text;
begin
  -- Lock the event row for the duration of this transaction so concurrent
  -- joins can't both read "59 participants" and both insert, blowing past
  -- the 60-participant cap.
  select * into v_event from events where slug = p_slug for update;

  if not found then
    raise exception 'join_event: event not found';
  end if;

  if v_event.finalized_start is not null then
    raise exception 'join_event: event is already finalized';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'join_event: name must be 1-60 characters after trimming';
  end if;

  if not private_is_valid_tz(p_viewer_tz) then
    raise exception 'join_event: viewer_tz is not a recognized IANA time zone';
  end if;

  select count(*) into v_count from participants where event_id = v_event.id;
  if v_count >= 60 then
    raise exception 'join_event: event has reached the 60 participant limit';
  end if;

  v_edit_token := private_random_base58(32);

  insert into participants (event_id, edit_token, name, viewer_tz)
    values (v_event.id, v_edit_token, v_name, p_viewer_tz)
    returning id into v_participant_id;

  return jsonb_build_object(
    'participant_id', v_participant_id,
    'edit_token', v_edit_token
  );
end;
$$;
revoke execute on function join_event(text, text, text) from public;
grant execute on function join_event(text, text, text) to anon, authenticated;

-- =============================================================================
-- RPC: set_availability
-- =============================================================================

drop function if exists set_availability(text, uuid, text, int[]) cascade;
create function set_availability(p_slug text, p_participant_id uuid, p_edit_token text, p_slots int[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event       events%rowtype;
  v_participant participants%rowtype;
  v_max_index   int;
  v_clean_slots int[];
begin
  select * into v_event from events where slug = p_slug;
  if not found then
    raise exception 'set_availability: event not found';
  end if;

  if v_event.finalized_start is not null then
    raise exception 'set_availability: event is already finalized';
  end if;

  select * into v_participant
    from participants
    where id = p_participant_id and event_id = v_event.id;
  if not found then
    raise exception 'set_availability: participant not found';
  end if;

  -- Compare token hashes, never the raw strings. A direct `=` on text
  -- short-circuits on the first mismatched byte, so its timing leaks how
  -- many leading characters an attacker has guessed correctly. md5() is
  -- built into core Postgres (no extension) and comparing fixed-length
  -- hashes removes that channel.
  if md5(v_participant.edit_token) <> md5(coalesce(p_edit_token, '')) then
    raise exception 'set_availability: invalid edit token';
  end if;

  v_max_index := 7 * ((v_event.day_end_min - v_event.day_start_min) / v_event.slot_minutes) - 1;

  select array_agg(distinct s order by s)
    into v_clean_slots
    from unnest(coalesce(p_slots, '{}'::int[])) as s;
  v_clean_slots := coalesce(v_clean_slots, '{}');

  if array_length(v_clean_slots, 1) is not null then
    if exists (select 1 from unnest(v_clean_slots) s where s < 0 or s > v_max_index) then
      raise exception 'set_availability: slot index out of range';
    end if;
  end if;

  update participants
    set slots = v_clean_slots,
        updated_at = now()
    where id = p_participant_id;
end;
$$;
revoke execute on function set_availability(text, uuid, text, int[]) from public;
grant execute on function set_availability(text, uuid, text, int[]) to anon, authenticated;

-- =============================================================================
-- RPC: finalize_event
-- =============================================================================

drop function if exists finalize_event(text, text, timestamptz) cascade;
create function finalize_event(p_slug text, p_admin_token text, p_start timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event      events%rowtype;
  v_local      timestamp;
  v_local_date date;
  v_day_offset int;
  v_minutes    int;
begin
  select * into v_event from events where slug = p_slug for update;
  if not found then
    raise exception 'finalize_event: event not found';
  end if;

  if md5(v_event.admin_token) <> md5(coalesce(p_admin_token, '')) then
    raise exception 'finalize_event: invalid admin token';
  end if;

  if p_start is null then
    raise exception 'finalize_event: p_start is required';
  end if;

  v_local      := p_start at time zone v_event.event_tz;
  v_local_date := v_local::date;
  v_day_offset := v_local_date - v_event.week_start;

  if v_day_offset < 0 or v_day_offset > 6 then
    raise exception 'finalize_event: start date falls outside the event week';
  end if;

  if not (v_day_offset = any(v_event.days_enabled)) then
    raise exception 'finalize_event: start date is not one of the enabled days';
  end if;

  v_minutes := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  if v_minutes < v_event.day_start_min then
    raise exception 'finalize_event: start time is before the day window opens';
  end if;

  if (v_minutes - v_event.day_start_min) % v_event.slot_minutes <> 0 then
    raise exception 'finalize_event: start time does not align to a slot boundary';
  end if;

  if v_minutes + v_event.duration_minutes > v_event.day_end_min then
    raise exception 'finalize_event: meeting would extend past the day window';
  end if;

  update events set finalized_start = p_start where id = v_event.id;
end;
$$;
revoke execute on function finalize_event(text, text, timestamptz) from public;
grant execute on function finalize_event(text, text, timestamptz) to anon, authenticated;

-- =============================================================================
-- RPC: unfinalize_event
-- =============================================================================

drop function if exists unfinalize_event(text, text) cascade;
create function unfinalize_event(p_slug text, p_admin_token text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
begin
  select * into v_event from events where slug = p_slug for update;
  if not found then
    raise exception 'unfinalize_event: event not found';
  end if;

  if md5(v_event.admin_token) <> md5(coalesce(p_admin_token, '')) then
    raise exception 'unfinalize_event: invalid admin token';
  end if;

  update events set finalized_start = null where id = v_event.id;
end;
$$;
revoke execute on function unfinalize_event(text, text) from public;
grant execute on function unfinalize_event(text, text) to anon, authenticated;

-- =============================================================================
-- Token storage note
-- =============================================================================
--
-- admin_token and edit_token are stored PLAINTEXT in the events/participants
-- tables in this v1 schema. They are never exposed through the public views
-- or any grant to anon/authenticated — the only rows that can ever read them
-- are the security-definer functions above, running as the table owner. All
-- token *comparisons* in those functions hash both sides with md5() first
-- specifically to avoid raw-string timing leaks, but the values still sit in
-- the table unhashed. Hashing tokens at rest (so even a leaked database
-- backup doesn't hand out live admin/edit access) is the intended v2
-- hardening step — see SECURITY.md.
