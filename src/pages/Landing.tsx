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
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="max-w-xl">
        <div className="mb-10 sm:mb-12">
          <h1 className="font-display text-[3.5rem] font-semibold leading-none text-ink">sync</h1>
          <p className="mt-3 font-body text-ink/60">Schedule your next call.</p>
        </div>

        <section className="card mb-10 p-4 sm:mb-12 sm:p-5">
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">Join with a code</h2>
          <div className="flex flex-row items-stretch gap-2">
            <RoomCodeInput value={joinCode} onChange={setJoinCode} onSubmit={handleJoinSubmit} />
            <button type="button" onClick={handleJoinSubmit} disabled={!joinCode.trim()} className="btn-primary shrink-0">
              Join
            </button>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="card space-y-6 p-4 sm:p-6">
          <h2 className="font-display text-lg font-semibold text-ink">Create an event</h2>

          {error && (
            <div role="alert" className="rounded-lg border border-alert bg-alert/5 px-3 py-2 text-sm text-alert">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="title" className="field-label">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Q3 planning sync"
              className="field-input"
            />
          </div>

          <div>
            <label htmlFor="organizer" className="field-label">
              Your name
            </label>
            <input
              id="organizer"
              type="text"
              value={organizerName}
              onChange={(e) => setOrganizerName(e.target.value)}
              placeholder="Jordan"
              className="field-input"
            />
          </div>

          <div>
            <label htmlFor="week" className="field-label">
              Target week
            </label>
            <input
              id="week"
              type="date"
              value={pickedDate}
              onChange={(e) => setPickedDate(e.target.value || nextMonday())}
              className="field-input font-mono"
            />
            <p className="mt-1.5 font-mono text-xs text-ink/50">Week of Mon {weekStart}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="duration" className="field-label">
                Meeting duration
              </label>
              <select
                id="duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="field-input field-select font-mono"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="slot" className="field-label">
                Slot granularity
              </label>
              <select
                id="slot"
                value={slotMinutes}
                onChange={(e) => setSlotMinutes(Number(e.target.value))}
                className="field-input field-select font-mono"
              >
                {SLOT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s} min
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="field-label">Daily window</span>
            <div className="grid grid-cols-2 gap-3">
              <select
                aria-label="Window start"
                value={dayStart}
                onChange={(e) => setDayStart(Number(e.target.value))}
                className="field-input field-select font-mono"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {timeLabel(t)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Window end"
                value={dayEnd}
                onChange={(e) => setDayEnd(Number(e.target.value))}
                className="field-input field-select font-mono"
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
            <span className="field-label">Days of week</span>
            <div role="group" aria-label="Days of week" className="grid grid-cols-7 gap-1.5">
              {DAY_LABELS.map((label, i) => {
                const active = daysEnabled.includes(i)
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleDay(i)}
                    className={`rounded-full border py-1.5 text-center font-mono text-xs transition-colors duration-150 ${
                      active ? 'border-signal bg-signal text-white' : 'border-rule bg-white text-ink/70'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <p className="text-sm text-ink/60">
            Event time zone: <span className="font-mono text-ink">{viewerTz}</span> (your current zone)
          </p>

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Creating…' : 'Create event'}
          </button>
        </form>
      </div>
    </main>
  )
}
