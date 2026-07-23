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
  viewerTz: string
  adminMode: boolean
  finalized: boolean
  onPick: (c: Candidate) => void
}

function CandidateCard({ c, viewerTz, adminMode, finalized, onPick }: CandidateCardProps): JSX.Element {
  return (
    <li className="border border-rule bg-white p-3">
      <div className="font-mono text-sm text-ink">{fmtInstant(c.startUtc, viewerTz)}</div>
      <div className="font-mono text-xs text-ink/60">{fmtTimeRange(c.startUtc, c.endUtc, viewerTz)}</div>
      <div className="mt-1 font-mono text-xs text-ink">
        {c.count}/{c.total} available
      </div>
      {c.missing.length > 0 && (
        <div className="mt-1 text-xs text-alert">missing: {c.missing.join(', ')}</div>
      )}
      {adminMode && !finalized && (
        <button
          type="button"
          onClick={() => onPick(c)}
          className="mt-2 bg-signal px-3 py-1.5 font-mono text-xs text-white hover:bg-signal/90"
        >
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
      <div className="border border-rule bg-white p-4">
        <p className="text-sm text-ink/70">No availability yet. Paint the grid or share the link.</p>
      </div>
    )
  }

  const full = candidates.filter((c) => c.total > 0 && c.count === c.total)
  const partial = candidates.filter((c) => !(c.total > 0 && c.count === c.total))

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-tight text-ink">
          Everyone can make it
        </h2>
        {full.length === 0 ? (
          <p className="font-mono text-xs text-ink/50">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {full.map((c) => (
              <CandidateCard
                key={`${c.day}-${c.start}`}
                c={c}
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
        <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-tight text-ink">Best partial</h2>
        {partial.length === 0 ? (
          <p className="font-mono text-xs text-ink/50">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {partial.map((c) => (
              <CandidateCard
                key={`${c.day}-${c.start}`}
                c={c}
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
