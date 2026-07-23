// Ranks candidate meeting windows by how many participants are free for the
// entire window. Windows never cross a day boundary and never include a
// 'nonexistent' (spring-forward gap) slot.

import { DateTime } from 'luxon'
import type { Candidate, GridConfig, ParticipantPublic, SlotInfo } from './types'
import { slotsPerDay, windowSlots } from './slots'

export function rankCandidates(cfg: GridConfig, table: SlotInfo[], participants: ParticipantPublic[]): Candidate[] {
  if (participants.length === 0) return []

  const k = windowSlots(cfg)
  const perDay = slotsPerDay(cfg)

  const byIndex = new Map<number, SlotInfo>()
  for (const slot of table) byIndex.set(slot.index, slot)

  const participantSets = participants.map((p) => ({ name: p.name, set: new Set(p.slots) }))

  const daysAsc = [...cfg.daysEnabled].sort((a, b) => a - b)
  const candidates: Candidate[] = []

  for (const day of daysAsc) {
    for (let start = 0; start <= perDay - k; start++) {
      const windowIndices: number[] = []
      let hasNonexistent = false

      for (let i = 0; i < k; i++) {
        const slotOfDay = start + i
        const index = day * perDay + slotOfDay
        const slot = byIndex.get(index)
        if (!slot || slot.status === 'nonexistent') {
          hasNonexistent = true
          break
        }
        windowIndices.push(index)
      }

      if (hasNonexistent) continue

      const firstIndex = windowIndices[0]
      const lastIndex = windowIndices[windowIndices.length - 1]
      if (firstIndex === undefined || lastIndex === undefined) continue
      const firstSlot = byIndex.get(firstIndex)
      const lastSlot = byIndex.get(lastIndex)
      if (!firstSlot || !lastSlot) continue

      const missing: string[] = []
      let count = 0
      for (const p of participantSets) {
        const fullyAvailable = windowIndices.every((idx) => p.set.has(idx))
        if (fullyAvailable) count++
        else missing.push(p.name)
      }

      candidates.push({
        day,
        start,
        count,
        total: participants.length,
        missing,
        startUtc: firstSlot.startUtc,
        // The window rounds coverage UP to whole slots, but the meeting ends
        // duration_minutes after it starts — a 45-min meeting over 30-min
        // slots must not display as 60 min. (Confirmed card/.ics use the
        // same arithmetic, so preview and confirmation agree.)
        endUtc:
          DateTime.fromISO(firstSlot.startUtc)
            .plus({ minutes: cfg.durationMinutes })
            .toUTC()
            .toISO() ?? lastSlot.endUtc,
        slotIndices: windowIndices,
      })
    }
  }

  candidates.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.startUtc < b.startUtc ? -1 : a.startUtc > b.startUtc ? 1 : 0
  })

  return candidates
}
