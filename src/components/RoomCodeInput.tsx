import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react'
import { normalizeRoomCode } from '../lib/tokens'

interface RoomCodeInputProps {
  value: string
  onChange: (next: string) => void
  onSubmit?: () => void
}

/** Uppercases, strips non-alphanumerics, caps at 8 chars, inserts a dash after 4. */
function formatForDisplay(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
  if (cleaned.length <= 4) return cleaned
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
}

export default function RoomCodeInput({ value, onChange, onSubmit }: RoomCodeInputProps): JSX.Element {
  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    onChange(formatForDisplay(e.target.value))
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>): void {
    e.preventDefault()
    const text = e.clipboardData.getData('text')
    let normalized: string
    try {
      normalized = normalizeRoomCode(text)
    } catch {
      normalized = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
    }
    onChange(formatForDisplay(normalized))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit?.()
    }
  }

  return (
    <input
      type="text"
      inputMode="text"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      value={value}
      onChange={handleChange}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      placeholder="ABCD-EFGH"
      maxLength={9}
      aria-label="Room code"
      className="field-input min-w-0 font-mono text-lg tracking-wider placeholder:text-ink/30"
    />
  )
}
