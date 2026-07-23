// Supabase-backed service layer. Reads AND writes both go through
// security-definer RPCs: the *_public views are not directly readable by
// the anon role, because a blanket view grant would allow instance-wide
// enumeration. get_event/get_participants require the slug capability.
import { createClient } from '@supabase/supabase-js'
import type {
  CreateEventInput,
  CreateEventResult,
  EventPublic,
  JoinResult,
  ParticipantPublic,
} from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
})

/** Postgres errors raised via RAISE EXCEPTION carry a "P0001: " prefix; strip it for display. */
function cleanMessage(message: string): string {
  return message.replace(/^P0001:\s*/, '').trim()
}

function fail(error: { message: string }): never {
  throw new Error(cleanMessage(error.message))
}

export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const { data, error } = await supabase.rpc('create_event', { payload: input })
  if (error) fail(error)
  return data as CreateEventResult
}

export async function resolveRoomCode(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('resolve_room_code', { p_code: code })
  if (error) fail(error)
  return (data as string | null) ?? null
}

export async function fetchEvent(slug: string): Promise<EventPublic | null> {
  const { data, error } = await supabase.rpc('get_event', { p_slug: slug })
  if (error) fail(error)
  const rows = (data as EventPublic[] | null) ?? []
  return rows[0] ?? null
}

export async function fetchParticipants(slug: string): Promise<ParticipantPublic[]> {
  const { data, error } = await supabase.rpc('get_participants', { p_slug: slug })
  if (error) fail(error)
  return (data as ParticipantPublic[] | null) ?? []
}

export async function joinEvent(
  slug: string,
  name: string,
  viewerTz: string
): Promise<JoinResult> {
  const { data, error } = await supabase.rpc('join_event', {
    p_slug: slug,
    p_name: name,
    p_viewer_tz: viewerTz,
  })
  if (error) fail(error)
  return data as JoinResult
}

export async function setAvailability(
  slug: string,
  participantId: string,
  editToken: string,
  slots: number[]
): Promise<void> {
  const { error } = await supabase.rpc('set_availability', {
    p_slug: slug,
    p_participant_id: participantId,
    p_edit_token: editToken,
    p_slots: slots,
  })
  if (error) fail(error)
}

export async function finalizeEvent(
  slug: string,
  adminToken: string,
  startUtcIso: string
): Promise<void> {
  const { error } = await supabase.rpc('finalize_event', {
    p_slug: slug,
    p_admin_token: adminToken,
    p_start: startUtcIso,
  })
  if (error) fail(error)
}

export async function unfinalizeEvent(slug: string, adminToken: string): Promise<void> {
  const { error } = await supabase.rpc('unfinalize_event', {
    p_slug: slug,
    p_admin_token: adminToken,
  })
  if (error) fail(error)
}
