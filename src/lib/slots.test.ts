import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import {
  buildSlotTable,
  eventDayLabel,
  fmtInstant,
  fmtTimeRange,
  mondayOf,
  nextMonday,
  slotsPerDay,
  totalSlots,
  viewerLabel,
  windowSlots,
} from './slots'
import { rankCandidates } from './rank'
import { formatRoomCode, genSlug, genToken, normalizeRoomCode } from './tokens'
import type { GridConfig, ParticipantPublic, SlotInfo } from './types'

const BASE58_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/

function fullWeekCfg(overrides: Partial<GridConfig> = {}): GridConfig {
  return {
    eventTz: 'America/Los_Angeles',
    weekStart: '2026-03-02', // Monday
    slotMinutes: 30,
    dayStartMin: 0,
    dayEndMin: 1440,
    daysEnabled: [0, 1, 2, 3, 4, 5, 6],
    durationMinutes: 30,
    ...overrides,
  }
}

describe('slotsPerDay / totalSlots / windowSlots', () => {
  it('computes the grid dimensions', () => {
    const cfg = fullWeekCfg()
    expect(slotsPerDay(cfg)).toBe(48) // 1440 / 30
    expect(totalSlots(cfg)).toBe(336) // 7 * 48
    expect(windowSlots(cfg)).toBe(1) // ceil(30/30)
    expect(windowSlots(fullWeekCfg({ durationMinutes: 45 }))).toBe(2) // ceil(45/30)
    expect(windowSlots(fullWeekCfg({ durationMinutes: 60 }))).toBe(2) // ceil(60/30)
  })
})

describe('spring-forward: America/Los_Angeles, Sunday 2026-03-08 02:00-03:00 does not exist', () => {
  const cfg = fullWeekCfg({ weekStart: '2026-03-02' })
  const table = buildSlotTable(cfg)
  const perDay = slotsPerDay(cfg)
  const sunday = 6 // dayOffset from Monday 2026-03-02

  function slotAt(hour: number, minute: number): SlotInfo {
    const slotOfDay = (hour * 60 + minute) / cfg.slotMinutes
    const index = sunday * perDay + slotOfDay
    const slot = table[index]
    if (!slot) throw new Error(`no slot at index ${index}`)
    return slot
  }

  it('marks the slot starting exactly at 02:00 and 02:30 as nonexistent', () => {
    expect(slotAt(2, 0).status).toBe('nonexistent')
    expect(slotAt(2, 30).status).toBe('nonexistent')
  })

  it('the 01:30 slot (just before the gap) is normal with correct startUtc', () => {
    const slot = slotAt(1, 30)
    expect(slot.status).toBe('normal')
    expect(slot.startUtc).toBe('2026-03-08T09:30:00.000Z') // 01:30 PST = UTC-8
  })

  it('the 01:30 slot end falls back to exact +30min arithmetic since 02:00 is in the gap', () => {
    const slot = slotAt(1, 30)
    expect(slot.endUtc).toBe('2026-03-08T10:00:00.000Z')
  })

  it('the 03:00 slot (just after the gap) is normal with correct startUtc', () => {
    const slot = slotAt(3, 0)
    expect(slot.status).toBe('normal')
    expect(slot.startUtc).toBe('2026-03-08T10:00:00.000Z') // 03:00 PDT = UTC-7
  })

  it('slots well outside the gap are unaffected', () => {
    expect(slotAt(0, 0).status).toBe('normal')
    expect(slotAt(0, 0).startUtc).toBe('2026-03-08T08:00:00.000Z')
    expect(slotAt(23, 30).status).toBe('normal')
  })
})

describe('fall-back: America/Los_Angeles, Sunday 2026-11-01 01:00-02:00 repeats', () => {
  const cfg = fullWeekCfg({ weekStart: '2026-10-26' })
  const table = buildSlotTable(cfg)
  const perDay = slotsPerDay(cfg)
  const sunday = 6 // dayOffset from Monday 2026-10-26

  function slotAt(hour: number, minute: number): SlotInfo {
    const slotOfDay = (hour * 60 + minute) / cfg.slotMinutes
    const index = sunday * perDay + slotOfDay
    const slot = table[index]
    if (!slot) throw new Error(`no slot at index ${index}`)
    return slot
  }

  it('01:00 and 01:30 are ambiguous and resolve to the FIRST (PDT) occurrence', () => {
    const at0100 = slotAt(1, 0)
    const at0130 = slotAt(1, 30)
    expect(at0100.status).toBe('ambiguous')
    expect(at0100.startUtc).toBe('2026-11-01T08:00:00.000Z')
    expect(at0130.status).toBe('ambiguous')
    expect(at0130.startUtc).toBe('2026-11-01T08:30:00.000Z')
  })

  it('00:30 (before) and 02:00 (after) are normal, unambiguous', () => {
    expect(slotAt(0, 30).status).toBe('normal')
    expect(slotAt(2, 0).status).toBe('normal')
    expect(slotAt(2, 0).startUtc).toBe('2026-11-01T10:00:00.000Z') // 02:00 PST = UTC-8
  })
})

describe('viewer in Asia/Tokyo', () => {
  it('an evening LA slot produces dayDelta +1', () => {
    const cfg = fullWeekCfg({ weekStart: '2026-03-02' })
    const table = buildSlotTable(cfg)
    const perDay = slotsPerDay(cfg)
    // Wednesday (dayOffset 2, 2026-03-04) 21:00 LA (PST)
    const index = 2 * perDay + (21 * 60) / cfg.slotMinutes
    const slot = table[index]
    if (!slot) throw new Error('missing slot')
    expect(slot.startUtc).toBe('2026-03-05T05:00:00.000Z')

    const label = viewerLabel(slot, cfg, 'Asia/Tokyo')
    expect(label.time).toBe('14:00')
    expect(label.dayDelta).toBe(1)
  })
})

describe('viewer in Pacific/Auckland across the NZ spring-forward (2026-09-27)', () => {
  const cfg = fullWeekCfg({ weekStart: '2026-09-21' })
  const table = buildSlotTable(cfg)
  const perDay = slotsPerDay(cfg)

  function eveningSlot(dayOffset: number): SlotInfo {
    const index = dayOffset * perDay + (21 * 60) / cfg.slotMinutes
    const slot = table[index]
    if (!slot) throw new Error('missing slot')
    return slot
  }

  it('Friday 21:00 LA (before the NZ transition instant) is +1 day at 16:00 NZST', () => {
    const slot = eveningSlot(4) // Friday 2026-09-25
    expect(slot.startUtc).toBe('2026-09-26T04:00:00.000Z')
    const label = viewerLabel(slot, cfg, 'Pacific/Auckland')
    expect(label.dayDelta).toBe(1)
    expect(label.time).toBe('16:00')
  })

  it('Saturday 21:00 LA (after the NZ transition instant) is still +1 day but at 17:00 NZDT', () => {
    const slot = eveningSlot(5) // Saturday 2026-09-26
    expect(slot.startUtc).toBe('2026-09-27T04:00:00.000Z')
    const label = viewerLabel(slot, cfg, 'Pacific/Auckland')
    expect(label.dayDelta).toBe(1)
    expect(label.time).toBe('17:00') // shifted by NZ's own DST, not LA's wall time (still 21:00 LA both days)
  })
})

describe('viewer in Asia/Kolkata (UTC+5:30, a half-hour offset)', () => {
  it('shifts :00/:30 endings across the half-hour boundary', () => {
    const cfg = fullWeekCfg({ weekStart: '2026-03-02' })
    const table = buildSlotTable(cfg)
    const perDay = slotsPerDay(cfg)
    // Tuesday (dayOffset 1, 2026-03-03) 10:00 and 10:30 LA (PST)
    const slot1000 = table[1 * perDay + (10 * 60) / cfg.slotMinutes]
    const slot1030 = table[1 * perDay + (10 * 60 + 30) / cfg.slotMinutes]
    if (!slot1000 || !slot1030) throw new Error('missing slot')

    expect(slot1000.startUtc).toBe('2026-03-03T18:00:00.000Z')
    const label1000 = viewerLabel(slot1000, cfg, 'Asia/Kolkata')
    expect(label1000.time).toBe('23:30')
    expect(label1000.dayDelta).toBe(0)

    expect(slot1030.startUtc).toBe('2026-03-03T18:30:00.000Z')
    const label1030 = viewerLabel(slot1030, cfg, 'Asia/Kolkata')
    expect(label1030.time).toBe('00:00')
    expect(label1030.dayDelta).toBe(1)
  })
})

describe('eventDayLabel / fmtInstant / fmtTimeRange / mondayOf / nextMonday', () => {
  it('eventDayLabel renders the event-tz calendar date for a day column', () => {
    const cfg = fullWeekCfg({ weekStart: '2026-03-02' })
    expect(eventDayLabel(cfg, 0)).toBe('Mon 2 Mar')
    expect(eventDayLabel(cfg, 6)).toBe('Sun 8 Mar')
  })

  it('fmtInstant renders "ccc, LLL d · HH:mm" in the given zone', () => {
    expect(fmtInstant('2026-03-08T09:30:00.000Z', 'America/Los_Angeles')).toBe('Sun, Mar 8 · 01:30')
  })

  it('fmtTimeRange renders an en-dash range and reflects a DST jump across the gap', () => {
    expect(fmtTimeRange('2026-03-08T09:30:00.000Z', '2026-03-08T10:00:00.000Z', 'America/Los_Angeles')).toBe(
      '01:30–03:00',
    )
  })

  it('mondayOf snaps any date to its week Monday', () => {
    expect(mondayOf('2026-03-04')).toBe('2026-03-02') // Wednesday -> that week's Monday
    expect(mondayOf('2026-03-02')).toBe('2026-03-02') // already Monday
    expect(mondayOf('2026-03-08')).toBe('2026-03-02') // Sunday -> previous Monday
  })

  it('nextMonday returns a Monday 1-7 days from today', () => {
    const result = nextMonday()
    const dt = DateTime.fromISO(result, { zone: 'utc' })
    expect(dt.weekday).toBe(1)

    const today = DateTime.local().startOf('day')
    const todayAsUtcDate = DateTime.fromObject({ year: today.year, month: today.month, day: today.day }, { zone: 'utc' })
    const diffDays = dt.diff(todayAsUtcDate, 'days').days
    expect(diffDays).toBeGreaterThanOrEqual(1)
    expect(diffDays).toBeLessThanOrEqual(7)
  })
})

describe('rankCandidates', () => {
  // Hand-crafted fixture: 2 days enabled, 4 slots/day (slotMinutes=30,
  // dayStartMin=0, dayEndMin=120), durationMinutes=60 -> k=2.
  // Day 0 has a nonexistent slot at slotOfDay=1 (index 1), which must
  // eliminate every window that touches it.
  const cfg: GridConfig = {
    eventTz: 'UTC',
    weekStart: '2026-01-05', // Monday
    slotMinutes: 30,
    dayStartMin: 0,
    dayEndMin: 120,
    daysEnabled: [0, 1],
    durationMinutes: 60,
  }

  function slot(index: number, dayOffset: number, slotOfDay: number, startUtc: string, endUtc: string, status: SlotInfo['status']): SlotInfo {
    return { index, dayOffset, slotOfDay, startUtc, endUtc, status }
  }

  const table: SlotInfo[] = [
    slot(0, 0, 0, '2026-01-05T00:00:00.000Z', '2026-01-05T00:30:00.000Z', 'normal'),
    slot(1, 0, 1, '2026-01-05T00:30:00.000Z', '2026-01-05T01:00:00.000Z', 'nonexistent'),
    slot(2, 0, 2, '2026-01-05T01:00:00.000Z', '2026-01-05T01:30:00.000Z', 'normal'),
    slot(3, 0, 3, '2026-01-05T01:30:00.000Z', '2026-01-05T02:00:00.000Z', 'normal'),
    slot(4, 1, 0, '2026-01-06T00:00:00.000Z', '2026-01-06T00:30:00.000Z', 'normal'),
    slot(5, 1, 1, '2026-01-06T00:30:00.000Z', '2026-01-06T01:00:00.000Z', 'normal'),
    slot(6, 1, 2, '2026-01-06T01:00:00.000Z', '2026-01-06T01:30:00.000Z', 'normal'),
    slot(7, 1, 3, '2026-01-06T01:30:00.000Z', '2026-01-06T02:00:00.000Z', 'normal'),
  ]

  const participants: ParticipantPublic[] = [
    { id: 'p1', event_id: 'e', name: 'Alice', viewer_tz: 'UTC', slots: [0, 1, 2, 3, 4, 5, 6, 7], updated_at: '' },
    { id: 'p2', event_id: 'e', name: 'Bob', viewer_tz: 'UTC', slots: [4, 5, 6, 7], updated_at: '' },
    { id: 'p3', event_id: 'e', name: 'Carol', viewer_tz: 'UTC', slots: [2, 3, 4, 5], updated_at: '' },
  ]

  it('returns [] for no participants', () => {
    expect(rankCandidates(cfg, table, [])).toEqual([])
  })

  it('skips every window touching the nonexistent slot, keeps windows within day boundaries, and ranks by count then startUtc', () => {
    const candidates = rankCandidates(cfg, table, participants)

    // Only 4 valid windows total: day0 start=2 ([2,3]); day1 start=0,1,2.
    expect(candidates).toHaveLength(4)

    // No candidate ever crosses the day 0 / day 1 boundary (index 3 -> 4).
    for (const c of candidates) {
      const indices = c.slotIndices
      expect(Math.max(...indices) - Math.min(...indices)).toBeLessThan(4)
    }
    expect(candidates.some((c) => c.slotIndices.includes(3) && c.slotIndices.includes(4))).toBe(false)

    // Rank 1: day1 start=0 [4,5] - all 3 participants free.
    expect(candidates[0]).toMatchObject({ day: 1, start: 0, count: 3, total: 3, missing: [] })

    // Ties at count=2 are ordered by startUtc ascending (earlier start first):
    // day0 start=2 [2,3] (Jan 5) before day1 start=1 [5,6] before day1 start=2 [6,7] (both Jan 6).
    expect(candidates[1]).toMatchObject({ day: 0, start: 2, count: 2, total: 3, missing: ['Bob'] })
    expect(candidates[2]).toMatchObject({ day: 1, start: 1, count: 2, total: 3, missing: ['Carol'] })
    expect(candidates[3]).toMatchObject({ day: 1, start: 2, count: 2, total: 3, missing: ['Carol'] })

    expect(candidates[0]?.startUtc).toBe('2026-01-06T00:00:00.000Z')
    expect(candidates[0]?.endUtc).toBe('2026-01-06T01:00:00.000Z')
  })
})

describe('tokens', () => {
  it('genSlug returns 16 base58 characters', () => {
    const slug = genSlug()
    expect(slug).toHaveLength(16)
    expect(slug).toMatch(BASE58_RE)
  })

  it('genToken returns 32 base58 characters', () => {
    const token = genToken()
    expect(token).toHaveLength(32)
    expect(token).toMatch(BASE58_RE)
  })

  it('genSlug/genToken are not obviously constant across calls', () => {
    const a = genSlug()
    const b = genSlug()
    expect(a).not.toBe(b)
  })

  it('normalizeRoomCode uppercases, strips spaces/dashes, and maps I/L->1, O->0', () => {
    expect(normalizeRoomCode('o1IL-abcd ')).toBe('0111ABCD')
  })

  it('formatRoomCode inserts a dash after the 4th character', () => {
    expect(formatRoomCode('0111ABCD')).toBe('0111-ABCD')
  })
})
