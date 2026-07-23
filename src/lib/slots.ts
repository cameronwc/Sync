// Core time-math for the availability grid. The canonical unit is the slot
// index: slot_index = dayOffset * slotsPerDay + slotOfDay, dayOffset 0..6
// from weekStart (a Monday, interpreted in eventTz). Indices span ALL 7 days
// including disabled ones — consumers filter by daysEnabled.
//
// Every slot resolves to a single UTC instant via luxon by constructing the
// LOCAL WALL TIME in eventTz — we never add minutes to a UTC epoch, since
// that would silently skew across DST transitions.
//
// This module is pure. Memoization (e.g. via useMemo around buildSlotTable)
// is the caller's responsibility.

import { DateTime } from 'luxon'
import type { GridConfig, SlotInfo, SlotStatus, ViewerLabel } from './types'

const MINUTES_PER_DAY = 1440

export function slotsPerDay(cfg: GridConfig): number {
  return (cfg.dayEndMin - cfg.dayStartMin) / cfg.slotMinutes
}

export function totalSlots(cfg: GridConfig): number {
  return 7 * slotsPerDay(cfg)
}

export function windowSlots(cfg: GridConfig): number {
  return Math.ceil(cfg.durationMinutes / cfg.slotMinutes)
}

/**
 * The calendar (year, month, day) of weekStart + dayOffset days, computed as
 * pure calendar-date arithmetic in a fixed (UTC) zone. weekStart is a date,
 * not an instant, so this arithmetic must never touch eventTz's DST rules —
 * only the later reconstruction of a specific wall-clock time does that.
 */
function dateForDayOffset(cfg: GridConfig, dayOffset: number): { year: number; month: number; day: number } {
  const base = DateTime.fromISO(cfg.weekStart, { zone: 'utc' })
  const target = base.plus({ days: dayOffset })
  return { year: target.year, month: target.month, day: target.day }
}

interface ResolvedWallTime {
  dt: DateTime
  /** The wall-clock minute-of-day was skipped over by a spring-forward gap. */
  nonexistent: boolean
  /** The wall-clock minute-of-day occurs twice due to a fall-back repeat; dt is the FIRST (earlier-offset) occurrence. */
  ambiguous: boolean
}

/**
 * Resolves dayOffset + minutesOfDay (minutes past local midnight, 0..1440
 * inclusive) to an absolute instant in cfg.eventTz, flagging DST edge cases.
 *
 * minutesOfDay may equal 1440 (a slot's end coinciding with midnight); that
 * rolls over to 00:00 of the next day rather than an invalid 24:00.
 */
function resolveWallTime(cfg: GridConfig, dayOffset: number, minutesOfDay: number): ResolvedWallTime {
  const extraDays = Math.floor(minutesOfDay / MINUTES_PER_DAY)
  const rem = minutesOfDay - extraDays * MINUTES_PER_DAY
  const hour = Math.floor(rem / 60)
  const minute = rem % 60
  const { year, month, day } = dateForDayOffset(cfg, dayOffset + extraDays)

  const dt = DateTime.fromObject({ year, month, day, hour, minute }, { zone: cfg.eventTz })

  // luxon shifts a nonexistent wall time (spring-forward gap) forward to the
  // next valid instant rather than erroring — detect that shift by comparing
  // the intended minute-of-day against what actually landed.
  const intendedMinutes = hour * 60 + minute
  const actualMinutes = dt.hour * 60 + dt.minute
  const nonexistent = actualMinutes !== intendedMinutes

  let ambiguous = false
  if (!nonexistent) {
    // A fall-back repeat means the same wall-clock hour:minute occurs again
    // exactly one hour later in eventTz. luxon's fromObject already returns
    // the first (earlier-offset) occurrence, which is what we keep.
    const oneHourLater = DateTime.fromMillis(dt.toMillis() + 3600_000, { zone: cfg.eventTz })
    ambiguous = oneHourLater.hour === dt.hour && oneHourLater.minute === dt.minute
  }

  return { dt, nonexistent, ambiguous }
}

function toIso(dt: DateTime): string {
  const iso = dt.toUTC().toISO()
  if (iso === null) throw new Error('unreachable: constructed DateTime was invalid')
  return iso
}

export function buildSlotTable(cfg: GridConfig): SlotInfo[] {
  const perDay = slotsPerDay(cfg)
  const total = totalSlots(cfg)
  const table: SlotInfo[] = []

  for (let index = 0; index < total; index++) {
    const dayOffset = Math.floor(index / perDay)
    const slotOfDay = index % perDay
    const startMin = cfg.dayStartMin + slotOfDay * cfg.slotMinutes
    const endMin = startMin + cfg.slotMinutes

    const start = resolveWallTime(cfg, dayOffset, startMin)
    const end = resolveWallTime(cfg, dayOffset, endMin)

    let status: SlotStatus = 'normal'
    if (start.nonexistent) status = 'nonexistent'
    else if (start.ambiguous) status = 'ambiguous'

    const startUtc = toIso(start.dt)
    const endUtc =
      status === 'nonexistent'
        ? // Start itself is dead; consumers ignore this slot, so just emit
          // the best-effort (shifted) instant for both ends.
          toIso(end.dt)
        : end.nonexistent
          ? // Start is fine but the slot's end falls in a spring-forward gap
            // (e.g. 01:30-02:00 when 02:00-03:00 doesn't exist): fall back
            // to exact-duration arithmetic from the (valid) start instant.
            toIso(start.dt.plus({ minutes: cfg.slotMinutes }))
          : toIso(end.dt)

    table.push({ index, dayOffset, slotOfDay, startUtc, endUtc, status })
  }

  return table
}

export function viewerLabel(slot: SlotInfo, cfg: GridConfig, viewerTz: string): ViewerLabel {
  const startInViewer = DateTime.fromISO(slot.startUtc, { zone: 'utc' }).setZone(viewerTz)
  const time = startInViewer.toFormat('HH:mm')

  const eventDate = dateForDayOffset(cfg, slot.dayOffset)
  const eventDateOnly = DateTime.fromObject(eventDate, { zone: 'utc' })
  const viewerDateOnly = DateTime.fromObject(
    { year: startInViewer.year, month: startInViewer.month, day: startInViewer.day },
    { zone: 'utc' },
  )
  const dayDelta = Math.round(viewerDateOnly.diff(eventDateOnly, 'days').days)

  return { time, dayDelta }
}

export function eventDayLabel(cfg: GridConfig, dayOffset: number): string {
  const { year, month, day } = dateForDayOffset(cfg, dayOffset)
  return DateTime.fromObject({ year, month, day }, { zone: 'utc' }).toFormat('ccc d LLL')
}

export function fmtInstant(iso: string, tz: string): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz)
  return dt.toFormat("ccc, LLL d '·' HH:mm")
}

export function fmtTimeRange(startIso: string, endIso: string, tz: string): string {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(tz)
  const end = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(tz)
  return `${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}`
}

export function nextMonday(): string {
  const today = DateTime.local().startOf('day')
  let daysToAdd = (1 - today.weekday + 7) % 7
  if (daysToAdd === 0) daysToAdd = 7
  const iso = today.plus({ days: daysToAdd }).toISODate()
  if (iso === null) throw new Error('unreachable: invalid local date')
  return iso
}

export function mondayOf(isoDate: string): string {
  const dt = DateTime.fromISO(isoDate, { zone: 'utc' })
  const daysSinceMonday = dt.weekday - 1
  const iso = dt.minus({ days: daysSinceMonday }).toISODate()
  if (iso === null) throw new Error('unreachable: invalid date')
  return iso
}
