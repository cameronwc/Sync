// Shared domain types. Every module imports from here; do not duplicate these shapes.

/** Row shape of the events_public view (admin_token is never readable). */
export interface EventPublic {
  id: string
  slug: string
  room_code: string
  title: string
  organizer_name: string
  /** IANA zone, e.g. America/Los_Angeles */
  event_tz: string
  /** ISO date (yyyy-MM-dd), the Monday of the target week in event_tz */
  week_start: string
  duration_minutes: number
  slot_minutes: 15 | 30 | 60
  /** minutes past midnight in event_tz */
  day_start_min: number
  day_end_min: number
  /** 0 = Monday .. 6 = Sunday */
  days_enabled: number[]
  /** ISO timestamptz once the organizer picks, else null */
  finalized_start: string | null
  created_at: string
}

/** Row shape of the participants_public view (edit_token is never readable). */
export interface ParticipantPublic {
  id: string
  event_id: string
  name: string
  viewer_tz: string
  /** sorted slot indices this person is FREE */
  slots: number[]
  updated_at: string
}

/** The subset of event fields the slot engine needs. */
export interface GridConfig {
  eventTz: string
  /** ISO date yyyy-MM-dd, Monday */
  weekStart: string
  slotMinutes: number
  dayStartMin: number
  dayEndMin: number
  daysEnabled: number[]
  durationMinutes: number
}

export type SlotStatus = 'normal' | 'nonexistent' | 'ambiguous'

/** One grid cell resolved to an absolute instant. Computed once, memoized. */
export interface SlotInfo {
  index: number
  /** 0..6 from weekStart */
  dayOffset: number
  /** 0..slotsPerDay-1 */
  slotOfDay: number
  /** ISO UTC instant of the slot start (first occurrence on fall-back) */
  startUtc: string
  /** ISO UTC instant of the slot end */
  endUtc: string
  /** nonexistent = spring-forward gap; ambiguous = fall-back repeat */
  status: SlotStatus
}

/** Viewer-local rendering of a slot's start time. */
export interface ViewerLabel {
  /** e.g. "09:30" in the viewer's zone, 24h */
  time: string
  /** -1 | 0 | 1: viewer-local date minus the column's event_tz date */
  dayDelta: number
}

/** A ranked meeting window. */
export interface Candidate {
  /** dayOffset 0..6 */
  day: number
  /** first slotOfDay of the window */
  start: number
  /** participants free for every slot in the window */
  count: number
  total: number
  /** names of participants NOT fully available */
  missing: string[]
  startUtc: string
  endUtc: string
  slotIndices: number[]
}

/** Busy span from a calendar provider, already UTC. Discarded after mapping. */
export interface BusyInterval {
  startUtc: string
  endUtc: string
  allDay: boolean
}

export interface CalendarProvider {
  id: 'google' | 'microsoft'
  label: string
  /** true only when the corresponding client ID env var is set */
  available: boolean
  /** Runs the popup OAuth flow and fetches busy intervals for the span. */
  fetchBusy(startUtc: string, endUtc: string): Promise<BusyInterval[]>
}

/** Participant identity persisted in localStorage, keyed by slug. */
export interface Identity {
  participantId: string
  editToken: string
  name: string
}

export interface CreateEventInput {
  slug: string
  title: string
  organizer_name: string
  event_tz: string
  week_start: string
  duration_minutes: number
  slot_minutes: number
  day_start_min: number
  day_end_min: number
  days_enabled: number[]
}

export interface CreateEventResult {
  slug: string
  room_code: string
  admin_token: string
}

export interface JoinResult {
  participant_id: string
  edit_token: string
}
