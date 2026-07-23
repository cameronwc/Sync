// Microsoft/Outlook Calendar busy-time import via MSAL browser, popup-only.
//
// The MSAL cache is memory-only (`cache.cacheLocation: 'memory'`), so tokens
// never touch localStorage/sessionStorage. No token is exported from this
// module; only mapped BusyInterval[] leaves fetchMicrosoftBusy.
import type { PublicClientApplication, AuthenticationResult } from '@azure/msal-browser'
import type { BusyInterval } from '../lib/types'
import { ImportError } from './providers'

const BASIC_SCOPE = 'Calendars.ReadBasic'
const FULL_SCOPE = 'Calendars.Read'
const GRAPH_CALENDARVIEW_URL = 'https://graph.microsoft.com/v1.0/me/calendarView'
const BASIC_SCOPE_REJECTED_NOTE = 'Basic calendar access was rejected by your organization. '

interface GraphDateTime {
  dateTime: string
  timeZone: string
}

interface GraphEvent {
  start: GraphDateTime
  end: GraphDateTime
  isAllDay: boolean
  showAs: string
}

interface GraphCalendarViewResponse {
  value: GraphEvent[]
  '@odata.nextLink'?: string
}

// --- Module-scoped, in-memory-only MSAL state.

let msalInstance: PublicClientApplication | null = null
let initPromise: Promise<void> | null = null
/** Set once the tenant has rejected Calendars.ReadBasic; sticky for the session. */
let basicScopeRejected = false

async function getMsalInstance(): Promise<PublicClientApplication> {
  if (msalInstance) return msalInstance

  const clientId = import.meta.env.VITE_MS_CLIENT_ID
  if (!clientId) {
    throw new ImportError('failed', 'Outlook Calendar import is not configured.')
  }

  // Dynamic import keeps MSAL out of the main bundle; it loads only when the
  // user actually starts a Microsoft import.
  const { PublicClientApplication } = await import('@azure/msal-browser')
  msalInstance = new PublicClientApplication({
    auth: {
      clientId,
      authority: 'https://login.microsoftonline.com/common',
      redirectUri: window.location.origin,
    },
    cache: {
      cacheLocation: 'memory',
    },
  })

  return msalInstance
}

async function ensureInitialized(): Promise<PublicClientApplication> {
  const instance = await getMsalInstance()
  if (!initPromise) {
    initPromise = instance.initialize()
  }
  await initPromise
  return instance
}

function currentScopes(): string[] {
  return [basicScopeRejected ? FULL_SCOPE : BASIC_SCOPE]
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** True when the failure looks like the tenant rejecting the requested scope/consent. */
function isScopeConsentError(err: unknown): boolean {
  const message = extractErrorMessage(err).toLowerCase()
  const code = (err as { errorCode?: string } | undefined)?.errorCode ?? ''
  return (
    message.includes('calendars.readbasic') ||
    message.includes('consent') ||
    message.includes('scope') ||
    code === 'consent_required' ||
    code === 'invalid_scope'
  )
}

function toImportError(err: unknown, notePrefixRejectedScope: boolean): ImportError {
  if (err instanceof ImportError) return err

  const code = (err as { errorCode?: string } | undefined)?.errorCode
  const prefix = notePrefixRejectedScope ? BASIC_SCOPE_REJECTED_NOTE : ''

  if (code === 'user_cancelled') {
    return new ImportError('cancelled', `${prefix}Sign-in was cancelled.`)
  }
  if (code === 'popup_window_error' || code === 'empty_window_error') {
    return new ImportError('popup-blocked', `${prefix}The sign-in popup was blocked.`)
  }
  const message = extractErrorMessage(err) || 'Microsoft sign-in failed.'
  return new ImportError('failed', `${prefix}${message}`)
}

async function attemptTokenAcquisition(
  instance: PublicClientApplication,
  scopes: string[]
): Promise<AuthenticationResult> {
  const accounts = instance.getAllAccounts()
  if (accounts.length > 0) {
    try {
      return await instance.acquireTokenSilent({ scopes, account: accounts[0] })
    } catch {
      return instance.acquireTokenPopup({ scopes, account: accounts[0] })
    }
  }
  return instance.loginPopup({ scopes })
}

async function acquireGraphToken(): Promise<string> {
  const instance = await ensureInitialized()

  try {
    const result = await attemptTokenAcquisition(instance, currentScopes())
    return result.accessToken
  } catch (err) {
    if (!basicScopeRejected && isScopeConsentError(err)) {
      basicScopeRejected = true
      try {
        const retryResult = await attemptTokenAcquisition(instance, currentScopes())
        return retryResult.accessToken
      } catch (retryErr) {
        throw toImportError(retryErr, true)
      }
    }
    throw toImportError(err, basicScopeRejected)
  }
}

function buildCalendarViewUrl(startUtc: string, endUtc: string): string {
  const params = new URLSearchParams({
    startDateTime: startUtc,
    endDateTime: endUtc,
    $select: 'start,end,isAllDay,showAs',
    $top: '250',
  })
  return `${GRAPH_CALENDARVIEW_URL}?${params.toString()}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchGraphPage(url: string, token: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    })
  } catch {
    throw new ImportError('failed', 'Could not reach Outlook Calendar.')
  }
}

/**
 * Graph returns dateTime as UTC wall-clock text without a trailing Z when
 * requested with `Prefer: outlook.timezone="UTC"`. Append it before treating
 * the string as ISO-8601.
 */
function toIsoUtc(dateTime: string): string {
  return dateTime.endsWith('Z') ? dateTime : `${dateTime}Z`
}

/** Fetches Outlook Calendar busy intervals over [startUtc, endUtc). */
export async function fetchMicrosoftBusy(
  startUtc: string,
  endUtc: string
): Promise<BusyInterval[]> {
  const token = await acquireGraphToken()

  const events: GraphEvent[] = []
  let url: string | null = buildCalendarViewUrl(startUtc, endUtc)
  let throttleRetried = false

  while (url) {
    const response: Response = await fetchGraphPage(url, token)

    if (response.status === 429) {
      if (throttleRetried) {
        throw new ImportError(
          'failed',
          'Outlook Calendar is rate-limiting requests — enter times by hand.'
        )
      }
      const retryAfterHeader = response.headers.get('Retry-After')
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : 1
      const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 1000
      await delay(waitMs)
      throttleRetried = true
      continue
    }

    if (!response.ok) {
      throw new ImportError('failed', `Outlook Calendar returned an error (${response.status}).`)
    }

    const page = (await response.json()) as GraphCalendarViewResponse
    events.push(...(page.value ?? []))
    url = page['@odata.nextLink'] ?? null
  }

  return events
    .filter((event) => event.showAs !== 'free' && event.showAs !== 'workingElsewhere')
    .map((event) => ({
      startUtc: toIsoUtc(event.start.dateTime),
      endUtc: toIsoUtc(event.end.dateTime),
      allDay: event.isAllDay,
    }))
}
