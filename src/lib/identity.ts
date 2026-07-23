// localStorage-backed identity persistence. All keys are namespaced "sync:"
// and every access is wrapped in try/catch since private-mode Safari (and
// any environment with storage disabled) throws on read/write.
import type { Identity } from './types'

const TZ_OVERRIDE_KEY = 'sync:tzOverride'

function identityKey(slug: string): string {
  return `sync:identity:${slug}`
}

function adminTokenKey(slug: string): string {
  return `sync:admin:${slug}`
}

function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore (e.g. private-mode Safari, storage full, storage disabled)
  }
}

function safeRemoveItem(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export function getIdentity(slug: string): Identity | null {
  const raw = safeGetItem(identityKey(slug))
  if (!raw) return null
  try {
    return JSON.parse(raw) as Identity
  } catch {
    return null
  }
}

export function saveIdentity(slug: string, id: Identity): void {
  safeSetItem(identityKey(slug), JSON.stringify(id))
}

export function clearIdentity(slug: string): void {
  safeRemoveItem(identityKey(slug))
}

export function getAdminToken(slug: string): string | null {
  return safeGetItem(adminTokenKey(slug))
}

export function saveAdminToken(slug: string, token: string): void {
  safeSetItem(adminTokenKey(slug), token)
}

export function getTzOverride(): string | null {
  return safeGetItem(TZ_OVERRIDE_KEY)
}

export function saveTzOverride(tz: string | null): void {
  if (tz === null) {
    safeRemoveItem(TZ_OVERRIDE_KEY)
  } else {
    safeSetItem(TZ_OVERRIDE_KEY, tz)
  }
}

export function detectViewerTz(): string {
  const override = getTzOverride()
  if (override) return override
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz || 'UTC'
  } catch {
    return 'UTC'
  }
}
