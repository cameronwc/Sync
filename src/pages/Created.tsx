import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Header from '../components/Header'
import CopyField from '../components/CopyField'
import { fetchEvent } from '../lib/api'
import { getAdminToken } from '../lib/identity'
import { formatRoomCode } from '../lib/tokens'
import type { EventPublic } from '../lib/types'

interface CreatedLocationState {
  room_code?: string
  admin_token?: string
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export default function Created(): JSX.Element {
  const { slug = '' } = useParams<{ slug: string }>()
  const location = useLocation()
  const state = (location.state as CreatedLocationState | null) ?? null

  const [event, setEvent] = useState<EventPublic | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchEvent(slug)
      .then((ev) => {
        if (cancelled) return
        if (!ev) setNotFound(true)
        else setEvent(ev)
      })
      .catch(() => {
        if (!cancelled) setNotFound(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const adminToken = state?.admin_token ?? getAdminToken(slug)
  const roomCode = state?.room_code ?? event?.room_code ?? null

  const origin = window.location.origin
  const pathname = window.location.pathname
  const shareUrl = `${origin}${pathname}#/e/${slug}`
  const joinUrl = `${origin}${pathname}#/join`
  const organizerUrl = adminToken ? `${shareUrl}?admin=${adminToken}` : null

  function handleDownload(): void {
    if (!adminToken || !roomCode || !organizerUrl) return
    const content = [
      `sync — ${event?.title ?? slug}`,
      '',
      `Share link: ${shareUrl}`,
      `Room code: ${formatRoomCode(roomCode)}`,
      `Organizer link (do not share): ${organizerUrl}`,
      '',
      'The organizer link is the only way back to organizer controls. Keep it.',
    ].join('\n')
    downloadText(`sync-${slug}.txt`, content)
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-xl">
          {loading ? (
            <p className="text-sm text-ink/60">Loading…</p>
          ) : notFound ? (
            <div className="space-y-3">
              <h1 className="font-display text-2xl font-semibold text-ink">Event not found</h1>
              <p className="text-sm text-ink/70">We could not find that event. It may have been mistyped.</p>
              <Link to="/" className="btn-link">
                Back to sync
              </Link>
            </div>
          ) : !adminToken || !roomCode ? (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-semibold text-ink">Event created</h1>
              <p className="text-sm text-ink/70">This link does not carry organizer access for this device.</p>
              <Link to={`/e/${slug}`} className="btn-link">
                Go to your event →
              </Link>
            </div>
          ) : (
            <div className="space-y-10">
              <div>
                <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">Your event is live</h1>
                <p className="mt-1 text-sm text-ink/60">Share the link or the code with your group.</p>
              </div>

              <div className="card space-y-4 p-4 sm:p-6">
                <CopyField label="Share link" value={shareUrl} />

                <div>
                  <CopyField label="Room code" value={formatRoomCode(roomCode)} large />
                  <p className="mt-2 text-xs text-ink/50">
                    If the link does not work, they can go to{' '}
                    <span className="font-mono text-ink/70">{joinUrl}</span> and enter this code.
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-alert/30 bg-alert/5 p-4 sm:p-6">
                <h2 className="font-display text-lg font-semibold text-alert">Organizer link</h2>
                <p className="text-xs text-alert">
                  This link is the only way back to organizer controls (picking the final time). It is not
                  recoverable if you lose it — save it now.
                </p>
                <CopyField label="Organizer link" value={organizerUrl ?? ''} />
                <button type="button" onClick={handleDownload} className="btn-secondary">
                  Download organizer link
                </button>
              </div>

              <Link to={`/e/${slug}`} className="btn-link inline-block">
                Go to your event →
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
