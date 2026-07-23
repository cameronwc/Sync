// Hand-rolled RFC 5545 ICS generation — no external calendar library.

interface BuildIcsOptions {
  title: string
  organizerName: string
  startUtc: string
  endUtc: string
  url: string
}

const FOLD_LIMIT_OCTETS = 75

/** Escapes a TEXT value per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** Quotes a param value per RFC 5545 §3.2 if it contains COLON, SEMICOLON, or COMMA. */
function escapeParam(value: string): string {
  const cleaned = value.replace(/"/g, "'")
  return /[":;,]/.test(cleaned) ? `"${cleaned}"` : cleaned
}

/** Converts an ISO instant to ICS UTC basic format YYYYMMDDTHHMMSSZ. */
function toIcsUtc(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number, width = 2): string => n.toString().padStart(width, '0')
  const yyyy = pad(d.getUTCFullYear(), 4)
  const mm = pad(d.getUTCMonth() + 1)
  const dd = pad(d.getUTCDate())
  const hh = pad(d.getUTCHours())
  const mi = pad(d.getUTCMinutes())
  const ss = pad(d.getUTCSeconds())
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`
}

/**
 * Folds a single unfolded content line to RFC 5545 §3.1: no physical line
 * exceeds 75 octets (UTF-8 bytes), continuations are CRLF + a single space,
 * and folding never splits a multibyte character.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= FOLD_LIMIT_OCTETS) return line

  let result = ''
  let lineBytes = 0
  for (const char of line) {
    const charBytes = encoder.encode(char).length
    if (lineBytes + charBytes > FOLD_LIMIT_OCTETS) {
      result += '\r\n '
      lineBytes = 1 // the inserted leading space counts toward the next line's budget
    }
    result += char
    lineBytes += charBytes
  }
  return result
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function buildIcs(opts: BuildIcsOptions): string {
  const uid = `${randomHex(16)}@sync`
  const dtstamp = toIcsUtc(new Date().toISOString())
  const dtstart = toIcsUtc(opts.startUtc)
  const dtend = toIcsUtc(opts.endUtc)
  const description = escapeText(`Scheduled with sync · ${opts.url}`)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//sync//scheduler//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeText(opts.title)}`,
    `ORGANIZER;CN=${escapeParam(opts.organizerName)}:mailto:noreply@sync.invalid`,
    `DESCRIPTION:${description}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lines.map(foldLine).join('\r\n') + '\r\n'
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
