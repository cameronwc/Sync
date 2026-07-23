// Slug/token generation and room-code normalization. Slugs and tokens are
// security-relevant (they gate write access to an event/participant), so
// randomness MUST come from crypto.getRandomValues — never Math.random,
// which is not cryptographically secure and is predictable across calls.

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_SIZE = BASE58_ALPHABET.length // 58

// 256 / 58 = 4.4137..., so 4 * 58 = 232 is the largest multiple of 58 that
// fits in a byte. Bytes >= 232 are rejected and re-drawn so every accepted
// byte falls in [0, 232) and maps to exactly 4 alphabet indices apiece.
// Without this rejection step, byte % 58 would give the 24 leftover values
// (232..255) an extra chance to land on indices 0..23, a modulo bias.
const REJECTION_THRESHOLD = BASE58_SIZE * 4 // 232

function randomBase58Char(): string {
  const buf = new Uint8Array(1)
  let byte: number
  do {
    crypto.getRandomValues(buf)
    byte = buf[0] as number
  } while (byte >= REJECTION_THRESHOLD)
  return BASE58_ALPHABET[byte % BASE58_SIZE] as string
}

function randomBase58(length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += randomBase58Char()
  }
  return out
}

export function genSlug(): string {
  return randomBase58(16)
}

export function genToken(): string {
  return randomBase58(32)
}

/**
 * Normalizes a user-typed room code: uppercase, strip whitespace/dashes, and
 * correct the visually-confusable characters that are excluded from the
 * base58 alphabet room codes are drawn from (I/L -> 1, O -> 0).
 */
export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}

export function formatRoomCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}
