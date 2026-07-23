// Provider registry. The grid never knows which provider ran — it only ever
// sees BusyInterval[] via CalendarProvider.fetchBusy.
import type { CalendarProvider } from '../lib/types'
import { fetchGoogleBusy } from './google'
import { fetchMicrosoftBusy } from './microsoft'

export type ImportErrorKind = 'cancelled' | 'popup-blocked' | 'failed'

/** Typed error surfaced by any provider's fetchBusy flow. */
export class ImportError extends Error {
  kind: ImportErrorKind

  constructor(kind: ImportErrorKind, message: string) {
    super(message)
    this.name = 'ImportError'
    this.kind = kind
  }
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Only providers whose client-ID env var is set are returned. Checked at
 * call (render) time so import.meta.env is read fresh each time.
 */
export function getProviders(): CalendarProvider[] {
  const providers: CalendarProvider[] = []

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (hasEnvValue(googleClientId)) {
    providers.push({
      id: 'google',
      label: 'Google Calendar',
      available: true,
      fetchBusy: fetchGoogleBusy,
    })
  }

  const msClientId = import.meta.env.VITE_MS_CLIENT_ID
  if (hasEnvValue(msClientId)) {
    providers.push({
      id: 'microsoft',
      label: 'Outlook Calendar',
      available: true,
      fetchBusy: fetchMicrosoftBusy,
    })
  }

  return providers
}
