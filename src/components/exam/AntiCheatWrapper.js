'use client'
import { useEffect, useRef, useCallback, useState } from 'react'
import useExamStore from '@/lib/store/examStore'
import wsClient from '@/lib/ws/wsClient'
import { reportViolation } from '@/lib/api/client'

const BLOCKED_KEYS = ['F12', 'F5']
const BLOCKED_CTRL_KEYS = ['c', 'x', 'v', 'a', 'u', 's', 'p', 'f']

const IS_DEV = process.env.NODE_ENV === 'development'

// Per-type cooldowns (ms) — prevents flooding from rapid-fire events
const TYPE_COOLDOWNS = {
  right_click:        3000,
  tab_switch:         5000,
  tab_hidden:         5000,
  extended_tab_switch: 10000,
  fullscreen_exit:    5000,
  copy_paste_attempt: 3000,
  copy_attempt:       3000,
  cut_attempt:        3000,
  paste_attempt:      3000,
  drag_attempt:       3000,
  devtools_attempt:   5000,
  screenshot_attempt: 5000,
  multiple_monitors:  30000,
  multiple_monitors_dev: 30000,
}
const DEFAULT_COOLDOWN = 2000

export default function AntiCheatWrapper({ children, examId }) {
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false)
  const [showMonitorBlock, setShowMonitorBlock] = useState(false)
  const addViolation     = useExamStore(s => s.addViolation)
  const setIntegrityScore = useExamStore(s => s.setIntegrityScore)
  const examStatus       = useExamStore(s => s.examStatus)
  const candidateName    = useExamStore(s => s.candidateName)
  const candidateId      = useExamStore(s => s.candidateId)
  const blurTimeRef      = useRef(null)
  const cooldownRef      = useRef({})
  // Track whether a blur event already fired tab_hidden, so focus handler
  // doesn't double-count with a separate tab_switch for the same event.
  const blurHandledRef   = useRef(false)

  const sendViolation = useCallback((type, severity = 2) => {
    const now = Date.now()
    const cooldown = TYPE_COOLDOWNS[type] || DEFAULT_COOLDOWN
    const last = cooldownRef.current[type] || 0
    if (now - last < cooldown) return
    cooldownRef.current[type] = now

    const v = { type, severity, timestamp: new Date().toISOString(), examId }
    addViolation(v)
    wsClient.sendViolation(v)

    // REST API — primary path; use response to update integrity score
    reportViolation(examId, { type, severity })
      .then(res => {
        if (res?.data?.integrity_score !== undefined) {
          setIntegrityScore(res.data.integrity_score)
        }
      })
      .catch(() => {})
  }, [addViolation, setIntegrityScore, examId])

  // Request fullscreen on mount
  useEffect(() => {
    if (examStatus !== 'active') return
    document.documentElement.requestFullscreen?.().catch(() => {})
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

  // Tab / window blur detection — deduplicated so blur+visibilitychange
  // on the same navigation only sends ONE violation
  useEffect(() => {
    const handleBlur = () => {
      blurTimeRef.current = Date.now()
      blurHandledRef.current = false
    }
    const handleFocus = () => {
      if (blurTimeRef.current) {
        const duration = Date.now() - blurTimeRef.current
        blurTimeRef.current = null
        if (!blurHandledRef.current) {
          sendViolation('tab_switch', 2)
          blurHandledRef.current = true
        }
        if (duration > 10000) sendViolation('extended_tab_switch', 4)
      }
    }
    const handleVisibility = () => {
      if (document.hidden && !blurHandledRef.current) {
        blurTimeRef.current = blurTimeRef.current || Date.now()
        sendViolation('tab_hidden', 2)
        blurHandledRef.current = true
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

  // Multi-monitor detection
  useEffect(() => {
    if (examStatus !== 'active') return

    const handleMonitorChange = () => {
      if (!window.screen?.isExtended) return
      if (IS_DEV) {
        console.warn('[DEV] Multiple monitors detected — logging violation only (hard-blocked in production)')
        sendViolation('multiple_monitors_dev', 2)
      } else {
        sendViolation('multiple_monitors', 5)
        setShowMonitorBlock(true)
      }
    }

    handleMonitorChange()
    window.screen?.addEventListener?.('change', handleMonitorChange)
    return () => window.screen?.removeEventListener?.('change', handleMonitorChange)
  }, [examStatus, sendViolation])

  // Block context menu, dangerous keys
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

  // Screenshot prevention (PrintScreen fires on keyUp)
  useEffect(() => {
    const handleKeyUp = (e) => {
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        navigator.clipboard?.writeText('').catch(() => {})
        sendViolation('screenshot_attempt', 4)
      }
    }
    document.addEventListener('keyup', handleKeyUp)
    return () => document.removeEventListener('keyup', handleKeyUp)
  }, [sendViolation])

  // Block clipboard DOM events (copy / cut / paste / drag)
  useEffect(() => {
    const stop = (e) => { e.preventDefault(); e.stopPropagation() }
    const stopAndLog = (e, type) => { stop(e); sendViolation(type, 3) }
    const onCopy      = (e) => stopAndLog(e, 'copy_attempt')
    const onCut       = (e) => stopAndLog(e, 'cut_attempt')
    const onPaste     = (e) => stopAndLog(e, 'paste_attempt')
    const onSelect    = (e) => stop(e)
    const onDragStart = (e) => stopAndLog(e, 'drag_attempt')

    document.addEventListener('copy',        onCopy)
    document.addEventListener('cut',         onCut)
    document.addEventListener('paste',       onPaste)
    document.addEventListener('selectstart', onSelect)
    document.addEventListener('dragstart',   onDragStart)
    return () => {
      document.removeEventListener('copy',        onCopy)
      document.removeEventListener('cut',         onCut)
      document.removeEventListener('paste',       onPaste)
      document.removeEventListener('selectstart', onSelect)
      document.removeEventListener('dragstart',   onDragStart)
    }
  }, [sendViolation])

  // Watermark
  const watermarkLabel = candidateName
    ? `${candidateName} · ID:${candidateId}`
    : `Exam ID:${examId}`

  const WATERMARK_TILES = Array.from({ length: 15 }, (_, i) => ({
    top:  `${Math.floor(i / 5) * 33 + 5}%`,
    left: `${(i % 5) * 20 + 2}%`,
  }))

  return (
    <div className="exam-mode relative">
      {children}

      {/* Candidate watermark */}
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
              top: pos.top, left: pos.left,
              opacity: 0.08, transform: 'rotate(-25deg)',
              userSelect: 'none', WebkitUserSelect: 'none',
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
            <h2 className="text-xl font-bold text-slate-800 mb-3">Fullscreen Required</h2>
            <p className="text-slate-500 mb-6 text-sm leading-relaxed">
              You exited fullscreen mode. This has been recorded as a violation. Please return to fullscreen to continue your exam.
            </p>
            <button
              onClick={() => document.documentElement.requestFullscreen?.()}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
            >
              Return to Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* Multiple-monitor hard block (production only) */}
      {showMonitorBlock && (
        <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl border-4 border-red-500">
            <div className="text-5xl mb-4">🖥️</div>
            <h2 className="text-2xl font-bold text-red-600 mb-3">Multiple Monitors Detected</h2>
            <p className="text-slate-500 text-sm leading-relaxed mb-4">
              An external monitor was detected. This is a violation of the exam policy and has been recorded.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 font-medium mb-6">
              Please disconnect your external monitor, then click the button below to resume.
            </div>
            <button
              onClick={() => {
                if (!window.screen?.isExtended) {
                  setShowMonitorBlock(false)
                  sendViolation('multiple_monitors_resolved', 1)
                }
              }}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
            >
              I&apos;ve disconnected the monitor — Resume Exam
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
