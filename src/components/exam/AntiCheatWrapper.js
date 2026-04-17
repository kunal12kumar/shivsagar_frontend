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

const BLOCKED_KEYS = ['F12', 'F5']
const BLOCKED_CTRL_KEYS = ['c', 'v', 'a', 'u', 's', 'p', 'f']

export default function AntiCheatWrapper({ children, examId }) {
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false)
  const addViolation = useExamStore((s) => s.addViolation)
  const examStatus = useExamStore((s) => s.examStatus)
  const blurTimeRef = useRef(null)

  const sendViolation = useCallback((type, severity = 2) => {
    const v = { type, severity, timestamp: new Date().toISOString(), examId }
    addViolation(v)
    wsClient.sendViolation(v)
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

  // Block context menu and dangerous keys
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
        sendViolation('copy_paste_attempt', 2)
      }
    }
    document.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [sendViolation])

  return (
    <div className="exam-mode relative">
      {children}
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
    </div>
  )
}
