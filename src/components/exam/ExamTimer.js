'use client'
/**
 * ExamTimer — displays the countdown to exam end.
 * Time is derived from server-provided end_time (stored in Zustand + localStorage).
 * Does NOT use the local system clock as the source of truth — only for display.
 * Turns amber at 30 min remaining, red at 10 min remaining.
 * Auto-submits when time reaches 0.
 * Shows toast warnings at 5 min, 1 min, and 30 sec remaining.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import useExamStore from '@/lib/store/examStore'
import { clsx } from 'clsx'

// serverTimeOffset: difference between server clock and local clock (ms).
// Populated once on mount by calling GET /health and comparing Date headers.
let _serverTimeOffsetMs = 0

async function _syncServerTime() {
  try {
    const before = Date.now()
    const res = await fetch('/health', { cache: 'no-store' })
    const after = Date.now()
    const serverDate = res.headers.get('date')
    if (serverDate) {
      const serverMs = new Date(serverDate).getTime()
      const localMs = Math.round((before + after) / 2)
      _serverTimeOffsetMs = serverMs - localMs
    }
  } catch {
    // non-fatal — offset stays 0
  }
}

// Call once at module load; repeated exams reuse the cached offset.
_syncServerTime()

const WARNING_MILESTONES = [5 * 60, 60, 30] // seconds

export default function ExamTimer({ onTimeUp, onWarning }) {
  const serverEndTime = useExamStore((s) => s.serverEndTime)
  const isLowBandwidth = useExamStore((s) => s.isLowBandwidth)
  const [remaining, setRemaining] = useState(null) // seconds

  // Track whether the timer started with time > 0 in this session.
  // Prevents firing onTimeUp when the page loads with an already-expired
  // end_time (e.g. stale localStorage from a previous exam session).
  const startedPositive = useRef(false)
  const firedWarnings = useRef(new Set())

  const calcRemaining = useCallback(() => {
    if (!serverEndTime) return null
    // Adjust local clock by measured server offset so we match server time
    const adjustedNow = Date.now() + _serverTimeOffsetMs
    const diff = Math.floor((new Date(serverEndTime) - adjustedNow) / 1000)
    return Math.max(0, diff)
  }, [serverEndTime])

  useEffect(() => {
    const initial = calcRemaining()
    setRemaining(initial)

    // Only auto-submit if the timer was actually running (started > 0).
    // If it loads at 0 already, it means the end_time is stale/expired.
    if (initial !== null && initial > 0) {
      startedPositive.current = true
    }

    const tick = setInterval(() => {
      const r = calcRemaining()
      setRemaining(r)

      // Milestone warnings (fire once each)
      for (const milestone of WARNING_MILESTONES) {
        if (r !== null && r <= milestone && !firedWarnings.current.has(milestone)) {
          firedWarnings.current.add(milestone)
          const label =
            milestone >= 60
              ? `${Math.round(milestone / 60)} minute${milestone >= 120 ? 's' : ''}`
              : `${milestone} seconds`
          onWarning?.(`⏰ ${label} remaining!`)
        }
      }

      if (r === 0 && startedPositive.current) {
        clearInterval(tick)
        onTimeUp?.()
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [calcRemaining, onTimeUp, onWarning])

  if (remaining === null) return null

  // If loaded with an already-expired timer (stale end_time from a previous session)
  // show "Expired" instead of 00:00:00 so it's clear the exam needs to be restarted
  const isExpiredOnLoad = remaining === 0 && !startedPositive.current

  const hours = Math.floor(remaining / 3600)
  const mins  = Math.floor((remaining % 3600) / 60)
  const secs  = remaining % 60
  const pad   = (n) => String(n).padStart(2, '0')

  const isWarning = remaining > 0 && remaining < 30 * 60
  const isDanger  = remaining > 0 && remaining < 10 * 60

  if (isExpiredOnLoad) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-sm font-bold bg-gray-100 text-gray-400">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Exam not started
      </div>
    )
  }

  return (
    <div className={clsx(
      'flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-lg font-bold transition-colors',
      isDanger  ? 'bg-exam-red-light text-exam-red' :
      isWarning ? 'bg-exam-amber-light text-exam-amber' :
      'bg-exam-blue-light text-exam-blue'
    )}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {pad(hours)}:{pad(mins)}:{pad(secs)}
      {isLowBandwidth && (
        <span className="text-xs font-normal ml-1 text-exam-amber">● Low Network</span>
      )}
    </div>
  )
}
