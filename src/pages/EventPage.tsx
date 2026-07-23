import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { DateTime } from 'luxon'
import Header from '../components/Header'
import TzSelect from '../components/TzSelect'
import ResultsPanel from '../components/ResultsPanel'
import Grid from '../components/Grid'
import ImportPanel from '../calendar/ImportPanel'
import { useViewerTz } from '../App'
import {
  fetchEvent,
  fetchParticipants,
  joinEvent,
  setAvailability,
  finalizeEvent,
  unfinalizeEvent,
} from '../lib/api'
import {
  getIdentity,
  saveIdentity,
  clearIdentity,
  getAdminToken,
  saveAdminToken,
} from '../lib/identity'
import { buildSlotTable, fmtInstant } from '../lib/slots'
import { buildIcs, downloadIcs } from '../lib/ics'
import { googleCalendarUrl, outlookUrl } from '../lib/deeplinks'
import type { Candidate, EventPublic, GridConfig, Identity, ParticipantPublic, SlotInfo } from '../lib/types'

type LoadState = 'loading' | 'ready' | 'notfound' | 'error'

export default function EventPage(): JSX.Element {
  const params = useParams<{ slug: string }>()
  const slug = params.slug ?? ''
  const { viewerTz, setViewerTz } = useViewerTz()
  const [searchParams, setSearchParams] = useSearchParams()

  const [identity, setIdentity] = useState<Identity | null>(() => getIdentity(slug))
  const [adminToken, setAdminToken] = useState<string | null>(null)

  const [event, setEvent] = useState<EventPublic | null>(null)
  const [participants, setParticipants] = useState<ParticipantPublic[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  const [mySlots, setMySlots] = useState<Set<number>>(new Set())
  // Default to 'edit' regardless of identity: a fresh visitor should meet the
  // join prompt first, not a read-only grid with no explanation.
  const [mode, setMode] = useState<'edit' | 'group'>('edit')

  const [joinName, setJoinName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const [saveError, setSaveError] = useState<string | null>(null)

  const mySlotsRef = useRef<Set<number>>(new Set())
  const identityRef = useRef<Identity | null>(identity)
  // True while a local edit to "my" row is unsaved (scheduled or in flight).
  const pendingRef = useRef(false)
  // Monotonic counter bumped on every local edit; lets a resolving save tell
  // whether a newer edit has been queued since it started.
  const editSeqRef = useRef(0)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    identityRef.current = identity
  }, [identity])

  // Pick up ?admin=... from the hash search params, persist it, then strip it from the URL.
  useEffect(() => {
    const fromUrl = searchParams.get('admin')
    if (fromUrl) {
      saveAdminToken(slug, fromUrl)
      setAdminToken(fromUrl)
      const next = new URLSearchParams(searchParams)
      next.delete('admin')
      setSearchParams(next, { replace: true })
    } else {
      setAdminToken(getAdminToken(slug))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // True set-equality between a locally-held Set and the server's slot array.
  function sameSlots(local: Set<number>, serverSlots: number[]): boolean {
    if (local.size !== serverSlots.length) return false
    for (const v of serverSlots) if (!local.has(v)) return false
    return true
  }

  // Merges a freshly-fetched participants list with local state for "my" row.
  // While a local edit is unsaved (pendingRef.current), keep showing what I
  // painted so a poll never clobbers an in-flight/queued edit — this must NOT
  // persist forever, only while dirty. Once clean, the server row is the
  // source of truth again, so resync mySlots/mySlotsRef from it too (e.g. an
  // edit saved from another tab needs to show up here).
  function mergeMine(parts: ParticipantPublic[]): ParticipantPublic[] {
    const id = identityRef.current
    if (!id) return parts
    return parts.map((p) => {
      if (p.id !== id.participantId) return p
      if (pendingRef.current) {
        return { ...p, slots: Array.from(mySlotsRef.current).sort((a, b) => a - b) }
      }
      if (!sameSlots(mySlotsRef.current, p.slots)) {
        const serverSlots = new Set(p.slots)
        mySlotsRef.current = serverSlots
        setMySlots(serverSlots)
      }
      return p
    })
  }

  // Initial load.
  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setLoadError(null)
    async function run(): Promise<void> {
      try {
        const ev = await fetchEvent(slug)
        if (cancelled) return
        if (!ev) {
          setLoadState('notfound')
          return
        }
        setEvent(ev)
        const parts = await fetchParticipants(slug)
        if (cancelled) return
        setParticipants(mergeMine(parts))
        setLoadState('ready')
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Something went wrong loading this event.')
        setLoadState('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // Poll every 15s and on window focus; never clobber my in-flight edits.
  useEffect(() => {
    if (!event?.id) return
    let cancelled = false
    async function poll(): Promise<void> {
      try {
        const [ev, parts] = await Promise.all([fetchEvent(slug), fetchParticipants(slug)])
        if (cancelled) return
        if (ev) setEvent(ev)
        setParticipants(mergeMine(parts))
      } catch {
        // transient poll failure; keep showing last known state
      }
    }
    const interval = window.setInterval(() => void poll(), 15000)
    const onFocus = (): void => void poll()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id])

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const cfg: GridConfig | null = useMemo(() => {
    if (!event) return null
    return {
      eventTz: event.event_tz,
      weekStart: event.week_start,
      slotMinutes: event.slot_minutes,
      dayStartMin: event.day_start_min,
      dayEndMin: event.day_end_min,
      daysEnabled: event.days_enabled,
      durationMinutes: event.duration_minutes,
    }
  }, [event])

  const table: SlotInfo[] = useMemo(() => (cfg ? buildSlotTable(cfg) : []), [cfg])

  const shareUrl = `${window.location.origin}${window.location.pathname}#/e/${slug}`

  const finalizedStart = event?.finalized_start ?? null
  const finalized = Boolean(finalizedStart)

  const endUtc = useMemo(() => {
    if (!event || !event.finalized_start) return null
    return DateTime.fromISO(event.finalized_start, { zone: 'utc' })
      .plus({ minutes: event.duration_minutes })
      .toISO()
  }, [event])

  const icsContent = useMemo(() => {
    if (!event || !event.finalized_start || !endUtc) return null
    return buildIcs({
      title: event.title,
      organizerName: event.organizer_name,
      startUtc: event.finalized_start,
      endUtc,
      url: shareUrl,
    })
  }, [event, endUtc, shareUrl])

  const googleUrl = useMemo(() => {
    if (!event || !event.finalized_start || !endUtc) return null
    return googleCalendarUrl({
      title: event.title,
      startUtc: event.finalized_start,
      endUtc,
      details: `Scheduled with sync · ${shareUrl}`,
    })
  }, [event, endUtc, shareUrl])

  const outlookOfficeUrl = useMemo(() => {
    if (!event || !event.finalized_start || !endUtc) return null
    return outlookUrl({
      title: event.title,
      startUtc: event.finalized_start,
      endUtc,
      details: `Scheduled with sync · ${shareUrl}`,
      host: 'office',
    })
  }, [event, endUtc, shareUrl])

  const outlookLiveUrl = useMemo(() => {
    if (!event || !event.finalized_start || !endUtc) return null
    return outlookUrl({
      title: event.title,
      startUtc: event.finalized_start,
      endUtc,
      details: `Scheduled with sync · ${shareUrl}`,
      host: 'live',
    })
  }, [event, endUtc, shareUrl])

  const adminMode = Boolean(adminToken)
  const effectiveMode: 'edit' | 'group' = finalized ? 'group' : mode
  // Join prompt shows when the visitor picked "My availability" but hasn't joined yet.
  const showJoinCard = effectiveMode === 'edit' && !identity
  // The grid itself is only truly interactive once there's an identity to save under.
  const gridMode: 'edit' | 'group' = effectiveMode === 'edit' && identity ? 'edit' : 'group'

  function commitSlots(next: Set<number>): void {
    mySlotsRef.current = next
    setMySlots(next)
    setSaveError(null)
    pendingRef.current = true
    editSeqRef.current += 1
    const seq = editSeqRef.current
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persistSlots(next, seq)
    }, 600)
  }

  async function persistSlots(next: Set<number>, seq: number): Promise<void> {
    if (!identity || !event) return
    try {
      await setAvailability(
        event.slug,
        identity.participantId,
        identity.editToken,
        Array.from(next).sort((a, b) => a - b)
      )
      // Only clear dirty if no newer edit has been queued since this save started —
      // otherwise a poll landing right now would wrongly adopt the (now-stale) row
      // this save just wrote, stomping the newer local edit still waiting to persist.
      if (editSeqRef.current === seq) {
        pendingRef.current = false
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save your availability. Try again.')
      // Leave pendingRef set: the local edit is still unsaved, so mergeMine must
      // keep substituting it rather than letting this refetch (or the next poll)
      // silently discard it. The visible saveError covers the discrepancy.
      try {
        const parts = await fetchParticipants(slug)
        setParticipants(mergeMine(parts))
      } catch {
        // best effort reconciliation
      }
    }
  }

  async function handleJoin(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!event) return
    const name = joinName.trim()
    if (!name) {
      setJoinError('Enter your name to save availability.')
      return
    }
    setJoining(true)
    setJoinError(null)
    try {
      const result = await joinEvent(event.slug, name, viewerTz)
      const newIdentity: Identity = { participantId: result.participant_id, editToken: result.edit_token, name }
      saveIdentity(event.slug, newIdentity)
      setIdentity(newIdentity)
      pendingRef.current = false
      mySlotsRef.current = new Set()
      setMySlots(new Set())
      setParticipants((prev) => {
        if (prev.some((p) => p.id === newIdentity.participantId)) return prev
        return [
          ...prev,
          {
            id: newIdentity.participantId,
            event_id: event.id,
            name: newIdentity.name,
            viewer_tz: viewerTz,
            slots: [],
            updated_at: new Date().toISOString(),
          },
        ]
      })
      setMode('edit')
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join this event. Try again.')
    } finally {
      setJoining(false)
    }
  }

  function handleNotMe(): void {
    clearIdentity(slug)
    setIdentity(null)
    pendingRef.current = false
    mySlotsRef.current = new Set()
    setMySlots(new Set())
    setMode('group')
  }

  async function refetchEvent(): Promise<void> {
    try {
      const ev = await fetchEvent(slug)
      if (ev) setEvent(ev)
    } catch {
      // next poll / manual retry will reconcile
    }
  }

  async function handlePick(c: Candidate): Promise<void> {
    if (!event || !adminToken) return
    setSaveError(null)
    try {
      await finalizeEvent(event.slug, adminToken, c.startUtc)
      await refetchEvent()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not pick this time. Try again.')
    }
  }

  async function handleUnfinalize(): Promise<void> {
    if (!event || !adminToken) return
    setSaveError(null)
    try {
      await unfinalizeEvent(event.slug, adminToken)
      await refetchEvent()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not unpick this time. Try again.')
    }
  }

  function handleDownloadIcs(): void {
    if (!icsContent) return
    downloadIcs(`sync-${slug}.ics`, icsContent)
  }

  if (loadState !== 'ready' || !event || !cfg) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-xl px-4 py-10 sm:py-14">
          {loadState === 'loading' && <p className="font-mono text-sm text-ink/50">Loading…</p>}
          {loadState === 'notfound' && (
            <div className="space-y-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Event not found</h1>
              <p className="text-sm text-ink/70">
                We could not find an event at this address. It may have been mistyped or removed.
              </p>
              <Link to="/" className="font-mono text-sm text-signal underline">
                Back to sync
              </Link>
            </div>
          )}
          {loadState === 'error' && (
            <div className="space-y-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Something went wrong</h1>
              <p className="text-sm text-ink/70">{loadError ?? 'Could not load this event. Try again.'}</p>
            </div>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Header
        title={event.title}
        roomCode={event.room_code}
        right={<TzSelect value={viewerTz} onChange={setViewerTz} />}
      />

      {viewerTz !== event.event_tz && (
        <div className="border-b border-rule bg-white px-4 py-2 text-xs text-ink/70">
          Grid is <span className="font-mono text-ink">{event.event_tz}</span>. Times shown in{' '}
          <span className="font-mono text-ink">{viewerTz}</span>.
        </div>
      )}

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {saveError && (
          <div role="alert" className="border border-alert bg-alert/5 px-3 py-2 text-sm text-alert">
            {saveError}
          </div>
        )}

        {finalized && finalizedStart && (
          <div className="space-y-4 border border-signal bg-signal/5 p-4 sm:p-6">
            <div>
              <p className="font-mono text-xs uppercase tracking-wide text-signal">Confirmed</p>
              <p className="font-mono text-xl text-ink sm:text-2xl">{fmtInstant(finalizedStart, viewerTz)}</p>
              {viewerTz !== event.event_tz && (
                <p className="font-mono text-xs text-ink/60">
                  {fmtInstant(finalizedStart, event.event_tz)} in {event.event_tz}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadIcs}
                className="border border-ink bg-white px-3 py-2 font-mono text-xs text-ink hover:bg-ink hover:text-ground"
              >
                Download .ics
              </button>
              {googleUrl && (
                <a
                  href={googleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-ink bg-white px-3 py-2 font-mono text-xs text-ink hover:bg-ink hover:text-ground"
                >
                  Add to Google Calendar
                </a>
              )}
              {outlookOfficeUrl && (
                <a
                  href={outlookOfficeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-ink bg-white px-3 py-2 font-mono text-xs text-ink hover:bg-ink hover:text-ground"
                >
                  Add to Outlook
                </a>
              )}
            </div>
            {outlookLiveUrl && (
              <a
                href={outlookLiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block font-mono text-xs text-ink/60 underline"
              >
                personal account
              </a>
            )}
            <p className="text-xs text-ink/50">
              sync does not write to anyone&apos;s calendar. Each person adds it themselves.
            </p>
            {adminMode && (
              <button type="button" onClick={() => void handleUnfinalize()} className="font-mono text-xs text-alert underline">
                unpick this time
              </button>
            )}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {!finalized && (
              <div role="radiogroup" aria-label="View mode" className="inline-flex border border-rule">
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'edit'}
                  onClick={() => setMode('edit')}
                  className={`px-4 py-2 font-mono text-xs ${
                    mode === 'edit' ? 'bg-ink text-ground' : 'bg-white text-ink/70'
                  }`}
                >
                  My availability
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'group'}
                  onClick={() => setMode('group')}
                  className={`border-l border-rule px-4 py-2 font-mono text-xs ${
                    mode === 'group' ? 'bg-ink text-ground' : 'bg-white text-ink/70'
                  }`}
                >
                  Group
                </button>
              </div>
            )}

            {mode === 'group' && !finalized && (
              <p className="text-xs text-ink/50">
                Group view is read-only. Switch to My availability to paint your times.
              </p>
            )}

            {identity && (
              <div className="flex items-center gap-2 text-xs text-ink/60">
                <span>
                  Editing as <span className="font-mono text-ink">{identity.name}</span>
                </span>
                <button type="button" onClick={handleNotMe} className="underline">
                  not you?
                </button>
              </div>
            )}

            {showJoinCard && (
              <div className="space-y-3 border border-rule bg-white p-4">
                <p className="text-sm text-ink/70">Add your name to start marking your availability.</p>
                {joinError && (
                  <div role="alert" className="border border-alert bg-alert/5 px-3 py-2 text-sm text-alert">
                    {joinError}
                  </div>
                )}
                <form onSubmit={(e) => void handleJoin(e)} className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={joinName}
                    onChange={(e) => setJoinName(e.target.value)}
                    placeholder="Your name"
                    aria-label="Your name"
                    className="flex-1 border border-rule bg-white px-3 py-2 text-sm text-ink"
                  />
                  <button
                    type="submit"
                    disabled={joining || !joinName.trim()}
                    className="shrink-0 bg-signal px-4 py-2 font-mono text-sm text-white disabled:opacity-50"
                  >
                    {joining ? 'Saving…' : `Save availability as ${joinName.trim() || '…'}`}
                  </button>
                </form>
              </div>
            )}

            {gridMode === 'edit' && !finalized && (
              <ImportPanel cfg={cfg} table={table} mySlots={mySlots} onApply={commitSlots} disabled={finalized} />
            )}

            {/* The grid is never hidden: while the join card is up (no identity, "My
                availability" tab), it still renders underneath in dimmed, read-only
                group mode so a fresh visitor sees what they're about to join. */}
            <div className={showJoinCard ? 'pointer-events-none opacity-60' : undefined}>
              <Grid
                cfg={cfg}
                table={table}
                viewerTz={viewerTz}
                mode={gridMode}
                mySlots={mySlots}
                onChange={gridMode === 'edit' ? commitSlots : () => {}}
                participants={participants}
              />
            </div>
          </div>

          <div>
            <ResultsPanel
              cfg={cfg}
              table={table}
              participants={participants}
              viewerTz={viewerTz}
              adminMode={adminMode}
              onPick={(c) => void handlePick(c)}
              finalized={finalized}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
