import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatRoomCode } from '../lib/tokens'

interface HeaderProps {
  /** Event title shown next to the wordmark, e.g. on EventPage. */
  title?: string
  /** Raw (unformatted) room code; rendered with formatRoomCode. */
  roomCode?: string
  /** Right-aligned slot, e.g. TzSelect. */
  right?: ReactNode
}

export default function Header({ title, roomCode, right }: HeaderProps): JSX.Element {
  return (
    <header className="border-b border-rule bg-ground">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/"
            className="shrink-0 font-display text-lg font-bold tracking-[-0.03em] text-ink"
          >
            sync
          </Link>
          {title && (
            <>
              <span className="hidden text-rule sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="truncate font-display text-base font-bold text-ink sm:text-lg">{title}</h1>
            </>
          )}
          {roomCode && (
            <span className="shrink-0 font-mono text-xs text-ink/60 sm:text-sm">
              {formatRoomCode(roomCode)}
            </span>
          )}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
    </header>
  )
}
