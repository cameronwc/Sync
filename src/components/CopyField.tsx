import { useEffect, useRef, useState } from 'react'

interface CopyFieldProps {
  label: string
  value: string
  large?: boolean
}

export default function CopyField({ label, value, large }: CopyFieldProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  function flashCopied(): void {
    setCopied(true)
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => setCopied(false), 1500)
  }

  async function handleCopy(): Promise<void> {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('no clipboard api')
      await navigator.clipboard.writeText(value)
      flashCopied()
      return
    } catch {
      // fall through to legacy fallback
    }
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
      el.setSelectionRange(0, value.length)
      try {
        document.execCommand('copy')
      } catch {
        // nothing more we can do
      }
    }
    flashCopied()
  }

  return (
    <div>
      <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-ink/60">{label}</label>
      <div className="flex items-stretch gap-2">
        <input
          ref={inputRef}
          type="text"
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`min-w-0 flex-1 border border-rule bg-white px-3 py-2 font-mono text-ink ${
            large ? 'text-2xl sm:text-3xl' : 'text-sm'
          }`}
        />
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
          className="shrink-0 border border-rule bg-white px-3 py-2 font-mono text-sm text-ink transition-colors hover:border-signal hover:bg-signal hover:text-white"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
