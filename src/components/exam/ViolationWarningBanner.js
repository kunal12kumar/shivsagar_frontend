'use client'
import { useState, useEffect, useRef } from 'react'
import useExamStore from '@/lib/store/examStore'

const WARNING_MESSAGES = {
  fullscreen_exit:       'You exited fullscreen. This has been recorded.',
  tab_switch:            'Tab switch detected! Stay on the exam tab.',
  extended_tab_switch:   'You were away for too long. This is a serious violation.',
  tab_hidden:            'You navigated away from the exam window.',
  gaze_deviation:        'Eyes off screen detected. Focus on your exam.',
  copy_paste_attempt:    'Copy/paste is not allowed during the exam.',
  copy_attempt:          'Copying is not allowed during the exam.',
  cut_attempt:           'Cutting is not allowed during the exam.',
  paste_attempt:         'Pasting is not allowed during the exam.',
  drag_attempt:          'Drag and drop is disabled during the exam.',
  right_click:           'Right-click is disabled during the exam.',
  devtools_attempt:      'Developer tools access is blocked.',
  screenshot_attempt:    'Screenshot attempt detected and recorded.',
  multiple_monitors:     'External monitor detected. Disconnect it immediately.',
  multiple_monitors_dev: 'Multiple monitors detected.',
  voice_assistant_keyword: 'Voice assistant keyword detected!',
  sustained_speech:      'Sustained speech detected. Please stay silent.',
  camera_unavailable:    'Camera is not available. Enable your webcam.',
  mic_permission_denied: 'Microphone access denied. Enable it for proctoring.',
  face_detection_failed: 'Face not detected. Stay visible to the camera.',
  multiple_faces:        'Multiple faces detected in the frame.',
}

const SEVERITY_STYLES = {
  low:    { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', icon: '⚠' },
  medium: { bg: '#fed7aa', border: '#f97316', text: '#9a3412', icon: '⚠' },
  high:   { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', icon: '🚨' },
}

function getSeverityLevel(severity) {
  if (severity >= 4) return 'high'
  if (severity >= 3) return 'medium'
  return 'low'
}

export default function ViolationWarningBanner() {
  const violations = useExamStore(s => s.violations)
  const integrityScore = useExamStore(s => s.integrityScore)
  const [activeWarnings, setActiveWarnings] = useState([])
  const lastCountRef = useRef(0)

  useEffect(() => {
    if (violations.length <= lastCountRef.current) {
      lastCountRef.current = violations.length
      return
    }

    const newViolations = violations.slice(lastCountRef.current)
    lastCountRef.current = violations.length

    const newWarnings = newViolations
      .filter(v => v.type !== 'right_click')
      .map((v, i) => ({
        id: Date.now() + i,
        type: v.type,
        severity: v.severity || 2,
        message: WARNING_MESSAGES[v.type] || `Violation: ${v.type.replace(/_/g, ' ')}`,
        timestamp: Date.now(),
      }))

    if (newWarnings.length === 0) return
    setActiveWarnings(prev => [...prev, ...newWarnings].slice(-3))
  }, [violations])

  // Auto-dismiss warnings after 5 seconds
  useEffect(() => {
    if (activeWarnings.length === 0) return
    const timer = setTimeout(() => {
      setActiveWarnings(prev => prev.slice(1))
    }, 5000)
    return () => clearTimeout(timer)
  }, [activeWarnings])

  if (activeWarnings.length === 0) return null

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 flex flex-col gap-2 pointer-events-none"
      style={{ top: '64px', zIndex: 45, width: '100%', maxWidth: '520px', padding: '0 16px' }}
    >
      {activeWarnings.map((w) => {
        const style = SEVERITY_STYLES[getSeverityLevel(w.severity)]
        return (
          <div
            key={w.id}
            className="pointer-events-auto rounded-2xl shadow-lg flex items-center gap-3 animate-slide-down"
            style={{
              background: style.bg,
              border: `2px solid ${style.border}`,
              padding: '14px 20px',
              animation: 'slideDown 0.3s ease-out',
            }}
          >
            <span className="text-xl flex-shrink-0">{style.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold" style={{ color: style.text }}>{w.message}</p>
              <p className="text-xs mt-0.5" style={{ color: style.text, opacity: 0.7 }}>
                Integrity score: {integrityScore.toFixed(1)} — This incident has been recorded
              </p>
            </div>
            <button
              onClick={() => setActiveWarnings(prev => prev.filter(x => x.id !== w.id))}
              className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-opacity hover:opacity-100"
              style={{ color: style.text, opacity: 0.5, background: 'rgba(0,0,0,0.05)' }}
            >
              ✕
            </button>
          </div>
        )
      })}

      <style jsx global>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
