// Calendar import UI. Renders nothing when no provider is configured, so the
// import buttons simply don't exist rather than being shown disabled.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarProvider, GridConfig, SlotInfo } from '../lib/types'
import { mapBusyToSlots, type BusyMapping } from './mapBusy'
import { getProviders, ImportError } from './providers'

export interface ImportPanelProps {
  cfg: GridConfig
  table: SlotInfo[]
  /** current FREE set */
  mySlots: Set<number>
  /** full replacement set */
  onApply: (next: Set<number>) => void
  disabled?: boolean
}

interface PreviewState {
  provider: CalendarProvider
  mapping: BusyMapping
}

interface Span {
  startUtc: string
  endUtc: string
}

/** [first enabled-day slot's startUtc, last enabled-day slot's endUtc]. */
function computeGridSpan(table: SlotInfo[], daysEnabled: number[]): Span | null {
  let start: SlotInfo | null = null
  let end: SlotInfo | null = null

  for (const slot of table) {
    if (!daysEnabled.includes(slot.dayOffset)) continue
    if (!start || Date.parse(slot.startUtc) < Date.parse(start.startUtc)) start = slot
    if (!end || Date.parse(slot.endUtc) > Date.parse(end.endUtc)) end = slot
  }

  if (!start || !end) return null
  return { startUtc: start.startUtc, endUtc: end.endUtc }
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export default function ImportPanel(props: ImportPanelProps): JSX.Element | null {
  const { cfg, table, mySlots, onApply, disabled = false } = props

  const providers = useMemo(() => getProviders(), [])

  const validEnabledSlots = useMemo(
    () =>
      table
        .filter(
          (slot) => slot.status !== 'nonexistent' && cfg.daysEnabled.includes(slot.dayOffset)
        )
        .map((slot) => slot.index),
    [table, cfg.daysEnabled]
  )

  const [busyProviderId, setBusyProviderId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [includeAllDay, setIncludeAllDay] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [canUndo, setCanUndo] = useState(false)

  const undoStackRef = useRef<Set<number>[]>([])
  const dialogRef = useRef<HTMLDivElement>(null)

  const previewStats = useMemo(() => {
    if (!preview) return null
    const busySet = new Set(preview.mapping.busySlots)
    const allDaySet = new Set(preview.mapping.allDayBusySlots)
    let markedUnavailable = 0
    for (const index of validEnabledSlots) {
      if (mySlots.has(index)) continue
      const isBusy = busySet.has(index) || (includeAllDay && allDaySet.has(index))
      if (isBusy) markedUnavailable += 1
    }
    return { markedUnavailable, total: validEnabledSlots.length }
  }, [preview, includeAllDay, mySlots, validEnabledSlots])

  const handleImportClick = useCallback(
    async (provider: CalendarProvider) => {
      setErrorMessage(null)
      setNoticeMessage(null)

      const span = computeGridSpan(table, cfg.daysEnabled)
      if (!span) {
        setErrorMessage('No enabled days to import into — enter times by hand.')
        return
      }

      setBusyProviderId(provider.id)
      try {
        const intervals = await provider.fetchBusy(span.startUtc, span.endUtc)
        const mapping = mapBusyToSlots(cfg, table, intervals)
        setIncludeAllDay(false)
        setPreview({ provider, mapping })
      } catch (err) {
        if (err instanceof ImportError) {
          if (err.kind === 'popup-blocked') {
            setErrorMessage(
              'Your browser blocked the sign-in window. Allow popups for this site, or fill the grid by hand.'
            )
          } else if (err.kind === 'cancelled') {
            setNoticeMessage('Sign-in was cancelled.')
          } else {
            setErrorMessage(`${err.message} — enter times by hand.`)
          }
        } else {
          setErrorMessage('Something went wrong — enter times by hand.')
        }
      } finally {
        setBusyProviderId(null)
      }
    },
    [table, cfg]
  )

  const handleApply = useCallback(() => {
    if (!preview) return
    const busySet = new Set(preview.mapping.busySlots)
    const allDaySet = new Set(preview.mapping.allDayBusySlots)

    const next = new Set(mySlots)
    for (const index of validEnabledSlots) {
      if (mySlots.has(index)) continue
      const isBusy = busySet.has(index) || (includeAllDay && allDaySet.has(index))
      if (!isBusy) next.add(index)
    }

    undoStackRef.current.push(new Set(mySlots))
    setCanUndo(true)
    onApply(next)
    setPreview(null)
  }, [preview, mySlots, includeAllDay, validEnabledSlots, onApply])

  const handleUndo = useCallback(() => {
    const previous = undoStackRef.current.pop()
    if (previous === undefined) return
    setCanUndo(undoStackRef.current.length > 0)
    onApply(previous)
  }, [onApply])

  const closePreview = useCallback(() => setPreview(null), [])

  useEffect(() => {
    if (!preview) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePreview()
        return
      }
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [preview, closePreview])

  if (providers.length === 0) return null

  return (
    <div className="font-body">
      <div className="flex flex-wrap items-center gap-2">
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            disabled={disabled || busyProviderId !== null}
            onClick={() => void handleImportClick(provider)}
            className="rounded-sm border border-signal bg-signal px-3 py-1.5 text-sm text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyProviderId === provider.id
              ? `Importing from ${provider.label}…`
              : `Import from ${provider.label}`}
          </button>
        ))}
        {canUndo && (
          <button
            type="button"
            onClick={handleUndo}
            className="rounded-sm border border-rule bg-ground px-3 py-1.5 text-sm text-ink"
          >
            Undo import
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-ink/60">
        sync reads only when you are busy, never what you are doing. Nothing about your calendar
        is stored.
      </p>

      {errorMessage && <p className="mt-1 text-xs text-alert">{errorMessage}</p>}
      {noticeMessage && <p className="mt-1 text-xs text-ink/60">{noticeMessage}</p>}

      {preview && previewStats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-preview-title"
            tabIndex={-1}
            className="w-full max-w-sm rounded-sm border border-rule bg-ground p-4 text-ink shadow-lg outline-none"
          >
            <h2 id="import-preview-title" className="font-display text-base font-semibold">
              Preview import from {preview.provider.label}
            </h2>

            <p className="mt-2 text-sm">
              Found <span className="font-mono">{preview.mapping.blockCount}</span> busy blocks.
              This marks{' '}
              <span className="font-mono">{previewStats.markedUnavailable}</span> of{' '}
              <span className="font-mono">{previewStats.total}</span> slots unavailable.
            </p>

            {preview.mapping.allDayCount > 0 && (
              <>
                <p className="mt-2 text-sm">
                  <span className="font-mono">{preview.mapping.allDayCount}</span> of these come
                  from all-day events.
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeAllDay}
                    onChange={(event) => setIncludeAllDay(event.target.checked)}
                  />
                  Include all-day events
                </label>
              </>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closePreview}
                className="rounded-sm border border-rule bg-ground px-3 py-1.5 text-sm text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-sm border border-signal bg-signal px-3 py-1.5 text-sm text-white"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
