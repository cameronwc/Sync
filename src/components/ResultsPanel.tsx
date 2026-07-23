import { useMemo } from 'react'
import type { Candidate, GridConfig, ParticipantPublic, SlotInfo } from '../lib/types'
import { fmtInstant, fmtTimeRange } from '../lib/slots'
import { rankCandidates } from '../lib/rank'

interface ResultsPanelProps {
  cfg: GridConfig
  table: SlotInfo[]
  participants: ParticipantPublic[]
  viewerTz: string
  adminMode: boolean
  onPick: (c: Candidate) => void
  finalized: boolean
}

const TOP_N = 8

interface CandidateCardProps {
  c: Candidate
  isFull: boolean
  viewerTz: string
  adminMode: boolean
  finalized: boolean
  onPick: (c: Candidate) => void
}

function CandidateCard({ c, isFull, viewerTz, adminMode, finalized, onPick }: CandidateCardProps): JSX.Element {
  return (
    <li className="card p-4">
      <div className="font-mono text-base font-medium text-ink">{fmtInstant(c.startUtc, viewerTz)}</div>
      <div className="font-mono text-sm text-ink/60">{fmtTimeRange(c.startUtc, c.endUtc, viewerTz)}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`chip ${isFull ? 'chip-solid' : ''}`}>
          {c.count}/{c.total}
        </span>
        <span className="text-sm text-ink/60">available</span>
      </div>
      {c.missing.length > 0 && (
        <div className="mt-1.5 text-xs text-alert">missing: {c.missing.join(', ')}</div>
      )}
      {adminMode && !finalized && (
        <button type="button" onClick={() => onPick(c)} className="btn-primary mt-3 w-full">
          Pick this time
        </button>
      )}
    </li>
  )
}

export default function ResultsPanel({
  cfg,
  table,
  participants,
  viewerTz,
  adminMode,
  onPick,
  finalized,
}: ResultsPanelProps): JSX.Element {
  const candidates = useMemo(
    () => rankCandidates(cfg, table, participants).slice(0, TOP_N),
    [cfg, table, participants]
  )

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-rule bg-white p-4">
        <p className="font-mono text-sm text-ink/60">No availability yet. Paint the grid or share the link.</p>
      </div>
    )
  }

  const full = candidates.filter((c) => c.total > 0 && c.count === c.total)
  const partial = candidates.filter((c) => !(c.total > 0 && c.count === c.total))

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Everyone can make it</h2>
        {full.length === 0 ? (
          <p className="font-mono text-xs text-ink/40">None yet.</p>
        ) : (
          <ul className="space-y-3">
            {full.map((c) => (
              <CandidateCard
                key={`${c.day}-${c.start}`}
                c={c}
                isFull
                viewerTz={viewerTz}
                adminMode={adminMode}
                finalized={finalized}
                onPick={onPick}
              />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Best partial</h2>
        {partial.length === 0 ? (
          <p className="font-mono text-xs text-ink/40">None yet.</p>
        ) : (
          <ul className="space-y-3">
            {partial.map((c) => (
              <CandidateCard
                key={`${c.day}-${c.start}`}
                c={c}
                isFull={false}
                viewerTz={viewerTz}
                adminMode={adminMode}
                finalized={finalized}
                onPick={onPick}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
