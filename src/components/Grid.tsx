import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as RFocusEvent,
  type KeyboardEvent as RKeyboardEvent,
  type PointerEvent as RPointerEvent,
} from 'react'
import type { GridConfig, ParticipantPublic, SlotInfo, ViewerLabel } from '../lib/types'
import { eventDayLabel, slotsPerDay, viewerLabel, windowSlots } from '../lib/slots'

export interface GridProps {
  cfg: GridConfig
  table: SlotInfo[] // full week, index = slot index; filter columns by cfg.daysEnabled
  viewerTz: string
  mode: 'edit' | 'group'
  mySlots: Set<number> // my FREE slot indices
  onChange: (next: Set<number>) => void
  participants: ParticipantPublic[]
}

interface CellPos {
  day: number
  slotOfDay: number
}

interface DragState {
  anchor: CellPos
  paintValue: boolean
  /** mySlots as it was when the drag began — the preview is recomputed as base ± rectangle each move, never cumulative. */
  base: Set<number>
  slots: Set<number>
}

interface CellStat {
  count: number
  missing: string[]
}

interface WindowInfo {
  day: number
  slotOfDay: number
  span: number
  /** Clamped by day end and/or spans a nonexistent (DST-gap) slot — dims the ribbon. */
  truncated: boolean
  /** Spans a nonexistent slot — count/missing are not meaningful, render a placeholder instead. */
  invalid: boolean
  count: number
  total: number
  missing: string[]
}

function cellKey(day: number, slotOfDay: number): string {
  return `${day}:${slotOfDay}`
}

function formatViewerTime(v: ViewerLabel | undefined): string {
  if (!v) return ''
  if (v.dayDelta === 0) return v.time
  return `${v.time} (${v.dayDelta > 0 ? '+1 day' : '-1 day'} for you)`
}

function isHourBoundary(cfg: GridConfig, slotOfDay: number): boolean {
  return (cfg.dayStartMin + slotOfDay * cfg.slotMinutes) % 60 === 0
}

export default function Grid(props: GridProps): JSX.Element {
  const { cfg, table, viewerTz, mode, mySlots, onChange, participants } = props

  const gridRef = useRef<HTMLDivElement | null>(null)
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const shiftFillRef = useRef<boolean | null>(null)

  const days = useMemo(() => [...cfg.daysEnabled].sort((a, b) => a - b), [cfg.daysEnabled])
  const slotsPerDayCount = useMemo(() => slotsPerDay(cfg), [cfg])
  const windowLen = useMemo(() => windowSlots(cfg), [cfg])

  // grid.get(dayOffset)[slotOfDay] = SlotInfo
  const grid = useMemo(() => {
    const g = new Map<number, SlotInfo[]>()
    for (const day of days) g.set(day, new Array<SlotInfo>(slotsPerDayCount))
    for (const s of table) {
      const col = g.get(s.dayOffset)
      if (col && s.slotOfDay < slotsPerDayCount) col[s.slotOfDay] = s
    }
    return g
  }, [table, days, slotsPerDayCount])

  const viewerLabels = useMemo(() => {
    const m = new Map<number, ViewerLabel>()
    for (const s of table) m.set(s.index, viewerLabel(s, cfg, viewerTz))
    return m
  }, [table, cfg, viewerTz])

  const participantSlotSets = useMemo(
    () => participants.map((p) => ({ name: p.name, slots: new Set(p.slots) })),
    [participants],
  )

  // Per-slot heatmap counts + missing names, memoized on participants.
  const cellStats = useMemo(() => {
    const m = new Map<number, CellStat>()
    for (const s of table) {
      let count = 0
      const missing: string[] = []
      for (const p of participantSlotSets) {
        if (p.slots.has(s.index)) count++
        else missing.push(p.name)
      }
      m.set(s.index, { count, missing })
    }
    return m
  }, [table, participantSlotSets])

  const [focusPos, setFocusPos] = useState<CellPos>(() => ({ day: days[0] ?? 0, slotOfDay: 0 }))
  const [anchorPos, setAnchorPos] = useState<CellPos>(() => ({ day: days[0] ?? 0, slotOfDay: 0 }))
  const [hasDomFocus, setHasDomFocus] = useState(false)
  const [hoverCell, setHoverCell] = useState<CellPos | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  // React state lags DOM events by a render: pointermove/pointerup can fire
  // before setDrag commits, so a fast drag would drop moves and never commit.
  // The ref is the synchronous source of truth; state only drives the preview.
  const dragRef = useRef<DragState | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Keep focus/anchor valid if the enabled days or slot count changes under us.
  useEffect(() => {
    const clamp = (prev: CellPos): CellPos => {
      const day = days.includes(prev.day) ? prev.day : days[0] ?? 0
      const slotOfDay = Math.min(prev.slotOfDay, Math.max(0, slotsPerDayCount - 1))
      return day === prev.day && slotOfDay === prev.slotOfDay ? prev : { day, slotOfDay }
    }
    setFocusPos(clamp)
    setAnchorPos(clamp)
  }, [days, slotsPerDayCount])

  useEffect(() => {
    dragRef.current = null
    setDrag(null)
    setHoverCell(null)
  }, [mode])

  const effectiveSlots = drag ? drag.slots : mySlots

  // Applies fillValue to every cell in the rectangle spanned by anchor..current
  // (inclusive on both axes, skipping nonexistent slots) on top of `base`,
  // returning a new Set. Shared by shift-click/Shift+Arrow (base = mySlots,
  // committed immediately) and drag-paint (base = pre-drag snapshot, recomputed
  // fresh on every pointermove so the live preview never drifts from a single
  // rectangle relative to where the drag started).
  const computeRectangleResult = useCallback(
    (base: Set<number>, anchor: CellPos, current: CellPos, fillValue: boolean): Set<number> => {
      const dIdxA = days.indexOf(anchor.day)
      const dIdxB = days.indexOf(current.day)
      if (dIdxA === -1 || dIdxB === -1) return base
      const dMin = Math.min(dIdxA, dIdxB)
      const dMax = Math.max(dIdxA, dIdxB)
      const rMin = Math.min(anchor.slotOfDay, current.slotOfDay)
      const rMax = Math.max(anchor.slotOfDay, current.slotOfDay)
      const next = new Set(base)
      for (let di = dMin; di <= dMax; di++) {
        const col = grid.get(days[di])
        if (!col) continue
        for (let r = rMin; r <= rMax; r++) {
          const info = col[r]
          if (!info || info.status === 'nonexistent') continue
          if (fillValue) next.add(info.index)
          else next.delete(info.index)
        }
      }
      return next
    },
    [days, grid],
  )

  const applyRectangle = useCallback(
    (anchor: CellPos, current: CellPos, fillValue: boolean) => {
      onChange(computeRectangleResult(mySlots, anchor, current, fillValue))
    },
    [mySlots, onChange, computeRectangleResult],
  )

  const handlePointerDown = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      if (mode !== 'edit' || e.button !== 0) return
      const el = e.currentTarget
      const day = Number(el.dataset.day)
      const slotOfDay = Number(el.dataset.slot)
      const status = el.dataset.status
      const info = grid.get(day)?.[slotOfDay]
      if (!info) return
      el.focus()
      setFocusPos({ day, slotOfDay })
      if (status === 'nonexistent') {
        // A nonexistent slot can never be in mySlots, so it must never become
        // the rectangle anchor — that would force fillValue to always be "add".
        return
      }
      if (e.shiftKey) {
        const anchorInfo = grid.get(anchorPos.day)?.[anchorPos.slotOfDay]
        const fillValue = anchorInfo ? !mySlots.has(anchorInfo.index) : !mySlots.has(info.index)
        applyRectangle(anchorPos, { day, slotOfDay }, fillValue)
        return
      }
      const anchor: CellPos = { day, slotOfDay }
      setAnchorPos(anchor)
      shiftFillRef.current = null
      const fillValue = !mySlots.has(info.index)
      const base = new Set(mySlots)
      const state: DragState = {
        anchor,
        paintValue: fillValue,
        base,
        slots: computeRectangleResult(base, anchor, anchor, fillValue),
      }
      dragRef.current = state
      setDrag(state)
      gridRef.current?.setPointerCapture(e.pointerId)
      // Attach commit listeners NOW, not in an effect after the next render —
      // a drag that ends within the same frame must still commit.
      const finish = (): void => {
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
        const d = dragRef.current
        if (!d) return
        dragRef.current = null
        setDrag(null)
        onChangeRef.current(d.slots)
      }
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    },
    [mode, grid, mySlots, anchorPos, applyRectangle, computeRectangleResult],
  )

  const handlePointerMove = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      const prev = dragRef.current
      if (!prev) return
      // elementFromPoint (not the sampled move event's own target) so fast or
      // batched pointermove events still resolve a real cell; the resulting
      // rectangle between drag.anchor and this cell is what gets painted, not
      // just the individual sampled cell, so skipped-over cells during a fast
      // drag are still filled.
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const cellEl = el?.closest<HTMLElement>('[data-index]')
      if (!cellEl) return
      const day = Number(cellEl.dataset.day)
      const slotOfDay = Number(cellEl.dataset.slot)
      if (Number.isNaN(day) || Number.isNaN(slotOfDay)) return
      const next: DragState = {
        ...prev,
        slots: computeRectangleResult(prev.base, prev.anchor, { day, slotOfDay }, prev.paintValue),
      }
      dragRef.current = next
      setDrag(next)
    },
    [computeRectangleResult],
  )

  const handleKeyDown = useCallback(
    (e: RKeyboardEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const day = Number(el.dataset.day)
      const slotOfDay = Number(el.dataset.slot)

      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        if (mode !== 'edit') return
        const info = grid.get(day)?.[slotOfDay]
        if (!info || info.status === 'nonexistent') return
        const next = new Set(mySlots)
        if (next.has(info.index)) next.delete(info.index)
        else next.add(info.index)
        onChange(next)
        setAnchorPos({ day, slotOfDay })
        shiftFillRef.current = null
        return
      }

      let nextDay = day
      let nextSlot = slotOfDay
      const dIdx = days.indexOf(day)
      switch (e.key) {
        case 'ArrowUp':
          nextSlot = Math.max(0, slotOfDay - 1)
          break
        case 'ArrowDown':
          nextSlot = Math.min(slotsPerDayCount - 1, slotOfDay + 1)
          break
        case 'ArrowLeft':
          nextDay = days[Math.max(0, dIdx - 1)] ?? day
          break
        case 'ArrowRight':
          nextDay = days[Math.min(days.length - 1, dIdx + 1)] ?? day
          break
        default:
          return
      }
      e.preventDefault()
      if (nextDay === day && nextSlot === slotOfDay) return

      if (e.shiftKey && mode === 'edit') {
        if (shiftFillRef.current === null) {
          const anchorInfo = grid.get(anchorPos.day)?.[anchorPos.slotOfDay]
          shiftFillRef.current = anchorInfo ? !mySlots.has(anchorInfo.index) : true
        }
        applyRectangle(anchorPos, { day: nextDay, slotOfDay: nextSlot }, shiftFillRef.current)
      } else {
        shiftFillRef.current = null
        // Same guard as pointer-down/Space: a nonexistent cell can never be
        // in mySlots, so it must never become the rectangle anchor.
        if (grid.get(nextDay)?.[nextSlot]?.status !== 'nonexistent') {
          setAnchorPos({ day: nextDay, slotOfDay: nextSlot })
        }
      }
      setFocusPos({ day: nextDay, slotOfDay: nextSlot })
      cellRefs.current.get(cellKey(nextDay, nextSlot))?.focus()
    },
    [mode, grid, mySlots, onChange, days, slotsPerDayCount, anchorPos, applyRectangle],
  )

  const handleCellFocus = useCallback((e: RFocusEvent<HTMLDivElement>) => {
    const day = Number(e.currentTarget.dataset.day)
    const slotOfDay = Number(e.currentTarget.dataset.slot)
    setFocusPos({ day, slotOfDay })
  }, [])

  const handleContainerFocus = useCallback(() => setHasDomFocus(true), [])
  const handleContainerBlur = useCallback((e: RFocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHasDomFocus(false)
  }, [])

  const handleCellHoverEnter = useCallback((e: RPointerEvent<HTMLDivElement>) => {
    const day = Number(e.currentTarget.dataset.day)
    const slotOfDay = Number(e.currentTarget.dataset.slot)
    setHoverCell({ day, slotOfDay })
  }, [])
  const handleCellHoverLeave = useCallback(() => setHoverCell(null), [])

  const activeRibbonCell: CellPos | null =
    mode === 'group' ? hoverCell ?? (hasDomFocus ? focusPos : null) : null

  const windowInfo: WindowInfo | null = useMemo(() => {
    // Nothing to summarize with zero participants — suppress the ribbon entirely.
    if (!activeRibbonCell || participantSlotSets.length === 0) return null
    const col = grid.get(activeRibbonCell.day)
    if (!col) return null
    const idxs: number[] = []
    let hasNonexistent = false
    for (let i = 0; i < windowLen; i++) {
      const s = activeRibbonCell.slotOfDay + i
      if (s >= slotsPerDayCount) break
      const info = col[s]
      if (!info) continue
      if (info.status === 'nonexistent') hasNonexistent = true
      idxs.push(info.index)
    }
    if (idxs.length === 0) return null
    // A window spanning a DST-gap slot can never be a real candidate (mirrors
    // rankCandidates skipping nonexistent slots) — don't compute a count for
    // it, since every participant would trivially show as "missing" that slot.
    let count = 0
    const missing: string[] = []
    if (!hasNonexistent) {
      for (const p of participantSlotSets) {
        if (idxs.every((ix) => p.slots.has(ix))) count++
        else missing.push(p.name)
      }
    }
    return {
      day: activeRibbonCell.day,
      slotOfDay: activeRibbonCell.slotOfDay,
      span: idxs.length,
      truncated: idxs.length < windowLen || hasNonexistent,
      invalid: hasNonexistent,
      count,
      total: participantSlotSets.length,
      missing,
    }
  }, [activeRibbonCell, grid, windowLen, slotsPerDayCount, participantSlotSets])

  const totalParticipants = participants.length

  function renderCell(day: number, slotOfDay: number, hourStart: boolean, colIdx: number) {
    const info = grid.get(day)?.[slotOfDay]
    const key = cellKey(day, slotOfDay)
    const borderTop = hourStart ? 'border-t-2 border-t-ink/30' : 'border-t border-t-rule'
    if (!info) {
      return (
        <div
          key={key}
          style={{ gridColumn: colIdx + 2, gridRow: slotOfDay + 2 }}
          className={`border-l border-rule bg-ground ${borderTop}`}
        />
      )
    }
    const isNonexistent = info.status === 'nonexistent'
    const isAmbiguous = info.status === 'ambiguous'
    const isFocused = focusPos.day === day && focusPos.slotOfDay === slotOfDay
    const isFree = effectiveSlots.has(info.index)
    const vLabel = viewerLabels.get(info.index)
    const showDeltaBadge = !!vLabel && vLabel.dayDelta !== 0
    const stat = mode === 'group' ? cellStats.get(info.index) : undefined
    // The shared row gutter label is only computed from the first enabled
    // column, so a per-cell time is the authoritative source once a DST
    // transition mid-week makes another column diverge from it.
    const timeLabel = formatViewerTime(vLabel)

    let bgStyle: string | undefined
    let bgClass = ''
    if (isNonexistent) {
      bgClass = 'bg-hatched bg-ground'
    } else if (mode === 'edit') {
      bgClass = isFree ? 'bg-signal' : 'bg-white'
    } else {
      const alpha = stat && totalParticipants > 0 ? stat.count / totalParticipants : 0
      bgStyle = `rgba(14,124,134,${alpha})`
    }

    return (
      <div
        key={key}
        ref={(el) => {
          if (el) cellRefs.current.set(key, el)
          else cellRefs.current.delete(key)
        }}
        role="gridcell"
        aria-selected={mode === 'edit' ? isFree : undefined}
        aria-disabled={isNonexistent ? true : undefined}
        data-index={info.index}
        data-day={day}
        data-slot={slotOfDay}
        data-status={info.status}
        tabIndex={isFocused ? 0 : -1}
        title={
          isNonexistent
            ? 'This hour does not exist (clock change).'
            : isAmbiguous
              ? `Clock changes here. Confirm with attendees. Your local time: ${timeLabel}`
              : mode === 'edit'
                ? timeLabel
                : undefined
        }
        style={{ backgroundColor: bgStyle, gridColumn: colIdx + 2, gridRow: slotOfDay + 2 }}
        className={[
          'group relative border-l border-rule outline-none',
          borderTop,
          bgClass,
          isNonexistent ? 'cursor-not-allowed' : mode === 'edit' ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
        onPointerDown={handlePointerDown}
        onPointerEnter={mode === 'group' ? handleCellHoverEnter : undefined}
        onPointerLeave={mode === 'group' ? handleCellHoverLeave : undefined}
        onFocus={handleCellFocus}
        onKeyDown={handleKeyDown}
      >
        {isAmbiguous && (
          <span className="pointer-events-none absolute right-0.5 top-0.5 text-[9px] font-bold leading-none text-alert">
            !
          </span>
        )}
        {showDeltaBadge && (
          <span className="pointer-events-none absolute bottom-0.5 left-0.5 text-[8px] font-mono leading-none text-ink/50">
            {vLabel!.dayDelta > 0 ? '+1' : '-1'}
          </span>
        )}
        {mode === 'group' && !isNonexistent && stat && totalParticipants > 0 && (
          <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden -translate-x-1/2 whitespace-nowrap border border-ink/30 bg-ink px-2 py-1 font-mono text-[11px] text-ground group-hover:block group-focus:block">
            <div className="text-ground/70">{timeLabel}</div>
            <div>
              {stat.count}/{totalParticipants} free
            </div>
            {stat.missing.length > 0 && (
              <div className="text-signal-light">missing: {stat.missing.join(', ')}</div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (days.length === 0) {
    return (
      <div className="border border-rule bg-ground p-4 text-sm text-ink/60">
        No days enabled for this event.
      </div>
    )
  }

  let ribbonNode: JSX.Element | null = null
  if (windowInfo) {
    const colIdx = days.indexOf(windowInfo.day)
    if (colIdx !== -1) {
      const rowStart = windowInfo.slotOfDay + 2
      // Invalid (spans a DST-gap slot) windows get a dimmed bracket with no
      // chip — a count would be meaningless there.
      const chipText = windowInfo.invalid
        ? null
        : windowInfo.missing.length > 0
          ? `${windowInfo.count}/${windowInfo.total} · missing: ${windowInfo.missing.join(', ')}`
          : `${windowInfo.count}/${windowInfo.total} · everyone free`
      ribbonNode = (
        <div
          aria-hidden="true"
          className="pointer-events-none relative"
          style={{
            gridColumn: colIdx + 2,
            gridRow: `${rowStart} / span ${windowInfo.span}`,
            opacity: windowInfo.truncated ? 0.45 : 1,
          }}
        >
          <div className="absolute inset-y-0 left-0 w-0.5 bg-ink" />
          <div className="absolute inset-y-0 right-0 w-0.5 bg-ink" />
          <div className="absolute -left-1 -right-1 top-0 h-0.5 bg-ink" />
          <div className="absolute -left-1 -right-1 bottom-0 h-0.5 bg-ink" />
          {chipText && (
            <div
              className="absolute left-0 top-0 z-30 max-w-[13rem] -translate-y-[70%] truncate bg-ink px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ground"
              title={chipText}
            >
              {chipText}
            </div>
          )}
        </div>
      )
    }
  }

  return (
    <div className="w-full overflow-x-auto">
      <div
        ref={gridRef}
        role="grid"
        aria-rowcount={slotsPerDayCount + 1}
        aria-colcount={days.length + 1}
        aria-label="Availability grid"
        className="grid select-none bg-ground"
        style={{
          gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(2rem, auto)',
          minWidth: `calc(3.5rem + ${days.length * 3}rem)`,
          touchAction: mode === 'edit' ? 'none' : undefined,
        }}
        onPointerMove={handlePointerMove}
        onFocus={handleContainerFocus}
        onBlur={handleContainerBlur}
      >
        <div role="row" className="contents">
          <div
            role="columnheader"
            aria-hidden="true"
            style={{ gridColumn: 1, gridRow: 1 }}
            className="border-b border-rule bg-ground"
          />
          {days.map((day, i) => (
            <div
              key={`h-${day}`}
              role="columnheader"
              style={{ gridColumn: i + 2, gridRow: 1 }}
              className="border-b border-l border-rule bg-ground px-1 py-1.5 text-center font-mono text-[11px] font-semibold uppercase tracking-wide text-ink"
            >
              {eventDayLabel(cfg, day)}
            </div>
          ))}
        </div>

        {Array.from({ length: slotsPerDayCount }, (_, slotOfDay) => {
          const hourStart = isHourBoundary(cfg, slotOfDay)
          const gutterInfo = grid.get(days[0])?.[slotOfDay]
          const gutterLabel = gutterInfo ? viewerLabels.get(gutterInfo.index) : undefined
          return (
            <div role="row" className="contents" key={`r-${slotOfDay}`}>
              <div
                role="rowheader"
                style={{ gridColumn: 1, gridRow: slotOfDay + 2 }}
                className={`flex items-start justify-end bg-ground pr-1.5 pt-0.5 font-mono text-[10px] text-ink/70 ${
                  hourStart ? 'border-t-2 border-t-ink/30' : 'border-t border-t-rule'
                }`}
              >
                {hourStart && gutterLabel && (
                  <span className="inline-flex items-baseline gap-0.5">
                    {gutterLabel.time}
                    {gutterLabel.dayDelta !== 0 && (
                      <sup className="text-[8px] text-ink/50">
                        {gutterLabel.dayDelta > 0 ? '+1' : '-1'}
                      </sup>
                    )}
                  </span>
                )}
              </div>
              {days.map((day, colIdx) => renderCell(day, slotOfDay, hourStart, colIdx))}
            </div>
          )
        })}

        {ribbonNode}
      </div>
    </div>
  )
}
