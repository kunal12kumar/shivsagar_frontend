'use client'
/**
 * ExamInstructions.js
 *
 * Full-page exam instructions for DAT 2026 — AI-Proctored Online MCQ Exam.
 * Covers all 10 sections mandated by the implementation plan.
 *
 * Props:
 *   examName        {string}   — "DAT 2026"
 *   duration        {number}   — exam duration in minutes (180)
 *   totalQuestions  {number}   — 90
 *   candidateName   {string}   — candidate's full name
 *   examDate        {string}   — display date string
 *   onStartExam     {function} — called when candidate clicks Start Exam
 *
 * Behaviour:
 *   • Scroll progress bar at top fills as the candidate reads
 *   • "Start Exam" button stays disabled until:
 *       1. Candidate has scrolled to the bottom (IntersectionObserver on last section)
 *       2. Candidate has checked the declaration checkbox
 *   • Mobile devices: shows a blocking message, hides all content
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Monitor, Camera, Mic, Eye, Globe, Shield, Wifi, WifiOff,
  AlertTriangle, CheckCircle, XCircle, BarChart2, FileText,
  ClipboardList, BookOpen, ChevronRight, Info, Clock, Hash,
  CheckSquare, Zap, Volume2, LayoutGrid, Send, Phone,
  Sun, Users, BatteryCharging, Headphones, BookMarked,
  RefreshCw, Lock, Radio, Laptop, Ruler,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({ id, icon: Icon, iconColor, title, children, className }) {
  return (
    <section id={id} className={clsx('bg-white rounded-2xl border border-exam-border shadow-sm overflow-hidden', className)}>
      {/* Section header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-exam-border">
        <div className={clsx('p-2 rounded-xl', iconColor || 'bg-exam-blue-light')}>
          <Icon className={clsx('w-5 h-5', iconColor ? 'text-white' : 'text-exam-blue')} />
        </div>
        <h2 className="text-base font-bold text-exam-text tracking-tight">{title}</h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  )
}

function InfoBox({ type = 'info', children }) {
  const styles = {
    info:    'bg-exam-blue-light border-blue-200 text-exam-blue',
    warning: 'bg-exam-amber-light border-amber-300 text-amber-800',
    danger:  'bg-exam-red-light border-red-300 text-exam-red',
    success: 'bg-exam-green-light border-green-300 text-green-800',
  }
  const icons = {
    info: Info, warning: AlertTriangle, danger: XCircle, success: CheckCircle,
  }
  const Icon = icons[type]
  return (
    <div className={clsx('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', styles[type])}>
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}

function ViolationRow({ label, impact, color = 'red' }) {
  const bar = { red: 'bg-exam-red', amber: 'bg-exam-amber', blue: 'bg-exam-blue', green: 'bg-exam-green' }
  const widths = { 'Highest': 'w-full', 'High': 'w-4/5', 'Medium': 'w-3/5', 'Low': 'w-2/5', 'Very Low': 'w-1/4' }
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-exam-border last:border-0">
      <span className="text-sm text-exam-text font-medium">{label}</span>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={clsx('h-full rounded-full', bar[color], widths[impact])} />
        </div>
        <span className={clsx('text-xs font-semibold w-14 text-right',
          color === 'red' ? 'text-exam-red' :
          color === 'amber' ? 'text-exam-amber' :
          color === 'blue' ? 'text-exam-blue' : 'text-exam-green'
        )}>{impact}</span>
      </div>
    </div>
  )
}

function StepBadge({ number, label, desc }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-exam-blue text-white text-sm font-bold flex items-center justify-center shadow-sm">
        {number}
      </div>
      <div className="flex-1 pt-1">
        <div className="font-semibold text-exam-text text-sm">{label}</div>
        {desc && <div className="text-exam-muted text-xs mt-0.5 leading-relaxed">{desc}</div>}
      </div>
    </div>
  )
}

function Rule({ allowed, children }) {
  return (
    <li className="flex items-start gap-2.5 text-sm py-1.5">
      {allowed ? (
        <CheckCircle className="w-4 h-4 text-exam-green mt-0.5 flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-exam-red mt-0.5 flex-shrink-0" />
      )}
      <span className={allowed ? 'text-green-800' : 'text-red-800'}>{children}</span>
    </li>
  )
}

function ProctoringBlock({ icon: Icon, iconBg, iconText, title, points }) {
  return (
    <div className="border border-exam-border rounded-xl overflow-hidden">
      <div className={clsx('flex items-center gap-3 px-4 py-3', iconBg)}>
        <Icon className={clsx('w-4 h-4', iconText)} />
        <span className={clsx('font-semibold text-sm', iconText)}>{title}</span>
      </div>
      <ul className="px-4 py-3 space-y-2">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-exam-text leading-relaxed">
            <ChevronRight className="w-3.5 h-3.5 text-exam-muted mt-0.5 flex-shrink-0" />
            <span dangerouslySetInnerHTML={{ __html: p }} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChecklistItem({ children }) {
  return (
    <li className="flex items-start gap-3 py-2 border-b border-exam-border last:border-0">
      <div className="w-5 h-5 mt-0.5 flex-shrink-0 border-2 border-exam-border rounded flex items-center justify-center bg-gray-50">
        <div className="w-2.5 h-2.5 rounded-sm bg-gray-200" />
      </div>
      <span className="text-sm text-exam-text leading-relaxed">{children}</span>
    </li>
  )
}

function NavDot({ color, label }) {
  const colors = {
    green:  'bg-exam-green',
    red:    'bg-exam-red',
    purple: 'bg-purple-500',
    gray:   'bg-gray-300',
  }
  return (
    <div className="flex items-center gap-2">
      <div className={clsx('w-6 h-6 rounded flex-shrink-0 border border-black/10', colors[color])} />
      <span className="text-xs text-exam-text leading-tight">{label}</span>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function ExamInstructions({
  examName = 'DAT 2026',
  duration = 180,
  totalQuestions = 90,
  candidateName = 'Candidate',
  examDate = '',
  onStartExam,
}) {
  const [scrollProgress, setScrollProgress] = useState(0)
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const lastSectionRef = useRef(null)
  const containerRef = useRef(null)

  // Detect mobile on mount
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Scroll progress tracker + bottom-reached detector (fallback for IO)
  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      if (docHeight <= 0) return
      const pct = Math.min(100, Math.round((scrollTop / docHeight) * 100))
      setScrollProgress(pct)
      // Fallback: mark as read when within 200 px of the bottom
      if (scrollTop >= docHeight - 200) setHasScrolledToBottom(true)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // IntersectionObserver: fires when last section enters the viewport
  useEffect(() => {
    if (!lastSectionRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setHasScrolledToBottom(true) },
      { threshold: 0.3 }
    )
    observer.observe(lastSectionRef.current)
    return () => observer.disconnect()
  }, [])

  const canStart = agreed && hasScrolledToBottom

  // ── Mobile block ─────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="min-h-screen bg-exam-bg flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-exam-border shadow-sm p-8 max-w-sm text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Phone className="w-7 h-7 text-exam-red" />
          </div>
          <h1 className="text-xl font-bold text-exam-text mb-3">Mobile Device Detected</h1>
          <p className="text-sm text-exam-muted leading-relaxed mb-5">
            <strong className="text-exam-red">This exam cannot be taken on a mobile phone.</strong>
          </p>
          <div className="bg-exam-blue-light rounded-xl p-4 text-left space-y-2 text-sm text-exam-text">
            <p className="font-semibold text-exam-blue mb-1">Please use:</p>
            <div className="flex items-center gap-2"><Laptop className="w-4 h-4 text-exam-blue flex-shrink-0" /><span>A laptop or desktop computer</span></div>
            <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-exam-blue flex-shrink-0" /><span>Google Chrome or Microsoft Edge browser</span></div>
          </div>
          <p className="text-xs text-exam-muted mt-5">
            The AI proctoring system requires a webcam, microphone, and fullscreen mode — features not reliably available on mobile devices.
          </p>
        </div>
      </div>
    )
  }

  // ── Desktop view ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-exam-bg" ref={containerRef}>

      {/* ── Scroll progress bar (fixed top) ──────────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-gray-200">
        <div
          className="h-full bg-exam-blue transition-all duration-150"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>
      <div className="fixed top-1 right-4 z-50 bg-white/90 backdrop-blur-sm border border-exam-border rounded-full px-3 py-1 text-xs font-medium text-exam-muted shadow-sm">
        {scrollProgress}% read
      </div>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-exam-border pt-6 pb-5 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 bg-exam-blue rounded-lg flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-white" />
                </div>
                <span className="text-xs font-semibold text-exam-blue uppercase tracking-wider">Rajiv Gandhi Institute of Petroleum Technology</span>
              </div>
              <h1 className="text-2xl font-bold text-exam-text">{examName} — Exam Instructions</h1>
              <p className="text-exam-muted text-sm mt-1">
                Read every section carefully before you start. The Start Exam button will unlock only after you have read all instructions and agreed to the terms.
              </p>
            </div>
          </div>

          {/* Exam info pills */}
          <div className="flex flex-wrap gap-2 mt-4">
            {[
              { icon: Hash, label: `${totalQuestions} Questions` },
              { icon: Clock, label: `${Math.floor(duration / 60)} hr ${duration % 60 > 0 ? duration % 60 + ' min' : ''}`.trim() },
              { icon: FileText, label: 'MCQ + Numerical' },
              { icon: Globe, label: 'Chrome / Edge Only' },
              ...(examDate ? [{ icon: Clock, label: examDate }] : []),
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 bg-exam-blue-light text-exam-blue text-xs font-medium px-3 py-1.5 rounded-full border border-blue-200">
                <Icon className="w-3.5 h-3.5" />
                {label}
              </span>
            ))}
          </div>

          {candidateName && (
            <div className="mt-4 bg-exam-green-light border border-green-200 rounded-xl px-4 py-3 text-sm">
              <span className="text-green-700">Logged in as: <strong>{candidateName}</strong></span>
              <span className="text-green-600 ml-2">— These instructions apply to your session.</span>
            </div>
          )}
        </div>
      </div>

      {/* ── All sections ─────────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 1 — BEFORE YOU START                                  */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <SectionCard id="s1" icon={Monitor} title="Section 1 — Before You Start (System Requirements)">
          <div className="space-y-4">
            <InfoBox type="warning">
              <strong>Read this before you do anything.</strong> If your device or setup does not meet these requirements, you will not be able to start the exam or may be disqualified mid-exam.
            </InfoBox>

            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { icon: Globe, ok: true, title: 'Browser', desc: 'Google Chrome or Microsoft Edge only. Firefox, Safari, Opera, or any other browser will NOT work. Voice monitoring requires Chrome/Edge.' },
                { icon: Laptop, ok: true, title: 'Device', desc: 'Laptop or desktop computer only. Mobile phones and tablets are not allowed — the AI proctoring system requires a proper webcam and fullscreen mode.' },
                { icon: Wifi, ok: true, title: 'Internet Speed', desc: 'Minimum 512 kbps. Check your speed at speedtest.net before the exam. Open speedtest.net, click Go, and make sure download speed shows at least 0.5 Mbps.' },
                { icon: Camera, ok: true, title: 'Webcam', desc: 'Must be working, plugged in, and clearly showing your face. Built-in laptop cameras are fine. Your face must be well-lit — sit facing a window or light source.' },
                { icon: Mic, ok: true, title: 'Microphone', desc: 'Must be working. The AI monitors your room for voice activity throughout the exam. Deny mic permission = you cannot start the exam.' },
                { icon: Sun, ok: true, title: 'Lighting & Room', desc: 'Sit in a quiet, well-lit room. Light source should be in front of you, not behind you. Do not sit with a window behind your back — your face will appear dark.' },
                { icon: Users, ok: false, title: 'No Other Person', desc: 'You must be alone in the room. No family member, friend, or pet should be visible or audible. AI detects multiple faces and voices.' },
                { icon: BatteryCharging, ok: true, title: 'Power', desc: 'Fully charge your laptop or keep it plugged in. A power cut will not lose your answers (they are saved), but reconnecting adds stress on exam day.' },
                { icon: Headphones, ok: false, title: 'No Earphones', desc: 'Headphones and earphones are strictly prohibited. Wearing them during the exam will be visible in webcam snapshots and will be flagged.' },
                { icon: Ruler, ok: true, title: 'Camera Distance', desc: 'Sit at arm\'s length from your screen (approximately 50–70 cm). Your full face, shoulders, and upper body must be visible in the webcam frame. Sitting too close hides what is around you — if you move closer, the camera cannot see if you are holding a phone or using notes.' },
              ].map(({ icon: Icon, ok, title, desc }) => (
                <div key={title} className={clsx(
                  'rounded-xl p-4 border text-sm',
                  ok ? 'border-green-200 bg-exam-green-light' : 'border-red-200 bg-exam-red-light'
                )}>
                  <div className="flex items-center gap-2 mb-1.5">
                    {ok
                      ? <CheckCircle className="w-4 h-4 text-exam-green flex-shrink-0" />
                      : <XCircle className="w-4 h-4 text-exam-red flex-shrink-0" />
                    }
                    <Icon className={clsx('w-3.5 h-3.5 flex-shrink-0', ok ? 'text-green-700' : 'text-red-700')} />
                    <span className={clsx('font-semibold', ok ? 'text-green-800' : 'text-red-800')}>{title}</span>
                  </div>
                  <p className={clsx('leading-relaxed text-xs', ok ? 'text-green-700' : 'text-red-700')}>{desc}</p>
                </div>
              ))}
            </div>

            <InfoBox type="warning">
              <strong>Before you start:</strong> Close WhatsApp Web, YouTube, Spotify, Discord, Teams, and all other applications. Only your exam browser window should be open.
            </InfoBox>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 2 — PRE-EXAM CHECKLIST                                */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <SectionCard id="s2" icon={ClipboardList} title="Section 2 — Pre-Exam Checklist (What Happens Before the Exam Begins)">
          <div className="space-y-4">
            <p className="text-sm text-exam-muted">
              After you log in, you will go through 6 steps automatically before the exam starts. Each step is explained below. <strong className="text-exam-text">Do not close the browser at any step.</strong>
            </p>
            <div className="space-y-4">
              <StepBadge number="1" label="OTP Login"
                desc="Enter your roll number and the registered email address from your admit card. A 6-digit One-Time Password (OTP) will be sent to your email. Enter the OTP to log in. OTP is valid for 10 minutes. Check your spam folder if you do not receive it." />
              <StepBadge number="2" label="Face Verification"
                desc="Your webcam will capture your face and compare it to the photo on your registered ID. You must match your ID photo. Sit directly in front of the camera, in good lighting, with your face clearly visible. This check must pass (≥ 90% match) to proceed. If it fails, a faculty member will manually review and approve." />
              <StepBadge number="3" label="Room Scan (360° Pan)"
                desc="You will be asked to slowly rotate your webcam (or yourself) for 10 seconds to show the room around you. This captures the room environment for faculty review. Show the room clearly — walls, desk, and surroundings. No one else should be present." />
              <StepBadge number="4" label="System Check (8 Automatic Tests)"
                desc="The system automatically checks: browser compatibility, webcam, microphone, internet speed, single monitor, face identity, room scan, and face count. Hard failures (no webcam, mic denied) block you from starting. Soft failures (slow internet) are flagged for faculty but do not block you." />
              <StepBadge number="5" label="Instructions Page"
                desc="This page — which you are reading right now. You must scroll to the bottom, check the declaration box, and click Start Exam. The button will only become active after you have read everything." />
              <StepBadge number="6" label="Exam Begins"
                desc="The exam timer starts on the server the moment you click Start Exam. You cannot pause it. Fullscreen mode is enforced. All proctoring activates automatically — webcam, microphone, gaze tracking." />
            </div>
            <InfoBox type="info">
              The entire pre-exam process takes approximately <strong>3–5 minutes</strong>. Log in at least 10 minutes before your exam start time.
            </InfoBox>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 3 — EXAM FORMAT                                       */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <SectionCard id="s3" icon={BookOpen} title="Section 3 — Exam Format & Marking Scheme">
          <div className="space-y-5">

            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Questions', value: String(totalQuestions), icon: Hash, color: 'text-exam-blue', bg: 'bg-exam-blue-light' },
                { label: 'Duration', value: `${Math.floor(duration/60)}h ${duration%60>0?duration%60+'m':''}`.trim(), icon: Clock, color: 'text-exam-amber', bg: 'bg-exam-amber-light' },
                { label: 'Question Types', value: '3 Types', icon: FileText, color: 'text-exam-green', bg: 'bg-exam-green-light' },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className={clsx('rounded-xl p-4 border border-exam-border text-center', bg)}>
                  <Icon className={clsx('w-5 h-5 mx-auto mb-1', color)} />
                  <div className={clsx('text-xl font-bold', color)}>{value}</div>
                  <div className="text-xs text-exam-muted mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* Question types */}
            <div>
              <h3 className="text-sm font-bold text-exam-text mb-3">Question Types & Marking Scheme</h3>
              <div className="space-y-3">
                {[
                  {
                    type: 'Single Correct (SCQ)',
                    desc: 'Choose exactly 1 correct option out of 4 choices.',
                    marks: ['+4 for correct answer', '−1 for wrong answer', '0 for unattempted'],
                    colors: ['text-exam-green', 'text-exam-red', 'text-exam-muted'],
                    tip: 'If you are unsure, it is safer to leave unattempted (0) than risk −1.',
                  },
                  {
                    type: 'Multiple Correct (MCQ)',
                    desc: 'One or more options may be correct. You must select ALL correct options.',
                    marks: ['+4 if ALL correct options selected', '−2 for wrong or incomplete selection', '0 for unattempted'],
                    colors: ['text-exam-green', 'text-exam-red', 'text-exam-muted'],
                    tip: 'Partial credit does NOT apply. Selecting 3 out of 4 correct options is treated as wrong. Select all correct options or leave unattempted.',
                  },
                  {
                    type: 'Numerical Answer',
                    desc: 'Type your answer as a number (integer or decimal up to 2 decimal places).',
                    marks: ['+4 for correct value', '0 for wrong value', '0 for unattempted'],
                    colors: ['text-exam-green', 'text-exam-muted', 'text-exam-muted'],
                    tip: 'No negative marking for numerical questions. Attempt if you have a reasonable estimate.',
                  },
                ].map(({ type, desc, marks, colors, tip }) => (
                  <div key={type} className="border border-exam-border rounded-xl overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-exam-border">
                      <span className="font-semibold text-exam-text text-sm">{type}</span>
                      <p className="text-xs text-exam-muted mt-0.5">{desc}</p>
                    </div>
                    <div className="px-4 py-3 flex flex-wrap gap-3">
                      {marks.map((m, i) => (
                        <span key={i} className={clsx('text-sm font-semibold', colors[i])}>{m}</span>
                      ))}
                    </div>
                    <div className="px-4 pb-3">
                      <div className="bg-exam-amber-light border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        {tip}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation & auto-save */}
            <div>
              <h3 className="text-sm font-bold text-exam-text mb-3">Navigation & Question Panel</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-exam-muted uppercase tracking-wide">Question Status Colors</h4>
                  <div className="bg-gray-50 rounded-xl border border-exam-border p-4 space-y-2.5">
                    <NavDot color="green"  label="Answered — you have selected an answer" />
                    <NavDot color="red"    label="Visited but not answered — you opened the question but left it blank" />
                    <NavDot color="purple" label="Marked for Review — you flagged it to come back later" />
                    <NavDot color="gray"   label="Not yet visited — you haven't opened this question" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-exam-muted uppercase tracking-wide">Important Notes</h4>
                  <ul className="space-y-2 text-sm text-exam-text">
                    {[
                      'Questions are shuffled — every candidate gets a different order.',
                      'Options within each question are also shuffled.',
                      'Answers are auto-saved every 15 seconds — look for "Saved ✓" near the question.',
                      'You can change your answer anytime before submitting.',
                      'Use "Mark for Review" to flag questions you want to revisit.',
                      'The timer is controlled by the server — your local clock does not matter.',
                    ].map((t, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <ChevronRight className="w-3.5 h-3.5 text-exam-blue mt-0.5 flex-shrink-0" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 4 — AI PROCTORING                                     */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <SectionCard id="s4" icon={Shield} iconColor="bg-exam-blue" title="Section 4 — AI Proctoring: What It Is and What It Monitors">
          <div className="space-y-5">

            <InfoBox type="info">
              <div className="space-y-1">
                <strong>What is AI Proctoring?</strong>
                <p>AI proctoring is a computer program that watches your webcam and microphone during the exam to detect possible cheating. It is <em>not</em> a human watching you live. Everything it detects is recorded and reviewed by RGIPT faculty after the exam. <strong>Faculty have full authority — the AI only flags, humans decide.</strong></p>
              </div>
            </InfoBox>

            <div className="space-y-3">

              {/* Face */}
              <ProctoringBlock
                icon={Camera}
                iconBg="bg-blue-600"
                iconText="text-white"
                title="1 — Your Face (Face Verification)"
                points={[
                  'Your face is checked at login and matched against your registered photo ID. You <strong>must pass</strong> this check to enter the exam.',
                  'Your face is <strong>re-checked automatically every 60 seconds</strong> during the exam using the same AI.',
                  'You must remain visible in the webcam frame at all times.',
                  '<strong>Sit at arm\'s length from your screen (50–70 cm).</strong> Your full face and upper body must be clearly visible. If you sit too close, your hands and surroundings are hidden — the AI will flag the reduced view as a proctoring gap.',
                  'If another person is detected in the frame during verification or during the exam, verification will fail and a violation will be recorded automatically.',
                  'Sit facing a light source — <strong>do not sit with light behind you</strong> (your face will be too dark to verify).',
                  'Do not cover your face with your hands, a mask, a scarf, or anything else.',
                  'If a face check fails: a violation is recorded. It does <strong>not</strong> immediately disqualify you — faculty reviews it.',
                  'If face verification fails repeatedly: stay on the screen, do not close the browser. A manual faculty override will be made.',
                ]}
              />

              {/* Gaze */}
              <ProctoringBlock
                icon={Eye}
                iconBg="bg-purple-600"
                iconText="text-white"
                title="2 — Your Eyes and Head (Gaze Tracking)"
                points={[
                  'AI tracks where your eyes are looking using your webcam camera. This runs entirely on your computer — no video is sent to a server.',
                  'If you look away from the screen for more than <strong>3 seconds continuously</strong>: a gaze deviation violation is recorded.',
                  'Occasional brief glances away are fine — only <strong>sustained look-away (3+ seconds)</strong> is flagged.',
                  'Do not look at your phone, paper notes, another screen, or another person during the exam.',
                  'Keep your head roughly facing the screen while thinking.',
                  'The AI requires your face to be visible — if you lean too far back or too far to the side, it may lose tracking.',
                ]}
              />

              {/* Voice */}
              <ProctoringBlock
                icon={Mic}
                iconBg="bg-red-600"
                iconText="text-white"
                title="3 — Your Voice and Room Audio (Voice Monitoring)"
                points={[
                  'Your microphone listens throughout the entire exam. <strong>Denying microphone permission will block you from starting.</strong>',
                  'If you speak continuously for more than <strong>5 seconds</strong>: a "sustained speech" violation is recorded.',
                  'If voice assistant commands are detected — <strong>"Hey Siri", "OK Google", "Alexa"</strong> — an immediate high-severity violation is recorded.',
                  'Do not speak to anyone, read questions aloud, mutter, or use voice commands at any point.',
                  'Sit in a quiet room. Background TV, music, people talking nearby, or a loud fan may trigger voice detection.',
                  'Do not wear earphones or headphones — they are not allowed and will show in webcam snapshots.',
                  'Whispering is below detection threshold but is still visible in snapshots.',
                ]}
              />

              {/* Screen */}
              <ProctoringBlock
                icon={Monitor}
                iconBg="bg-amber-600"
                iconText="text-white"
                title="4 — Your Screen and Browser (Tab and Window Monitoring)"
                points={[
                  'The exam runs in <strong>fullscreen mode</strong>. You cannot exit fullscreen while the exam is running.',
                  'If you exit fullscreen: a violation is recorded and a prompt appears asking you to return to fullscreen.',
                  'If you switch to another browser tab, another application, or minimize the window: a <strong>tab switch violation</strong> is recorded instantly.',
                  'Do not open any other website, app, calculator, or chat at any time during the exam.',
                  '<strong>Right-click is disabled.</strong> Copy-paste shortcuts (Ctrl+C, Ctrl+V) are disabled. F12 (developer tools) is blocked.',
                  'Do not use a virtual machine, remote desktop software, or screen sharing app — these will be detected and flagged.',
                ]}
              />

              {/* Snapshots */}
              <ProctoringBlock
                icon={Camera}
                iconBg="bg-gray-600"
                iconText="text-white"
                title="5 — Periodic Webcam Snapshots"
                points={[
                  'Your webcam takes a silent photo <strong>every 2 minutes</strong> automatically throughout the exam.',
                  'You will <strong>not see any notification</strong> when a snapshot is taken.',
                  'These photos are stored securely and reviewed by RGIPT faculty after the exam closes.',
                  'Snapshots are used to verify: your presence, your identity, earphone usage, notes on the desk, other people in the room.',
                  'This is why you should always sit properly, remain visible, keep the desk clear, and not wear earphones.',
                  'Total snapshots over 3 hours: approximately 90 photos.',
                ]}
              />
            </div>

            <InfoBox type="success">
              <strong>Remember:</strong> All AI flags are advisory only. No automated action disqualifies you. RGIPT faculty reviews all evidence — snapshots, violation log, and score — before any decision is made.
            </InfoBox>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 5 — INTEGRITY SCORE                                   */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <SectionCard id="s5" icon={BarChart2} title="Section 5 — Integrity Score (How Violations Are Tracked)">
          <div className="space-y-4">
            <p className="text-sm text-exam-muted leading-relaxed">
              Every violation detected by the AI adds points to your <strong className="text-exam-text">Integrity Score</strong>.
              A higher score means more suspicious activity was detected.
              The score runs from <strong>0 (clean) to 100 (maximum flags)</strong>.
              It is calculated automatically in real-time during your exam.
            </p>

            <div>
              <h3 className="text-sm font-bold text-exam-text mb-3">Violation Impact (higher bar = more serious)</h3>
              <div className="border border-exam-border rounded-xl px-4 py-2">
                <ViolationRow label="Face mismatch / impersonation attempt" impact="Highest" color="red" />
                <ViolationRow label="Mobile phone / device detected in snapshot" impact="High" color="red" />
                <ViolationRow label="Multiple faces in frame" impact="High" color="red" />
                <ViolationRow label="Earphones / headphones detected in snapshot" impact="High" color="red" />
                <ViolationRow label="Book or textbook detected in snapshot" impact="Medium" color="amber" />
                <ViolationRow label="Microphone permission denied" impact="High" color="red" />
                <ViolationRow label="Voice assistant keyword detected (Hey Siri, OK Google...)" impact="High" color="red" />
                <ViolationRow label="Sustained gaze deviation (looking away > 3 sec)" impact="Medium" color="amber" />
                <ViolationRow label="Sustained speech (speaking > 5 sec)" impact="Medium" color="amber" />
                <ViolationRow label="Extended tab switch (away > 10 sec)" impact="Medium" color="amber" />
                <ViolationRow label="Fullscreen exit" impact="Low" color="blue" />
                <ViolationRow label="Tab switch / window blur" impact="Low" color="blue" />
                <ViolationRow label="Copy-paste attempt / right-click" impact="Very Low" color="green" />
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              {[
                { range: '0 – 39', label: 'Clean', desc: 'No significant violations. Normal exam behaviour.', color: 'border-green-300 bg-exam-green-light text-green-800' },
                { range: '40 – 69', label: 'Under Review', desc: 'Some flags detected. Faculty will review after exam.', color: 'border-amber-300 bg-exam-amber-light text-amber-800' },
                { range: '70 – 100', label: 'Flagged', desc: 'Multiple serious flags. Priority review by faculty.', color: 'border-red-300 bg-exam-red-light text-red-800' },
              ].map(({ range, label, desc, color }) => (
                <div key={range} className={clsx('rounded-xl border p-4', color)}>
                  <div className="text-lg font-bold">{range}</div>
                  <div className="font-semibold mt-0.5">{label}</div>
                  <p className="text-xs mt-1 leading-relaxed opacity-80">{desc}</p>
                </div>
              ))}
            </div>

            <InfoBox type="danger">
              <div>
                <strong>Consequences of confirmed cheating:</strong>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  <li>Cancellation of exam result</li>
                  <li>Ban from future RGIPT examinations</li>
                  <li>Disciplinary action as per RGIPT rules and regulations</li>
                </ul>
              </div>
            </InfoBox>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 6 — INTERNET DROPS                                    */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <SectionCard id="s6" icon={WifiOff} title="Section 6 — What Happens If Your Internet Drops">
          <div className="space-y-4">
            <InfoBox type="success">
              <strong>Your answers will not be lost.</strong> The system saves your answers automatically every 15 seconds to a secure server. Even a complete internet disconnection will not lose any answered question.
            </InfoBox>

            <div className="space-y-3">
              {[
                { icon: WifiOff, color: 'text-exam-red', bg: 'bg-red-50', step: 'Internet drops mid-exam',
                  desc: 'The exam screen will show a "Reconnecting…" message. Your timer continues running on the server. Do not close the browser tab.' },
                { icon: RefreshCw, color: 'text-exam-amber', bg: 'bg-amber-50', step: 'When your internet comes back',
                  desc: 'The exam page reconnects automatically (retries every 1s → 2s → 4s → 8s). Your answered questions are loaded back from the server. The timer shows the correct remaining time.' },
                { icon: CheckCircle, color: 'text-exam-green', bg: 'bg-green-50', step: 'Back to normal',
                  desc: 'All previous answers are restored. Continue from where you left off. No marks are deducted for disconnection time.' },
                { icon: AlertTriangle, color: 'text-exam-amber', bg: 'bg-amber-50', step: 'If you cannot reconnect',
                  desc: 'Contact the RGIPT exam helpline immediately. Do not close the browser. The session remains valid until the exam time window ends.' },
              ].map(({ icon: Icon, color, bg, step, desc }) => (
                <div key={step} className={clsx('flex items-start gap-4 rounded-xl p-4 border border-exam-border', bg)}>
                  <Icon className={clsx('w-5 h-5 mt-0.5 flex-shrink-0', color)} />
                  <div>
                    <div className="font-semibold text-exam-text text-sm">{step}</div>
                    <p className="text-xs text-exam-muted mt-1 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <InfoBox type="warning">
              <strong>Important:</strong> Your timer does NOT pause during disconnection. The server&apos;s clock is always the authority. You do not get extra time for network issues.
            </InfoBox>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 7 — WHAT IS NOT ALLOWED                               */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <SectionCard id="s7" icon={Lock} iconColor="bg-exam-red" title="Section 7 — What Is Not Allowed (Rules of the Exam)">
          <div className="space-y-4">
            <InfoBox type="danger">
              <strong>Violation of any of the following rules may result in result cancellation and exam ban.</strong> Every rule below is monitored by AI or visible in webcam snapshots.
            </InfoBox>

            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
              <ul className="space-y-0.5">
                <Rule allowed={false}>Mobile phone in the room or on the desk</Rule>
                <Rule allowed={false}>Second monitor, second screen, or TV screen</Rule>
                <Rule allowed={false}>Any other person in the room</Rule>
                <Rule allowed={false}>Headphones, earphones, or any audio device</Rule>
                <Rule allowed={false}>Written notes, handwritten formulas, or books near the desk</Rule>
                <Rule allowed={false}>Physical or digital calculator</Rule>
                <Rule allowed={false}>Sitting too close to the screen — your full upper body must be visible</Rule>
              </ul>
              <ul className="space-y-0.5">
                <Rule allowed={false}>Screen sharing or remote desktop (AnyDesk, TeamViewer, etc.)</Rule>
                <Rule allowed={false}>Virtual machine or emulator</Rule>
                <Rule allowed={false}>Talking to anyone during the exam</Rule>
                <Rule allowed={false}>Leaving the camera frame for more than 3 seconds</Rule>
                <Rule allowed={false}>Switching tabs, windows, or applications</Rule>
                <Rule allowed={false}>Using voice assistants (Siri, Google, Alexa, Cortana)</Rule>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-bold text-green-700 mb-2">What IS allowed:</h3>
              <ul className="space-y-0.5">
                <Rule allowed={true}>Blank scratch paper and pen on the desk for rough work — keep it in camera view</Rule>
                <Rule allowed={true}>A glass of water on the desk</Rule>
                <Rule allowed={true}>Brief glances away from the screen while thinking (under 3 seconds)</Rule>
                <Rule allowed={true}>Using the question navigator to jump between questions freely</Rule>
                <Rule allowed={true}>Changing your answer before final submission</Rule>
              </ul>
            </div>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 8 — WHAT IF SOMETHING GOES WRONG                      */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <SectionCard id="s8" icon={AlertTriangle} title="Section 8 — What Happens If Something Goes Wrong">
          <div className="space-y-3">
            {[
              { prob: 'Webcam stops working mid-exam', sol: 'The exam continues. Snapshot capture stops. You are flagged as "proctoring degraded". Your answers are safe. Report to faculty after submission.' },
              { prob: 'Microphone stops working mid-exam', sol: 'The exam continues. Voice monitoring stops. You are flagged. Report after submission. Exam is not paused.' },
              { prob: 'Power cut', sol: 'Reconnect your device. Open Chrome. Go to the exam URL. Log in again. Your answers are safe in the server. Re-verify your face. Resume where you left off.' },
              { prob: 'Browser or Chrome crashes', sol: 'Reopen Chrome. Type the exam URL. Log in with your roll number and email. Request a new OTP if needed. Your exam session will resume with all answers intact.' },
              { prob: 'Face verification fails repeatedly', sol: 'Do not close the browser. Stay on the verification screen. A faculty member will manually review and override if your identity is confirmed. Contact the helpline.' },
              { prob: 'Exam screen freezes', sol: 'Wait 30 seconds. If it does not recover, refresh the page. Your answers are saved every 15 seconds. Contact helpline if it does not resolve.' },
              { prob: 'You accidentally close the browser', sol: 'Immediately reopen Chrome, go to the exam URL, and log in. Your session is valid until the exam time window ends. All answers are preserved.' },
            ].map(({ prob, sol }) => (
              <div key={prob} className="border border-exam-border rounded-xl overflow-hidden">
                <div className="bg-red-50 border-b border-exam-border px-4 py-2.5 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-exam-red flex-shrink-0" />
                  <span className="text-sm font-semibold text-red-800">{prob}</span>
                </div>
                <div className="px-4 py-2.5 flex items-start gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-exam-green mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-exam-text leading-relaxed">{sol}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 9 — FINAL SUBMISSION                                  */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <SectionCard id="s9" icon={Send} title="Section 9 — Final Submission">
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 bg-exam-green-light border border-green-200 rounded-xl">
                  <CheckCircle className="w-5 h-5 text-exam-green flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-green-800 text-sm">Early Submission</div>
                    <p className="text-xs text-green-700 mt-1 leading-relaxed">
                      You can click &quot;Submit Exam&quot; at any time before the timer expires. A confirmation dialog will appear. Confirm only when you are sure — submission is final and cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-exam-amber-light border border-amber-200 rounded-xl">
                  <Clock className="w-5 h-5 text-exam-amber flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-amber-800 text-sm">Auto-Submit at Time End</div>
                    <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                      When the server timer reaches zero, your exam is submitted automatically. You do not need to click anything. Do not close the browser before you see the submission confirmation screen.
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 bg-exam-blue-light border border-blue-200 rounded-xl">
                  <FileText className="w-5 h-5 text-exam-blue flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-blue-800 text-sm">After Submission</div>
                    <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                      You will see a confirmation screen with your submission summary. Do not close it immediately — wait for the screen to fully load. All proctoring stops after submission.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-gray-50 border border-exam-border rounded-xl">
                  <BarChart2 className="w-5 h-5 text-exam-muted flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-exam-text text-sm">Results</div>
                    <p className="text-xs text-exam-muted mt-1 leading-relaxed">
                      Results will be announced by RGIPT on the official website. The date will be communicated separately. Faculty will complete violation reviews before results are published.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <InfoBox type="danger">
              <strong>Submission is permanent.</strong> Once you submit (or the timer expires), you cannot re-enter the exam, change answers, or view questions again. Make sure you have reviewed all questions before submitting early.
            </InfoBox>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SECTION 10 — FINAL CHECKLIST (last section, observed by IO)  */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div ref={lastSectionRef}>
          <SectionCard id="s10" icon={CheckSquare} iconColor="bg-exam-green" title="Section 10 — Final Checklist (Verify Before Clicking Start)">
            <div className="space-y-4">
              <p className="text-sm text-exam-muted">
                Go through each item below mentally before you click Start Exam. Every item must be true.
              </p>

              <div className="border border-exam-border rounded-xl overflow-hidden">
                <ul className="px-4 divide-y divide-exam-border">
                  <ChecklistItem>I am using <strong>Google Chrome or Microsoft Edge</strong> — not Firefox, Safari, or any other browser</ChecklistItem>
                  <ChecklistItem>I am on a <strong>laptop or desktop computer</strong> — not a mobile phone or tablet</ChecklistItem>
                  <ChecklistItem>My <strong>webcam is ON</strong> and I can see my face clearly in the preview — my face is well-lit and fully visible</ChecklistItem>
                  <ChecklistItem>I am sitting at <strong>arm's length from my screen (50–70 cm)</strong> — my full face, shoulders, and upper body are visible in the webcam preview</ChecklistItem>
                  <ChecklistItem>My <strong>microphone is working</strong> and I have granted microphone permission to the browser</ChecklistItem>
                  <ChecklistItem>I am <strong>alone in a quiet, well-lit room</strong> — no other person is visible or can be heard</ChecklistItem>
                  <ChecklistItem>My <strong>mobile phone is away from the desk</strong> — not on the table, not in my hand, not visible in the camera</ChecklistItem>
                  <ChecklistItem>There are <strong>no notes, books, or papers</strong> on or near my desk</ChecklistItem>
                  <ChecklistItem>I have <strong>closed WhatsApp Web, YouTube, Spotify, Teams</strong>, and all other applications — only my exam browser is open</ChecklistItem>
                  <ChecklistItem>My <strong>laptop is fully charged or plugged in</strong> to power — I will not face a power cut during the exam</ChecklistItem>
                  <ChecklistItem>I am <strong>not wearing earphones or headphones</strong></ChecklistItem>
                  <ChecklistItem>I have read and understood <strong>all 10 sections</strong> of these instructions</ChecklistItem>
                </ul>
              </div>

              <InfoBox type="warning">
                If any item above is not true, <strong>do not click Start Exam</strong>. Fix the issue first. Once the exam starts, you cannot pause it.
              </InfoBox>
            </div>
          </SectionCard>
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* DECLARATION + START BUTTON                                     */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-exam-border shadow-sm p-6 space-y-5">
          <h2 className="text-base font-bold text-exam-text">Declaration & Consent</h2>

          {/* Scroll gate message */}
          {!hasScrolledToBottom && (
            <div className="flex items-center gap-3 bg-exam-amber-light border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Please scroll through all sections above to unlock the Start button.</span>
            </div>
          )}

          {/* Checkbox */}
          <label className={clsx(
            'flex items-start gap-3 cursor-pointer rounded-xl border p-4 transition-colors',
            agreed
              ? 'border-exam-green bg-exam-green-light'
              : 'border-exam-border bg-gray-50 hover:border-exam-blue',
          )}>
            <div className={clsx(
              'flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 transition-colors',
              agreed ? 'bg-exam-green border-exam-green' : 'border-gray-400 bg-white'
            )}>
              {agreed && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>}
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span className={clsx('text-sm leading-relaxed', agreed ? 'text-green-800' : 'text-exam-text')}>
              I have read and understood all the above instructions and I agree to the terms and conditions of <strong>{examName}</strong>. I understand that any violation of the above rules may result in cancellation of my result and further disciplinary action under RGIPT regulations.
            </span>
          </label>

          {/* Status pills */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border font-medium',
              hasScrolledToBottom
                ? 'bg-exam-green-light border-green-300 text-green-700'
                : 'bg-gray-100 border-gray-300 text-gray-500'
            )}>
              {hasScrolledToBottom
                ? <><CheckCircle className="w-3.5 h-3.5" /> All sections read</>
                : <><Clock className="w-3.5 h-3.5" /> Scroll to bottom to unlock</>
              }
            </span>
            <span className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border font-medium',
              agreed
                ? 'bg-exam-green-light border-green-300 text-green-700'
                : 'bg-gray-100 border-gray-300 text-gray-500'
            )}>
              {agreed
                ? <><CheckCircle className="w-3.5 h-3.5" /> Declaration agreed</>
                : <><XCircle className="w-3.5 h-3.5" /> Declaration not agreed</>
              }
            </span>
          </div>

          {/* Start button */}
          <button
            onClick={canStart ? onStartExam : undefined}
            disabled={!canStart}
            className={clsx(
              'w-full py-4 rounded-xl font-bold text-base transition-all duration-200',
              canStart
                ? 'bg-exam-green text-white hover:bg-green-700 active:bg-green-800 shadow-lg shadow-green-200 cursor-pointer'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed select-none'
            )}
          >
            {canStart ? (
              <span className="flex items-center justify-center gap-2">
                <Zap className="w-5 h-5" />
                Start {examName} — I Am Ready
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Lock className="w-4 h-4" />
                {!hasScrolledToBottom
                  ? 'Read all instructions first (scroll down)'
                  : 'Check the declaration above to start'
                }
              </span>
            )}
          </button>

          <p className="text-xs text-exam-muted text-center leading-relaxed">
            By clicking Start, you confirm your identity and consent to AI proctoring for the entire exam duration.
            Your webcam, microphone, and screen activity will be monitored and recorded.
          </p>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-exam-muted pb-8 space-y-1">
          <p>Rajiv Gandhi Institute of Petroleum Technology (RGIPT) — {examName}</p>
          <p>For technical support during the exam, contact the RGIPT exam helpline.</p>
        </div>

      </div>
    </div>
  )
}
