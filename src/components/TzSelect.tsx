import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

interface TzSelectProps {
  value: string
  onChange: (tz: string) => void
}

const FALLBACK_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'America/Toronto',
  'America/Vancouver',
  'America/Bogota',
  'America/Halifax',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
  'Pacific/Honolulu',
]

function getAllZones(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      const zones = Intl.supportedValuesOf('timeZone')
      if (zones.length > 0) return zones
    }
  } catch {
    // fall through to curated list
  }
  return FALLBACK_ZONES
}

export default function TzSelect({ value, onChange }: TzSelectProps): JSX.Element {
  const zones = useMemo(getAllZones, [])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const source = q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones
    return source.slice(0, 50)
  }, [zones, query])

  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function openDropdown(): void {
    setOpen(true)
    setQuery('')
    setHighlight(0)
  }

  function commit(tz: string): void {
    onChange(tz)
    setOpen(false)
    setQuery('')
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const z = filtered[highlight]
      if (z) commit(z)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            openDropdown()
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 border border-rule bg-white px-3 py-1.5 font-mono text-sm text-ink"
      >
        <span>{value}</span>
        <span aria-hidden="true" className="text-ink/50">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 max-w-[90vw] border border-rule bg-white">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlight(0)
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search time zones…"
            aria-label="Search time zones"
            className="w-full border-b border-rule px-3 py-2 font-mono text-sm text-ink outline-none"
          />
          <ul role="listbox" className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && <li className="px-3 py-2 font-mono text-sm text-ink/50">No matches</li>}
            {filtered.map((z, i) => (
              <li
                key={z}
                role="option"
                aria-selected={z === value}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(z)}
                className={`cursor-pointer px-3 py-1.5 font-mono text-sm ${
                  i === highlight ? 'bg-signal text-white' : 'text-ink'
                }`}
              >
                {z}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
