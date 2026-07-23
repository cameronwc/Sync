// Maps raw provider busy intervals onto grid slot indices. Raw intervals are
// only ever held transiently by the caller — this module returns derived
// slot indices and counts, nothing that could reconstruct calendar content.
import type { BusyInterval, GridConfig, SlotInfo } from '../lib/types'

export interface BusyMapping {
  /** Slot indices covered by a timed (non-all-day) busy interval by >= 50% of the slot's duration. */
  busySlots: number[]
  /** Slot indices whose day is covered by an all-day event, tracked separately from busySlots. */
  allDayBusySlots: number[]
  /** Count of non-all-day intervals supplied. */
  blockCount: number
  /** Count of all-day intervals supplied. */
  allDayCount: number
}

/** A timed busy block must cover at least this fraction of a slot to count as busy. */
const BUSY_OVERLAP_FRACTION = 0.5

interface Span {
  startMs: number
  endMs: number
}

function toSpan(interval: BusyInterval): Span {
  return { startMs: Date.parse(interval.startUtc), endMs: Date.parse(interval.endUtc) }
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

export function mapBusyToSlots(
  cfg: GridConfig,
  table: SlotInfo[],
  intervals: BusyInterval[]
): BusyMapping {
  const timedSpans = intervals.filter((interval) => !interval.allDay).map(toSpan)
  const allDaySpans = intervals.filter((interval) => interval.allDay).map(toSpan)

  const busySlots: number[] = []
  const allDayBusySlots: number[] = []

  for (const slot of table) {
    if (slot.status === 'nonexistent') continue
    if (!cfg.daysEnabled.includes(slot.dayOffset)) continue

    const slotStart = Date.parse(slot.startUtc)
    const slotEnd = Date.parse(slot.endUtc)
    const slotDuration = slotEnd - slotStart
    if (slotDuration <= 0) continue

    const isBusy = timedSpans.some(
      (span) =>
        overlapMs(slotStart, slotEnd, span.startMs, span.endMs) >=
        slotDuration * BUSY_OVERLAP_FRACTION
    )
    if (isBusy) busySlots.push(slot.index)

    const isAllDayBusy = allDaySpans.some(
      (span) => overlapMs(slotStart, slotEnd, span.startMs, span.endMs) > 0
    )
    if (isAllDayBusy) allDayBusySlots.push(slot.index)
  }

  return {
    busySlots,
    allDayBusySlots,
    blockCount: intervals.filter((interval) => !interval.allDay).length,
    allDayCount: intervals.filter((interval) => interval.allDay).length,
  }
}
