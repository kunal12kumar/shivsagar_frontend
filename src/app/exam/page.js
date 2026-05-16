'use client'
/**
 * Exam page — the main exam interface.
 * Layout: left panel (question + options) + right sidebar (timer, grid, navigation).
 * All proctoring runs in background (non-blocking).
 * Auto-submits when timer expires.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import useExamStore from '@/lib/store/examStore'
import wsClient from '@/lib/ws/wsClient'
import AntiCheatWrapper from '@/components/exam/AntiCheatWrapper'
import ViolationWarningBanner from '@/components/exam/ViolationWarningBanner'
import QuestionPanel from '@/components/exam/QuestionPanel'
import QuestionGrid from '@/components/exam/QuestionGrid'
import ExamTimer from '@/components/exam/ExamTimer'
import { VoiceMonitor } from '@/lib/proctoring/VoiceMonitor'
import { SnapshotWorker } from '@/lib/proctoring/SnapshotWorker'
import { GazeTracker } from '@/lib/proctoring/GazeTracker'
import { getActiveExam, getExamInfo, startExam, submitExam, getAllQuestions, reportViolation } from '@/lib/api/client'
import { clsx } from 'clsx'

// ── 15-Minute Pre-Exam Countdown Screen ──────────────────────────────────────
function CountdownScreen({ initialSecs, candidateName, onDone }) {
  const [secs, setSecs] = useState(Math.max(0, initialSecs))

  useEffect(() => {
    if (secs <= 0) { onDone(); return }
    const t = setTimeout(() => setSecs(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [secs, onDone])

  const mins = Math.floor(secs / 60)
  const ss   = String(secs % 60).padStart(2, '0')
  const pct  = Math.max(0, Math.min(100, (1 - secs / (15 * 60)) * 100))

  return (
    <div className="min-h-screen bg-exam-navy flex items-center justify-center p-4">
      <div className="text-center max-w-lg w-full">
        {/* Logo */}
        <div className="mb-10">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">
            Rajiv Gandhi Institute of Petroleum Technology
          </p>
          <p className="text-white font-bold text-2xl">DAT 2026 — Exam Portal</p>
        </div>

        {/* Candidate greeting */}
        <p className="text-white/70 text-sm mb-8">
          Welcome, <span className="text-white font-semibold">{candidateName}</span>
        </p>

        {/* Countdown ring */}
        <div className="relative w-48 h-48 mx-auto mb-8">
          <svg className="w-48 h-48 -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
            <circle
              cx="60" cy="60" r="54" fill="none"
              stroke="#34d399" strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 54}`}
              strokeDashoffset={`${2 * Math.PI * 54 * (1 - pct / 100)}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-bold text-white tabular-nums">
              {mins}:{ss}
            </span>
            <span className="text-white/50 text-xs mt-1">remaining</span>
          </div>
        </div>

        {/* Status */}
        <div className="bg-white/10 rounded-2xl px-8 py-5 mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <p className="text-emerald-400 font-semibold text-sm">Exam is Live</p>
          </div>
          <p className="text-white/70 text-sm leading-relaxed">
            The exam has been started by the Exam Controller.
            Your question paper will appear automatically when the countdown ends.
          </p>
        </div>

        <div className="flex items-center justify-center gap-6 text-white/40 text-xs">
          <span>📋 Do not close this tab</span>
          <span>⏳ Questions appear after countdown</span>
        </div>
      </div>
    </div>
  )
}

export default function ExamPage() {
  const router = useRouter()
  const videoRef = useRef(null)
  const voiceMonitorRef = useRef(null)
  const snapshotWorkerRef = useRef(null)
  const gazeTrackerRef = useRef(null)
  const proctoringStarted = useRef(false)  // guard against Strict Mode double-invoke
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sidebarTab, setSidebarTab] = useState('grid') // 'grid' | 'info'
  const [examLoaded, setExamLoaded] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [paused, setPaused] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [toastMessage, setToastMessage] = useState(null) // { text, level: 'info'|'warn'|'error' }
  const [syncingCount, setSyncingCount] = useState(0) // unsynced answers count

  const showToast = useCallback((text, level = 'info', durationMs = 4000) => {
    setToastMessage({ text, level })
    setTimeout(() => setToastMessage(null), durationMs)
  }, [])

  // LocalStorage key for unsynced answers (survives page reload/WS disconnect)
  const _unsyncedKey = useCallback(
    () => `exam_unsynced_${examId}`,
    [examId]
  )

  const _markUnsynced = useCallback((qId, value) => {
    try {
      const raw = localStorage.getItem(_unsyncedKey()) || '{}'
      const buf = JSON.parse(raw)
      buf[qId] = { value, ts: Date.now(), synced: false }
      localStorage.setItem(_unsyncedKey(), JSON.stringify(buf))
      setSyncingCount(Object.values(buf).filter(v => !v.synced).length)
    } catch {}
  }, [_unsyncedKey])

  const _markSynced = useCallback((qId) => {
    try {
      const raw = localStorage.getItem(_unsyncedKey()) || '{}'
      const buf = JSON.parse(raw)
      if (buf[qId]) {
        buf[qId].synced = true
        localStorage.setItem(_unsyncedKey(), JSON.stringify(buf))
        setSyncingCount(Object.values(buf).filter(v => !v.synced).length)
      }
    } catch {}
  }, [_unsyncedKey])

  const _retryUnsynced = useCallback(async () => {
    if (connectionStatus !== 'connected') return
    try {
      const raw = localStorage.getItem(_unsyncedKey()) || '{}'
      const buf = JSON.parse(raw)
      const pending = Object.entries(buf).filter(([, v]) => !v.synced)
      if (!pending.length) return
      for (const [qId, entry] of pending) {
        let sent = false
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            wsClient.sendAnswer(qId, entry.value, examId)
            sent = true
            break
          } catch {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
          }
        }
        if (!sent) break // WS is down, will retry on next interval
      }
    } catch {}
  }, [connectionStatus, _unsyncedKey, examId])

  // 15-minute pre-exam countdown state
  const [countdownSecs, setCountdownSecs] = useState(null)  // null = not yet determined
  const [countdownDone, setCountdownDone] = useState(false)

  const {
    jwt, examId, candidateId, candidateName,
    questions, currentQuestion, answers, examStatus, submittedExamId,
    setExamMeta, setQuestions, setCurrentQuestion,
    setAnswer, confirmAnswer, addViolation,
    setConnected, setExamStatus, setIntegrityScore,
    syncFromServer, _hasHydrated
  } = useExamStore()

  // Guard: wait for localStorage hydration before redirecting to avoid false logout
  useEffect(() => {
    if (_hasHydrated && !jwt) router.push('/login')
  }, [_hasHydrated, jwt, router])

  // Guard: submitted for THIS exam → redirect to /submitted.
  // If the active exam is DIFFERENT from the one that was submitted, clear the
  // submitted status so the candidate can participate in the new exam.
  useEffect(() => {
    if (!_hasHydrated || examStatus !== 'submitted') return

    // We need the active exam id to compare. It's available in the store as examId
    // (updated by instructions/page.js from getActiveExam()). If they differ, reset.
    if (submittedExamId && examId && submittedExamId !== examId) {
      // New exam published — clear the lock so candidate can participate
      useExamStore.setState({ examStatus: 'not_started', submittedExamId: null })
      return
    }
    // Same exam (or no exam context yet) — stay locked
    router.replace('/submitted')
  }, [_hasHydrated, examStatus, router])

  // Load exam data and start WebSocket
  useEffect(() => {
    if (!jwt || !examId) return

    let cancelled = false  // guard against React Strict Mode double-invoke + async race

    const load = async () => {
      try {
        // Always fetch the ACTIVE exam — overrides stale examId from registration
        const activeRes = await getActiveExam()
        if (cancelled) return
        const activeExamId = activeRes.data.id

        // Update store if exam_id changed (candidate was on old paper)
        if (activeExamId !== examId) {
          useExamStore.setState({ examId: activeExamId })
        }

        const res = await getExamInfo(activeExamId)
        if (cancelled) return
        const exam = res.data

        // Officially start the exam — returns authoritative end_time & questions_available_at.
        // 409 = already submitted (backend enforces single-attempt rule).
        let startRes
        try {
          startRes = await startExam(activeExamId)
        } catch (startErr) {
          if (startErr.response?.status === 409) {
            // Candidate already submitted THIS exam — lock for this exam only
            useExamStore.setState({ examStatus: 'submitted', submittedExamId: activeExamId })
            router.replace('/submitted')
            return
          }
          throw startErr  // re-throw other errors to the outer catch
        }
        if (cancelled) return
        const endTime = startRes.data.end_time
        const questionsAt = startRes.data.questions_available_at

        setExamMeta({
          examTitle: exam.title,
          totalQuestions: exam.total_questions,
          examDuration: exam.duration_minutes,
          serverEndTime: endTime,
          questionsAvailableAt: questionsAt,
          examStatus: 'active',
        })

        // Compute countdown remaining
        const now = Date.now()
        const availAt = questionsAt ? new Date(questionsAt).getTime() : now
        const secsRemaining = Math.ceil((availAt - now) / 1000)

        if (secsRemaining > 0) {
          // Countdown in progress — don't load questions yet; CountdownScreen handles transition
          setCountdownSecs(secsRemaining)
        } else {
          // Countdown already over — load all questions immediately
          setCountdownDone(true)
          const allRes = await getAllQuestions(activeExamId)
          if (cancelled) return
          setQuestions(allRes.data.questions)
          setExamLoaded(true)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err.response?.data?.detail || err.message || 'Failed to load exam'
          setLoadError(msg)
        }
      }
    }

    load()

    // Connect WebSocket with the stored examId — the load() fn updates it if active exam differs.
    // wsClient.sendAnswer() etc. read examId from the store at call time, so this is fine.
    wsClient.connect(jwt, examId, candidateId)

    // WS event handlers
    const offConnected = wsClient.on('connected', () => {
      setConnected(true)
      setConnectionStatus('connected')
    })
    const offDisconnected = wsClient.on('disconnected', () => {
      setConnected(false)
      // Only show "Reconnecting" briefly — 'unavailable' will override to offline
      setConnectionStatus((prev) => prev === 'offline' ? 'offline' : 'reconnecting')
    })
    const offUnavailable = wsClient.on('unavailable', () => {
      setConnected(false)
      setConnectionStatus('offline')
      // Confirm all answers that are stuck in 'pending' so the Saving… spinner clears
      const { answerStatus: status } = useExamStore.getState()
      Object.entries(status).forEach(([qId, s]) => {
        if (s === 'pending') confirmAnswer(qId)
      })
    })
    const offRecovered = wsClient.on('recovered', () => {
      // WS came back after being offline — briefly show reconnecting before 'connected' fires
      setConnectionStatus('reconnecting')
    })
    const offBulkSync = wsClient.on('BULK_SYNC', (msg) => {
      syncFromServer(msg.answers || {})
    })
    const offAck = wsClient.on('ANSWER_ACK', (msg) => {
      confirmAnswer(msg.questionId)
      _markSynced(String(msg.questionId))
    })
    const offPause = wsClient.on('EXAM_PAUSED', () => setPaused(true))
    const offResume = wsClient.on('EXAM_RESUMED', () => setPaused(false))
    const offScore = wsClient.on('INTEGRITY_UPDATE', (msg) => setIntegrityScore(msg.score))
    const offTimeUpdate = wsClient.on('TIMER_SYNC', (msg) => {
      useExamStore.setState({ serverEndTime: msg.end_time })
    })
    // Server is shutting down (ECS task draining) — reconnect immediately to a healthy task
    const offShutdown = wsClient.on('SERVER_SHUTTING_DOWN', () => {
      setConnectionStatus('reconnecting')
      wsClient.disconnect()
      setTimeout(() => wsClient.connect(jwt, examId, candidateId), 500)
    })

    // Exam forcefully ended by controller — auto-submit and redirect
    const offEnded = wsClient.on('EXAM_ENDED', async () => {
      try {
        const endedExamId = useExamStore.getState().examId
        useExamStore.setState({ examStatus: 'submitted', submittedExamId: endedExamId })
        await submitExam(endedExamId, useExamStore.getState().answers)
      } catch (_) {}
      wsClient.disconnect()
      router.replace('/submitted')
    })

    return () => {
      cancelled = true
      offConnected(); offDisconnected(); offUnavailable(); offRecovered()
      offBulkSync(); offAck()
      offPause(); offResume(); offScore(); offTimeUpdate(); offEnded(); offShutdown()
    }
  }, [jwt, examId, candidateId])

  // Start proctoring when exam loads
  useEffect(() => {
    if (!examLoaded) return
    // Guard: React 18 Strict Mode double-invokes effects in dev.
    // This flag prevents double-starting all workers and double-sending the first violation.
    if (proctoringStarted.current) return
    proctoringStarted.current = true

    const sendProctoringViolation = (violation) => {
      addViolation(violation)
      reportViolation(examId, { type: violation.type, severity: violation.severity || 2 })
        .then(res => {
          if (res?.data?.integrity_score !== undefined) {
            setIntegrityScore(res.data.integrity_score)
          }
        })
        .catch(err => {
          console.error('[Proctoring] reportViolation failed:', err?.response?.status, err?.message)
        })
      wsClient.sendViolation({ ...violation, examId, candidateId })
    }

    // ── Voice Monitor ────────────────────────────────────────────────────────
    const vm = new VoiceMonitor()
    voiceMonitorRef.current = vm
    vm.start(sendProctoringViolation)

    // ── Snapshot Worker + Gaze Tracker (both need webcam) ────────────────────
    navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } })
      .then(async (stream) => {
        const video = videoRef.current
        if (!video) return

        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play()

        // Snapshot worker — captures JPEG every 2 min and uploads to S3
        const sw = new SnapshotWorker()
        snapshotWorkerRef.current = sw
        sw.start(video, examId, candidateId)

        // Gaze tracker — MediaPipe FaceMesh, detects look-away > 3s
        const gt = new GazeTracker()
        gazeTrackerRef.current = gt
        gt.start(video, sendProctoringViolation)
      })
      .catch((err) => {
        console.error('[Proctoring] Webcam access failed:', err)
        sendProctoringViolation({ type: 'camera_unavailable', severity: 3 })
      })

    return () => {
      proctoringStarted.current = false
      voiceMonitorRef.current?.stop()
      snapshotWorkerRef.current?.stop()
      gazeTrackerRef.current?.stop()
    }
  }, [examLoaded, examId, candidateId, addViolation, setIntegrityScore])

  // Load ALL questions once the countdown finishes
  useEffect(() => {
    if (!countdownDone || examLoaded) return
    const activeExamId = useExamStore.getState().examId
    if (!activeExamId) return
    getAllQuestions(activeExamId).then((res) => {
      setQuestions(res.data.questions)
      setExamLoaded(true)
    }).catch(() => {
      setLoadError('Failed to load questions after countdown. Please refresh.')
    })
  }, [countdownDone, examLoaded, setQuestions])

  // Background sync: retry unsynced answers every 10s while connected
  useEffect(() => {
    const id = setInterval(_retryUnsynced, 10_000)
    return () => clearInterval(id)
  }, [_retryUnsynced])

  // Send pending answers to WS whenever answers state changes.
  // When WS is offline, immediately confirm locally so the "Saving…" spinner
  // doesn't persist — the answers are already in localStorage and will be
  // sent via REST on final submit.
  const answerStatus = useExamStore((s) => s.answerStatus)
  useEffect(() => {
    Object.entries(answerStatus).forEach(([qId, status]) => {
      if (status === 'pending') {
        const ans = useExamStore.getState().answers[qId]
        if (connectionStatus === 'offline') {
          // No WS available — confirm locally; REST submit will persist these
          if (ans !== undefined) _markUnsynced(qId, ans)
          confirmAnswer(qId)
        } else {
          if (ans !== undefined) {
            _markUnsynced(qId, ans)
            wsClient.sendAnswer(qId, ans, examId)
          }
        }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerStatus, examId, connectionStatus])

  const handleSubmit = async () => {
    setSubmitting(true)
    const currentExamId = useExamStore.getState().examId
    try {
      // Record submission BEFORE the API call so a page-reload during submit
      // still shows the locked screen (idempotent — server upserts answers).
      useExamStore.setState({ examStatus: 'submitted', submittedExamId: currentExamId })
      await submitExam(currentExamId, useExamStore.getState().answers)
      wsClient.disconnect()
      // replace() removes /exam from history so the back button cannot reattempt
      router.replace('/submitted')
    } catch {
      // On failure, reset status so candidate can retry submit
      useExamStore.setState({ examStatus: 'active', submittedExamId: null })
      setSubmitting(false)
    }
  }

  const handleNavigate = (idx) => {
    setCurrentQuestion(idx)
    // All questions are loaded upfront via getAllQuestions — no lazy prefetching needed
  }

  // Wait for Zustand to rehydrate from localStorage before rendering
  if (!_hasHydrated || !jwt) return null

  // Synchronous guard: already submitted — show nothing while the useEffect redirects
  if (examStatus === 'submitted') return null

  if (loadError) {
    return (
      <div className="min-h-screen bg-exam-bg flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-exam-border p-8 max-w-md text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-exam-text mb-3">Failed to Load Exam</h2>
          <p className="text-exam-muted text-sm mb-6">{loadError}</p>
          <button onClick={() => window.location.reload()}
            className="bg-exam-blue text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700">
            Retry
          </button>
        </div>
      </div>
    )
  }

  // 15-minute pre-exam countdown screen
  if (countdownSecs !== null && !countdownDone && !examLoaded) {
    return (
      <CountdownScreen
        initialSecs={countdownSecs}
        candidateName={candidateName}
        onDone={() => setCountdownDone(true)}
      />
    )
  }

  if (!examLoaded) {
    return (
      <div className="min-h-screen bg-exam-bg flex items-center justify-center">
        <div className="text-center">
          <svg className="w-10 h-10 animate-spin text-exam-blue mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
          </svg>
          <p className="text-exam-muted">Loading your exam...</p>
        </div>
      </div>
    )
  }

  const currentQ = questions[currentQuestion]
  const totalQ = questions.length

  const answeredCount = Object.keys(answers).length
  const progressPct   = totalQ > 0 ? Math.round((answeredCount / totalQ) * 100) : 0

  return (
    <AntiCheatWrapper examId={examId}>
      <ViolationWarningBanner />
      <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#f1f5f9' }}>

        {/* ── Top bar ───────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-white shadow-sm px-5 py-0 flex items-stretch justify-between" style={{ minHeight: '56px', borderBottom: '1px solid #e2e8f0' }}>
          {/* Left: branding */}
          <div className="flex items-center gap-3">
            <div style={{ width: '4px', alignSelf: 'stretch', background: '#7c3aed', borderRadius: '0' }} />
            <div className="flex items-center gap-2.5 pl-1">
              <span className="font-extrabold text-slate-800 text-base tracking-tight">RGIPT</span>
              <span className="w-px h-5 bg-slate-200" />
              <span className="text-sm font-semibold text-slate-600">DAT 2026</span>
            </div>
            {/* Connection pill */}
            <span className={clsx(
              'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ml-1',
              connectionStatus === 'connected'    ? 'bg-emerald-100 text-emerald-700' :
              connectionStatus === 'reconnecting' ? 'bg-amber-100 text-amber-700' :
                                                    'bg-slate-100 text-slate-500'
            )}>
              <span className={clsx(
                'w-1.5 h-1.5 rounded-full',
                connectionStatus === 'connected'    ? 'bg-emerald-500 animate-pulse' :
                connectionStatus === 'reconnecting' ? 'bg-amber-500 animate-pulse' :
                                                      'bg-slate-400'
              )} />
              {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'reconnecting' ? 'Reconnecting…' : 'Offline'}
            </span>
          </div>

          {/* Right: timer + name + submit */}
          <div className="flex items-center gap-4">
            {/* Timer — ExamTimer has its own colored background */}
            <ExamTimer
              onTimeUp={() => setShowSubmitDialog(true)}
              onWarning={(msg) => showToast(msg, 'warn', 6000)}
            />
            {/* Candidate name */}
            <div className="hidden sm:flex items-center gap-2 text-sm font-semibold text-slate-700">
              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-extrabold">
                {candidateName?.charAt(0)?.toUpperCase() || 'C'}
              </div>
              {candidateName}
            </div>
            {/* Submit */}
            <button
              onClick={() => setShowSubmitDialog(true)}
              className="flex items-center gap-2 text-sm font-bold px-5 py-2 rounded-xl transition-all active:scale-95"
              style={{ background: '#dc2626', color: '#fff', boxShadow: '0 2px 8px rgba(220,38,38,0.3)' }}
            >
              Submit Exam
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex-shrink-0 h-1 bg-slate-200">
          <div
            className="h-1 transition-all duration-500"
            style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }}
          />
        </div>

        {/* ── Pause overlay ─────────────────────────────────────────────────── */}
        {paused && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-white rounded-3xl p-10 text-center shadow-2xl max-w-sm mx-4">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center text-3xl mx-auto mb-5">⏸️</div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">Exam Paused</h2>
              <p className="text-slate-500 text-sm">The exam controller has paused the exam. Please wait until it resumes.</p>
            </div>
          </div>
        )}

        {/* ── Main content ──────────────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">

          {/* Question area */}
          <div className="flex-1 overflow-y-auto" style={{ padding: '24px 28px' }}>
            <div style={{ maxWidth: '740px', margin: '0 auto' }}>

              {/* Breadcrumb + nav row */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500 font-medium">
                    Question <strong className="text-slate-800 text-base">{currentQuestion + 1}</strong>
                    <span className="text-slate-400"> / {totalQ}</span>
                  </span>
                  {/* Mini progress pill */}
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: '#ede9fe', color: '#7c3aed' }}>
                    {progressPct}% done
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleNavigate(Math.max(0, currentQuestion - 1))}
                    disabled={currentQuestion === 0}
                    className="flex items-center gap-1.5 text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ padding: '8px 18px', border: '2px solid #6366f1', color: '#4f46e5', background: '#fff' }}
                    onMouseEnter={e => { if (currentQuestion > 0) { e.currentTarget.style.background='#6366f1'; e.currentTarget.style.color='#fff' }}}
                    onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.color='#4f46e5' }}
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => handleNavigate(Math.min(totalQ - 1, currentQuestion + 1))}
                    disabled={currentQuestion === totalQ - 1}
                    className="flex items-center gap-1.5 text-sm font-semibold rounded-xl text-white transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ padding: '8px 18px', background: '#6366f1', boxShadow: '0 2px 8px rgba(99,102,241,0.3)' }}
                  >
                    Next →
                  </button>
                </div>
              </div>

              {/* Question panel */}
              <QuestionPanel
                question={currentQ}
                questionNumber={currentQuestion + 1}
                totalQuestions={totalQ}
              />

              {/* Bottom nav (duplicate for long questions) */}
              <div className="flex justify-between mt-6 pt-4 border-t border-slate-200">
                <button
                  onClick={() => handleNavigate(Math.max(0, currentQuestion - 1))}
                  disabled={currentQuestion === 0}
                  className="flex items-center gap-1.5 text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ padding: '8px 18px', border: '2px solid #6366f1', color: '#4f46e5', background: '#fff' }}
                  onMouseEnter={e => { if (currentQuestion > 0) { e.currentTarget.style.background='#6366f1'; e.currentTarget.style.color='#fff' }}}
                  onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.color='#4f46e5' }}
                >
                  ← Previous
                </button>
                <button
                  onClick={() => handleNavigate(Math.min(totalQ - 1, currentQuestion + 1))}
                  disabled={currentQuestion === totalQ - 1}
                  className="flex items-center gap-1.5 text-sm font-semibold rounded-xl text-white transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ padding: '8px 18px', background: '#6366f1', boxShadow: '0 2px 8px rgba(99,102,241,0.3)' }}
                >
                  Save &amp; Next →
                </button>
              </div>
            </div>
          </div>

          {/* ── Right sidebar ────────────────────────────────────────────────── */}
          <div className="flex-shrink-0 hidden lg:flex flex-col overflow-hidden"
            style={{ width: '288px', borderLeft: '1px solid #e2e8f0', background: '#fff' }}>

            {/* Sidebar header */}
            <div style={{ padding: '14px 16px 0', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
              <div className="flex rounded-xl overflow-hidden border border-slate-200 mb-3">
                {[['grid', 'Questions'], ['info', 'Info']].map(([tab, label]) => (
                  <button
                    key={tab}
                    onClick={() => setSidebarTab(tab)}
                    className="flex-1 py-2 text-xs font-bold transition-all"
                    style={{
                      background: sidebarTab === tab ? '#6366f1' : '#fff',
                      color: sidebarTab === tab ? '#fff' : '#64748b',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sidebar body — scrollable */}
            <div className="flex-1 overflow-y-auto" style={{ padding: '16px' }}>

              {sidebarTab === 'grid' && (
                <QuestionGrid questions={questions} onNavigate={handleNavigate} />
              )}

              {sidebarTab === 'info' && (
                <div className="flex flex-col gap-3 text-sm">
                  <div className="rounded-2xl p-4" style={{ background: '#ede9fe', border: '1px solid #ddd6fe' }}>
                    <div className="font-bold text-indigo-700 mb-2 text-xs uppercase tracking-wider">Exam Info</div>
                    <div className="space-y-1.5 text-xs text-indigo-900">
                      <div className="flex justify-between"><span className="text-indigo-600">Questions</span><strong>{totalQ}</strong></div>
                      <div className="flex justify-between"><span className="text-indigo-600">Duration</span><strong>3 hours</strong></div>
                      <div className="flex justify-between"><span className="text-indigo-600">Marking</span><strong>+4 / −1</strong></div>
                    </div>
                  </div>
                  <div className="rounded-2xl p-4" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
                    <div className="font-bold text-amber-700 mb-2 text-xs uppercase tracking-wider">⚠ Proctoring Active</div>
                    <div className="space-y-1.5 text-xs text-amber-800">
                      <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />Face monitoring: ON</div>
                      <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />Voice monitoring: ON</div>
                      <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />Screen recording: ON</div>
                    </div>
                  </div>
                  <div className="rounded-2xl p-3 text-xs text-slate-500 bg-slate-50 border border-slate-200">
                    Webcam snapshots every 60 sec. Do not leave this window.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Hidden video for snapshots */}
        <video ref={videoRef} className="hidden" muted playsInline />
      </div>

      {/* ── Submit dialog ──────────────────────────────────────────────────── */}
      {showSubmitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-3xl p-7 max-w-sm w-full shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center text-2xl mx-auto mb-4">📋</div>
            <h3 className="text-xl font-extrabold text-slate-800 text-center mb-1">Submit Exam?</h3>
            <p className="text-sm text-slate-500 text-center mb-5">Once submitted, you cannot make any changes.</p>

            {/* Summary */}
            <div className="rounded-2xl p-4 mb-5" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col items-center bg-emerald-50 rounded-xl py-3 border border-emerald-200">
                  <span className="text-2xl font-extrabold text-emerald-600">{answeredCount}</span>
                  <span className="text-xs text-emerald-600 font-semibold mt-0.5">Answered</span>
                </div>
                <div className="flex flex-col items-center bg-slate-50 rounded-xl py-3 border border-slate-200">
                  <span className="text-2xl font-extrabold text-slate-500">{totalQ - answeredCount}</span>
                  <span className="text-xs text-slate-500 font-semibold mt-0.5">Unattempted</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowSubmitDialog(false)}
                disabled={submitting}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-slate-600 transition-colors"
                style={{ border: '2px solid #e2e8f0', background: '#fff' }}
              >
                Go Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
                style={{ background: '#dc2626', boxShadow: '0 2px 8px rgba(220,38,38,0.3)' }}
              >
                {submitting ? 'Submitting…' : 'Yes, Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Toast notification ──────────────────────────────────────────── */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className={clsx(
            'px-5 py-3 rounded-2xl text-sm font-semibold shadow-xl transition-all',
            toastMessage.level === 'warn'  ? 'bg-amber-500 text-white' :
            toastMessage.level === 'error' ? 'bg-red-600 text-white' :
                                             'bg-slate-800 text-white'
          )}>
            {toastMessage.text}
          </div>
        </div>
      )}

      {/* ── Syncing indicator (unsynced answers) ────────────────────────── */}
      {syncingCount > 0 && (
        <div className="fixed bottom-6 right-6 z-40">
          <div className="flex items-center gap-2 bg-white border border-amber-300 text-amber-700 text-xs font-semibold px-3 py-2 rounded-full shadow-md">
            <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            Syncing {syncingCount} answer{syncingCount > 1 ? 's' : ''}…
          </div>
        </div>
      )}
    </AntiCheatWrapper>
  )
}
