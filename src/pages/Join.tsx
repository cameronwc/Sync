import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import RoomCodeInput from '../components/RoomCodeInput'
import { resolveRoomCode } from '../lib/api'
import { normalizeRoomCode } from '../lib/tokens'

const NOT_FOUND_MESSAGE = 'No event with that code. Check the characters, or ask for the link.'

function formatForDisplay(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
  if (cleaned.length <= 4) return cleaned
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
}

export default function Join(): JSX.Element {
  const navigate = useNavigate()
  const { code: codeParam } = useParams<{ code?: string }>()
  const [code, setCode] = useState(() => (codeParam ? formatForDisplay(codeParam) : ''))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoSubmitted = useRef(false)

  async function handleResolve(raw: string): Promise<void> {
    const trimmed = raw.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      const normalized = normalizeRoomCode(trimmed)
      const slug = await resolveRoomCode(normalized)
      if (slug) {
        navigate(`/e/${slug}`)
        return
      }
      setError(NOT_FOUND_MESSAGE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not look that up right now. Try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (codeParam && !autoSubmitted.current) {
      autoSubmitted.current = true
      void handleResolve(codeParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeParam])

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="max-w-md">
          <div className="card p-5 sm:p-6">
            <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Join with a code</h1>
            <p className="mb-6 text-sm text-ink/60">Enter the 8-character code your organizer shared.</p>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleResolve(code)
              }}
              className="space-y-4"
            >
              <RoomCodeInput value={code} onChange={setCode} onSubmit={() => void handleResolve(code)} />

              {error && (
                <div role="alert" className="rounded-lg border border-alert bg-alert/5 px-3 py-2 text-sm text-alert">
                  {error}
                </div>
              )}

              {loading && <p className="text-sm text-ink/50">Looking up the code…</p>}

              <button type="submit" disabled={loading || !code.trim()} className="btn-primary w-full">
                {loading ? 'Looking…' : 'Go'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
