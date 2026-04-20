'use client'
/**
 * AntiCheatWrapper — wraps the exam page to enforce:
 *   1. Fullscreen mode (prompts re-entry if candidate exits)
 *   2. Tab switch / window blur detection (Visibility API)
 *   3. Right-click disabled
 *   4. Common keyboard shortcuts blocked (F12, Ctrl+C, Ctrl+V, etc.)
 *
 * None of these stop a determined cheater — they are signals for faculty review.
 * Each event is sent to the server as a violation with low severity.
 */
import { useEffect, useRef, useCallback } from 'react'
import { useState } from 'react'
import useExamStore from '@/lib/store/examStore'
import wsClient from '@/lib/ws/wsClient'
import { reportViolation } from '@/lib/api/client'

const BLOCKED_KEYS = ['F12', 'F5']
// 'x' = cut, 'c' = copy, 'v' = paste, 'a' = select-all, rest = dangerous browser shortcuts
const BLOCKED_CTRL_KEYS = ['c', 'x', 'v', 'a', 'u', 's', 'p', 'f']

// true in local `next dev`, false in `next build` / Amplify
const IS_DEV = process.env.NODE_ENV === 'development'

export default function AntiCheatWrapper({ children, examId }) {
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false)
  // Production-only: hard block overlay when a second monitor is plugged in mid-exam
  const [showMonitorBlock, setShowMonitorBlock] = useState(false)
  const addViolation    = useExamStore((s) => s.addViolation)
  const examStatus      = useExamStore((s) => s.examStatus)
  const candidateName   = useExamStore((s) => s.candidateName)
  const candidateId     = useExamStore((s) => s.candidateId)
  const blurTimeRef = useRef(null)
  // Cooldown map: violation type → last-sent timestamp (ms).
  // Deduplicates violations that fire twice from React 18 Strict Mode double-invoke.
  const violationCooldownRef = useRef({})
  const COOLDOWN_MS = 2000  // ignore same violation type within 2s

  const sendViolation = useCallback((type, severity = 2) => {
    // Deduplicate — same type within cooldown window is silently dropped
    const now = Date.now()
    const last = violationCooldownRef.current[type] || 0
    if (now - last < COOLDOWN_MS) return
    violationCooldownRef.current[type] = now

    const v = { type, severity, timestamp: new Date().toISOString(), examId }
    addViolation(v)
    // Best-effort WS (may not be running)
    wsClient.sendViolation(v)
    // REST API — this is what actually updates the integrity score in Redis/MySQL
    reportViolation(examId, { type, severity }).catch(() => {})
  }, [addViolation, examId])

  // Request fullscreen on mount
  useEffect(() => {
    if (examStatus !== 'active') return
    const enterFullscreen = () => {
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
    enterFullscreen()
  }, [examStatus])

  // Detect fullscreen exit
  useEffect(() => {
    const handleFSChange = () => {
      if (!document.fullscreenElement && examStatus === 'active') {
        setShowFullscreenPrompt(true)
        sendViolation('fullscreen_exit', 3)
      } else {
        setShowFullscreenPrompt(false)
      }
    }
    document.addEventListener('fullscreenchange', handleFSChange)
    return () => document.removeEventListener('fullscreenchange', handleFSChange)
  }, [examStatus, sendViolation])

  // Tab / window blur detection
  useEffect(() => {
    const handleBlur = () => {
      blurTimeRef.current = Date.now()
    }
    const handleFocus = () => {
      if (blurTimeRef.current) {
        const duration = Date.now() - blurTimeRef.current
        blurTimeRef.current = null
        sendViolation('tab_switch', 2)
        // If away for > 10s, higher severity
        if (duration > 10000) sendViolation('extended_tab_switch', 4)
      }
    }
    const handleVisibility = () => {
      if (document.hidden) {
        blurTimeRef.current = Date.now()
        sendViolation('tab_hidden', 2)
      }
    }
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [sendViolation])

  // ── Multi-monitor detection ──────────────────────────────────────────────
  // DEV  (Option B): log to console + send low-severity violation, exam continues
  // PROD (Option A): send severity-5 violation AND show a hard-block overlay
  useEffect(() => {
    if (examStatus !== 'active') return

    const handleMonitorChange = () => {
      if (!window.screen?.isExtended) return   // single monitor — nothing to do

      if (IS_DEV) {
        // Option B — soft flag only
        console.warn('[DEV] Multiple monitors detected during exam — logging violation only (hard-blocked in production)')
        sendViolation('multiple_monitors_dev', 2)
      } else {
        // Option A — hard block overlay + high-severity violation
        sendViolation('multiple_monitors', 5)
        setShowMonitorBlock(true)
      }
    }

    // Check immediately when exam becomes active (catches monitors already extended)
    handleMonitorChange()

    // Listen for screen topology changes (monitor plugged in / out during exam)
    window.screen?.addEventListener?.('change', handleMonitorChange)
    return () => window.screen?.removeEventListener?.('change', handleMonitorChange)
  }, [examStatus, sendViolation])

  // ── Block context menu, dangerous keys, and cut/copy shortcuts ─────────────
  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault()
      sendViolation('right_click', 1)
    }
    const handleKeyDown = (e) => {
      if (BLOCKED_KEYS.includes(e.key)) {
        e.preventDefault()
        sendViolation('devtools_attempt', 3)
        return
      }
      if ((e.ctrlKey || e.metaKey) && BLOCKED_CTRL_KEYS.includes(e.key.toLowerCase())) {
        e.preventDefault()
        sendViolation('copy_paste_attempt', 3)
      }
    }
    document.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [sendViolation])

  // ── Screenshot prevention ────────────────────────────────────────────────
  // PrintScreen fires on keyUP (not keydown) in most browsers.
  // After capture we immediately overwrite the clipboard with an empty string.
  // Win+Shift+S / Cmd+Shift+3 cannot be fully intercepted at OS level, but
  // the clipboard wipe + violation log + watermark together act as deterrents.
  useEffect(() => {
    const handleKeyUp = (e) => {
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        // Wipe clipboard so the screenshot image can't be pasted
        navigator.clipboard?.writeText('').catch(() => {})
        sendViolation('screenshot_attempt', 4)
      }
    }
    document.addEventListener('keyup', handleKeyUp)
    return () => document.removeEventListener('keyup', handleKeyUp)
  }, [sendViolation])

  // ── Block all clipboard DOM events (copy / cut / paste / drag) ───────────
  // This catches browser-menu Copy, drag-select, and programmatic clipboard access.
  useEffect(() => {
    const stop = (e) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const stopAndLog = (e, type) => {
      stop(e)
      sendViolation(type, 3)
    }

    const onCopy      = (e) => stopAndLog(e, 'copy_attempt')
    const onCut       = (e) => stopAndLog(e, 'cut_attempt')
    const onPaste     = (e) => stopAndLog(e, 'paste_attempt')
    const onSelect    = (e) => stop(e)               // cancels text selection start
    const onDragStart = (e) => stopAndLog(e, 'drag_attempt')

    document.addEventListener('copy',      onCopy)
    document.addEventListener('cut',       onCut)
    document.addEventListener('paste',     onPaste)
    document.addEventListener('selectstart', onSelect)
    document.addEventListener('dragstart', onDragStart)
    return () => {
      document.removeEventListener('copy',      onCopy)
      document.removeEventListener('cut',       onCut)
      document.removeEventListener('paste',     onPaste)
      document.removeEventListener('selectstart', onSelect)
      document.removeEventListener('dragstart', onDragStart)
    }
  }, [sendViolation])

  // Watermark tile: candidate name + ID stamped diagonally across the entire screen.
  // pointer-events:none so it never interferes with clicks.
  // Even if a screenshot bypasses all other guards, this identifies WHO took it.
  const watermarkLabel = candidateName
    ? `${candidateName} · ID:${candidateId}`
    : `Exam ID:${examId}`

  // 15 tiles spread across a 5×3 grid — enough coverage for any screen size
  const WATERMARK_TILES = Array.from({ length: 15 }, (_, i) => ({
    top:  `${Math.floor(i / 5) * 33 + 5}%`,
    left: `${(i % 5) * 20 + 2}%`,
  }))

  return (
    <div className="exam-mode relative">
      {children}

      {/* ── Candidate watermark — always present, invisible to normal use ── */}
      <div
        className="fixed inset-0 pointer-events-none select-none overflow-hidden"
        style={{ zIndex: 20 }}
        aria-hidden="true"
      >
        {WATERMARK_TILES.map((pos, i) => (
          <span
            key={i}
            className="absolute text-gray-400 text-xs font-semibold whitespace-nowrap"
            style={{
              top: pos.top,
              left: pos.left,
              opacity: 0.08,
              transform: 'rotate(-25deg)',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            {watermarkLabel}
          </span>
        ))}
      </div>

      {/* Fullscreen prompt overlay */}
      {showFullscreenPrompt && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-2xl">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-exam-text mb-3">Fullscreen Required</h2>
            <p className="text-exam-muted mb-6 text-sm leading-relaxed">
              You exited fullscreen mode. This has been recorded. Please return to fullscreen to continue your exam.
            </p>
            <button
              onClick={() => document.documentElement.requestFullscreen?.()}
              className="bg-exam-blue text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Return to Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* Multiple-monitor hard block (production only — Option A) */}
      {showMonitorBlock && (
        <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl border-4 border-red-500">
            <div className="text-5xl mb-4">🖥️</div>
            <h2 className="text-2xl font-bold text-red-600 mb-3">Multiple Monitors Detected</h2>
            <p className="text-exam-muted text-sm leading-relaxed mb-4">
              An external monitor was detected. This is a violation of the exam policy and has been recorded.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 font-medium mb-6">
              Please disconnect your external monitor, then click the button below to resume.
            </div>
            <button
              onClick={() => {
                // Re-check — only dismiss if the second monitor is gone
                if (!window.screen?.isExtended) {
                  setShowMonitorBlock(false)
                  sendViolation('multiple_monitors_resolved', 1)
                }
              }}
              className="bg-exam-blue text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              I&apos;ve disconnected the monitor — Resume Exam
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
