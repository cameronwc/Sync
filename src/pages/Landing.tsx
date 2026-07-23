import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import RoomCodeInput from '../components/RoomCodeInput'
import { useViewerTz } from '../App'
import { genSlug } from '../lib/tokens'
import { mondayOf, nextMonday } from '../lib/slots'
import { createEvent } from '../lib/api'
import { saveAdminToken } from '../lib/identity'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180]
const SLOT_OPTIONS = [15, 30, 60]
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30)

function timeLabel(min: number): string {
  const h = Math.floor(min / 60)
    .toString()
    .padStart(2, '0')
  const m = (min % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

export default function Landing(): JSX.Element {
  const navigate = useNavigate()
  const { viewerTz } = useViewerTz()

  const [joinCode, setJoinCode] = useState('')

  const [title, setTitle] = useState('')
  const [organizerName, setOrganizerName] = useState('')
  const [pickedDate, setPickedDate] = useState<string>(nextMonday())
  const [duration, setDuration] = useState(30)
  const [dayStart, setDayStart] = useState(8 * 60)
  const [dayEnd, setDayEnd] = useState(18 * 60)
  const [slotMinutes, setSlotMinutes] = useState(30)
  const [daysEnabled, setDaysEnabled] = useState<number[]>([0, 1, 2, 3, 4])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const weekStart = useMemo(() => mondayOf(pickedDate), [pickedDate])

  function toggleDay(i: number): void {
    setDaysEnabled((prev) =>
      prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i].sort((a, b) => a - b)
    )
  }

  function handleJoinSubmit(): void {
    const code = joinCode.trim()
    if (!code) return
    navigate(`/join/${encodeURIComponent(code)}`)
  }

  function validate(): string | null {
    if (!title.trim()) return 'Give the event a title before creating it.'
    if (!organizerName.trim()) return 'Enter your name so participants know who is organizing.'
    if (duration < 15 || duration > 480) return 'Meeting duration must be between 15 and 480 minutes.'
    if (dayStart >= dayEnd) return 'The daily window start must be before the end.'
    if ((dayEnd - dayStart) % slotMinutes !== 0) {
      return 'The daily window must divide evenly by the slot size. Adjust the window or the granularity.'
    }
    if (daysEnabled.length === 0) return 'Pick at least one day of the week.'
    return null
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const slug = genSlug()
      const result = await createEvent({
        slug,
        title: title.trim(),
        organizer_name: organizerName.trim(),
        event_tz: viewerTz,
        week_start: weekStart,
        duration_minutes: duration,
        slot_minutes: slotMinutes,
        day_start_min: dayStart,
        day_end_min: dayEnd,
        days_enabled: daysEnabled,
      })
      saveAdminToken(slug, result.admin_token)
      navigate(`/e/${slug}/created`, {
        state: { room_code: result.room_code, admin_token: result.admin_token },
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong creating the event. Check the fields and try again.'
      )
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-10 sm:py-14">
      <div className="mb-10">
        <h1 className="font-display text-4xl font-bold tracking-[-0.03em] text-ink sm:text-5xl">sync</h1>
        <p className="mt-1 font-mono text-xs uppercase tracking-[0.12em] text-ink/60 sm:text-sm">
          SCHEDULE YOUR NEXT CALL
        </p>
      </div>

      <section className="mb-10 border border-rule bg-white p-4">
        <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-tight text-ink">
          Join with a code
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <RoomCodeInput value={joinCode} onChange={setJoinCode} onSubmit={handleJoinSubmit} />
          <button
            type="button"
            onClick={handleJoinSubmit}
            disabled={!joinCode.trim()}
            className="shrink-0 border border-ink bg-ink px-4 py-2 font-mono text-sm text-ground disabled:opacity-40"
          >
            Join
          </button>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="space-y-6 border border-rule bg-white p-4 sm:p-6">
        <h2 className="font-display text-sm font-bold uppercase tracking-tight text-ink">
          Create an event
        </h2>

        {error && (
          <div role="alert" className="border border-alert bg-alert/5 px-3 py-2 text-sm text-alert">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="title" className="mb-1 block font-mono text-xs uppercase tracking-wide text-ink/60">
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Q3 planning sync"
            className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink"
          />
        </div>

        <div>
          <label htmlFor="organizer" className="mb-1 block font-mono text-xs uppercase tracking-wide text-ink/60">
            Your name
          </label>
          <input
            id="organizer"
            type="text"
            value={organizerName}
            onChange={(e) => setOrganizerName(e.target.value)}
            placeholder="Jordan"
            className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink"
          />
        </div>

        <div>
          <label htmlFor="week" className="mb-1 block font-mono text-xs uppercase tracking-wide text-ink/60">
            Target week
          </label>
          <input
            id="week"
            type="date"
            value={pickedDate}
            onChange={(e) => setPickedDate(e.target.value || nextMonday())}
            className="w-full border border-rule bg-white px-3 py-2 font-mono text-sm text-ink"
          />
          <p className="mt-1 font-mono text-xs text-ink/50">Week of Mon {weekStart}</p>
        </div>

        <div>
          <label htmlFor="duration" className="mb-1 block font-mono text-xs uppercase tracking-wide text-ink/60">
            Meeting duration
          </label>
          <select
            id="duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full border border-rule bg-white px-3 py-2 font-mono text-sm text-ink"
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="mb-1 block font-mono text-xs uppercase tracking-wide text-ink/60">Daily window</span>
          <div className="flex items-center gap-2">
            <select
              aria-label="Window start"
              value={dayStart}
              onChange={(e) => setDayStart(Number(e.target.value))}
              className="w-full border border-rule bg-white px-3 py-2 font-mono text-sm text-ink"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {timeLabel(t)}
                </option>
              ))}
            </select>
            <span className="text-ink/40">–</span>
            <select
              aria-label="Window end"
              value={dayEnd}
              onChange={(e) => setDayEnd(Number(e.target.value))}
              className="w-full border border-rule bg-white px-3 py-2 font-mono text-sm text-ink"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {timeLabel(t)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="slot" className="mb-1 block font-mono text-xs uppercase tracking-wide text-ink/60">
            Slot granularity
          </label>
          <select
            id="slot"
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(Number(e.target.value))}
            className="w-full border border-rule bg-white px-3 py-2 font-mono text-sm text-ink"
          >
            {SLOT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} min
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="mb-1 block font-mono text-xs uppercase tracking-wide text-ink/60">Days of week</span>
          <div role="group" aria-label="Days of week" className="flex flex-wrap gap-2">
            {DAY_LABELS.map((label, i) => {
              const active = daysEnabled.includes(i)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleDay(i)}
                  className={`border px-3 py-1.5 font-mono text-xs ${
                    active ? 'border-signal bg-signal text-white' : 'border-rule bg-white text-ink/70'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <p className="font-mono text-xs text-ink/50">
          Event time zone: <span className="text-ink">{viewerTz}</span> (your current zone)
        </p>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-signal px-4 py-2.5 font-mono text-sm text-white disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create event'}
        </button>
      </form>
    </main>
  )
}
