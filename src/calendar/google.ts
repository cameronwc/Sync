// Google Calendar busy-time import via Google Identity Services (GIS) token
// client. Popup-only OAuth: no redirect, no refresh token, no offline access.
//
// The access token lives ONLY in the module-scoped `accessToken` variable
// below. It is never written to localStorage/sessionStorage/Supabase, and it
// is not exported.
import type { BusyInterval } from '../lib/types'
import { ImportError } from './providers'

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
const FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy'
const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'
/** Refuse to reuse a token this close to expiry. */
const EXPIRY_SAFETY_MARGIN_MS = 5_000

// --- Minimal ambient types for the bits of Google Identity Services we use.
// Intentionally not a full typing of the GIS surface, and not a dependency.

interface GoogleTokenResponse {
  access_token: string
  /** seconds until expiry */
  expires_in: number
  error?: string
  error_description?: string
}

interface GoogleTokenClientError {
  type: string
  message?: string
}

interface GoogleTokenClientConfig {
  client_id: string
  scope: string
  callback: (response: GoogleTokenResponse) => void
  error_callback: (error: GoogleTokenClientError) => void
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void
}

interface GoogleAccountsOauth2 {
  initTokenClient: (config: GoogleTokenClientConfig) => GoogleTokenClient
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: GoogleAccountsOauth2
      }
    }
  }
}

interface GoogleFreeBusyResponse {
  calendars?: {
    primary?: {
      busy?: { start: string; end: string }[]
      errors?: { reason: string }[]
    }
  }
}

// --- Module-scoped, in-memory-only OAuth state.

let scriptLoadPromise: Promise<void> | null = null
let tokenClient: GoogleTokenClient | null = null
let accessToken: string | null = null
let accessTokenExpiresAt = 0

let pendingResolve: ((token: string) => void) | null = null
let pendingReject: ((error: ImportError) => void) | null = null

function settlePending(): { resolve: ((token: string) => void) | null; reject: ((error: ImportError) => void) | null } {
  const resolve = pendingResolve
  const reject = pendingReject
  pendingResolve = null
  pendingReject = null
  return { resolve, reject }
}

/** Injects the GIS script tag once and memoizes the load promise. */
function loadGsiScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = GSI_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google?.accounts?.oauth2) {
        resolve()
      } else {
        reject(new ImportError('failed', 'Google sign-in could not be loaded.'))
      }
    }
    script.onerror = () => {
      reject(new ImportError('failed', 'Google sign-in could not be loaded.'))
    }
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

function getTokenClient(): GoogleTokenClient {
  if (tokenClient) return tokenClient

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new ImportError('failed', 'Google Calendar import is not configured.')
  }

  tokenClient = window.google!.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: FREEBUSY_SCOPE,
    callback: (response) => {
      const { resolve, reject } = settlePending()
      if (response.error) {
        if (response.error === 'access_denied') {
          reject?.(new ImportError('cancelled', 'Google sign-in was cancelled.'))
        } else {
          reject?.(
            new ImportError('failed', response.error_description || 'Google sign-in failed.')
          )
        }
        return
      }
      accessToken = response.access_token
      accessTokenExpiresAt = Date.now() + response.expires_in * 1000
      resolve?.(response.access_token)
    },
    error_callback: (error) => {
      const { reject } = settlePending()
      if (error.type === 'popup_closed') {
        reject?.(new ImportError('cancelled', 'Google sign-in was cancelled.'))
      } else if (error.type === 'popup_failed_to_open') {
        reject?.(new ImportError('popup-blocked', 'The Google sign-in popup was blocked.'))
      } else {
        reject?.(new ImportError('failed', error.message || 'Google sign-in failed.'))
      }
    },
  })

  return tokenClient
}

function hasValidToken(): boolean {
  return accessToken !== null && Date.now() < accessTokenExpiresAt - EXPIRY_SAFETY_MARGIN_MS
}

async function acquireAccessToken(): Promise<string> {
  if (hasValidToken()) return accessToken!

  await loadGsiScript()
  const client = getTokenClient()

  return new Promise<string>((resolve, reject) => {
    pendingResolve = resolve
    pendingReject = reject
    client.requestAccessToken()
  })
}

/** Fetches Google Calendar busy intervals over [startUtc, endUtc). */
export async function fetchGoogleBusy(startUtc: string, endUtc: string): Promise<BusyInterval[]> {
  const token = await acquireAccessToken()

  let response: Response
  try {
    response = await fetch(FREEBUSY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        timeMin: startUtc,
        timeMax: endUtc,
        items: [{ id: 'primary' }],
      }),
    })
  } catch {
    throw new ImportError('failed', 'Could not reach Google Calendar.')
  }

  if (!response.ok) {
    // A stale/rejected token surfaces here as 401; don't reuse it.
    if (response.status === 401) {
      accessToken = null
      accessTokenExpiresAt = 0
    }
    throw new ImportError('failed', `Google Calendar returned an error (${response.status}).`)
  }

  const data = (await response.json()) as GoogleFreeBusyResponse
  const busy = data.calendars?.primary?.busy ?? []

  return busy.map((interval) => ({
    startUtc: interval.start,
    endUtc: interval.end,
    allDay: false,
  }))
}
