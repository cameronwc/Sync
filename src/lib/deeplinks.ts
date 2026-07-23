// "Add to calendar" deep links for Google Calendar and Outlook.

interface GoogleCalendarOptions {
  title: string
  startUtc: string
  endUtc: string
  details: string
}

interface OutlookOptions {
  title: string
  startUtc: string
  endUtc: string
  details: string
  host: 'office' | 'live'
}

/** Converts an ISO instant to the UTC basic format Google's deep link expects. */
function toGoogleUtc(iso: string): string {
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

export function googleCalendarUrl(o: GoogleCalendarOptions): string {
  const dates = `${toGoogleUtc(o.startUtc)}/${toGoogleUtc(o.endUtc)}`
  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(o.title)}`,
    `dates=${encodeURIComponent(dates)}`,
    `details=${encodeURIComponent(o.details)}`,
  ]
  return `https://calendar.google.com/calendar/render?${params.join('&')}`
}

export function outlookUrl(o: OutlookOptions): string {
  const params = [
    'path=/calendar/action/compose',
    'rru=addevent',
    `subject=${encodeURIComponent(o.title)}`,
    `startdt=${encodeURIComponent(o.startUtc)}`,
    `enddt=${encodeURIComponent(o.endUtc)}`,
    `body=${encodeURIComponent(o.details)}`,
  ]
  return `https://outlook.${o.host}.com/calendar/0/deeplink/compose?${params.join('&')}`
}
