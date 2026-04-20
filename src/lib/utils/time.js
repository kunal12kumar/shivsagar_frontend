/**
 * time.js — IST (Asia/Kolkata, UTC+5:30) time formatting utilities.
 *
 * All timestamps from the backend are stored in UTC.
 * These helpers convert them to IST for display.
 */

const IST = 'Asia/Kolkata'

/**
 * Full date + time: "18 Apr 2026, 11:47:53 pm"
 */
export function fmtIST(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

/**
 * Time only: "11:47:53 pm"
 */
export function fmtISTTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

/**
 * Short time: "11:47 pm"
 */
export function fmtISTShort(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Relative label: "just now", "2 min ago", "1 hr ago", or full IST datetime
 */
export function fmtRelative(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)  return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} hr ago`
  return fmtIST(iso)
}
