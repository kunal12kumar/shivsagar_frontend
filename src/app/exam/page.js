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
import QuestionPanel from '@/components/exam/QuestionPanel'
import QuestionGrid from '@/components/exam/QuestionGrid'
import ExamTimer from '@/components/exam/ExamTimer'
import { VoiceMonitor } from '@/lib/proctoring/VoiceMonitor'
import { SnapshotWorker } from '@/lib/proctoring/SnapshotWorker'
import { getExamInfo, startExam, submitExam, getQuestionBatch } from '@/lib/api/client'
import { clsx } from 'clsx'

export default function ExamPage() {
  const router = useRouter()
  const videoRef = useRef(null)
  const voiceMonitorRef = useRef(null)
  const snapshotWorkerRef = useRef(null)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sidebarTab, setSidebarTab] = useState('grid') // 'grid' | 'info'
  const [examLoaded, setExamLoaded] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [paused, setPaused] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('connecting')

  const {
    jwt, examId, candidateId, candidateName,
    questions, currentQuestion, answers, examStatus,
    setExamMeta, setQuestions, setCurrentQuestion,
    setAnswer, confirmAnswer, addViolation,
    setConnected, setExamStatus, setIntegrityScore,
    syncFromServer, _hasHydrated
  } = useExamStore()

  // Guard: wait for localStorage hydration before redirecting to avoid false logout
  useEffect(() => {
    if (_hasHydrated && !jwt) router.push('/login')
  }, [_hasHydrated, jwt, router])

  // Load exam data and start WebSocket
  useEffect(() => {
    if (!jwt || !examId) return

    const load = async () => {
      try {
        const res = await getExamInfo(examId)
        const exam = res.data

        // Officially start the exam — this records exam_started_at for the candidate
        // and returns the authoritative end_time (fresh if the scheduled one expired).
        const startRes = await startExam(examId)
        const endTime = startRes.data.end_time

        setExamMeta({
          examTitle: exam.title,
          totalQuestions: exam.total_questions,
          examDuration: exam.duration_minutes,
          serverEndTime: endTime,   // ← always use the start-response end_time
          examStatus: 'active',
        })

        // Load first batch of questions
        const batchRes = await getQuestionBatch(examId, 0)
        setQuestions(batchRes.data.questions)
        setExamLoaded(true)
      } catch (err) {
        setLoadError('Failed to load exam. Please check your connection and try again.')
      }
    }

    load()

    // Connect WebSocket
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
    })
    const offPause = wsClient.on('EXAM_PAUSED', () => setPaused(true))
    const offResume = wsClient.on('EXAM_RESUMED', () => setPaused(false))
    const offScore = wsClient.on('INTEGRITY_UPDATE', (msg) => setIntegrityScore(msg.score))
    const offTimeUpdate = wsClient.on('TIMER_SYNC', (msg) => {
      useExamStore.setState({ serverEndTime: msg.end_time })
    })

    return () => {
      offConnected(); offDisconnected(); offUnavailable(); offRecovered()
      offBulkSync(); offAck()
      offPause(); offResume(); offScore(); offTimeUpdate()
    }
  }, [jwt, examId, candidateId])

  // Start proctoring when exam loads
  useEffect(() => {
    if (!examLoaded) return

    // Start voice monitoring
    const vm = new VoiceMonitor()
    voiceMonitorRef.current = vm
    vm.start((violation) => {
      addViolation(violation)
      wsClient.sendViolation({ ...violation, examId, candidateId })
    })

    // Start snapshot worker (requires webcam access)
    navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
        const sw = new SnapshotWorker()
        snapshotWorkerRef.current = sw
        sw.start(videoRef.current, examId, candidateId)
      })
      .catch(() => {
        // Webcam unavailable mid-exam — flag but continue
        wsClient.sendViolation({ type: 'camera_unavailable', severity: 3, examId, candidateId })
      })

    return () => {
      voiceMonitorRef.current?.stop()
      snapshotWorkerRef.current?.stop()
    }
  }, [examLoaded, examId, candidateId, addViolation])

  // Send pending answers to WS whenever answers state changes.
  // When WS is offline, immediately confirm locally so the "Saving…" spinner
  // doesn't persist — the answers are already in localStorage and will be
  // sent via REST on final submit.
  const answerStatus = useExamStore((s) => s.answerStatus)
  useEffect(() => {
    Object.entries(answerStatus).forEach(([qId, status]) => {
      if (status === 'pending') {
        if (connectionStatus === 'offline') {
          // No WS available — confirm locally; REST submit will persist these
          confirmAnswer(qId)
        } else {
          const ans = useExamStore.getState().answers[qId]
          if (ans !== undefined) wsClient.sendAnswer(qId, ans, examId)
        }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerStatus, examId, connectionStatus])

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      setExamStatus('submitted')
      await submitExam(examId, useExamStore.getState().answers)
      wsClient.disconnect()
      router.push('/submitted')
    } catch {
      setSubmitting(false)
    }
  }

  const handleNavigate = (idx) => {
    setCurrentQuestion(idx)
    // Prefetch next batch if near end of current batch
    if (idx > 0 && idx % 8 === 0) {
      const batchNum = Math.floor(idx / 10) + 1
      getQuestionBatch(examId, batchNum).then((res) => {
        const existing = useExamStore.getState().questions
        const newQs = res.data.questions.filter(q => !existing.find(e => e.id === q.id))
        useExamStore.setState({ questions: [...existing, ...newQs] })
      }).catch(() => {})
    }
  }

  // Wait for Zustand to rehydrate from localStorage before rendering
  if (!_hasHydrated || !jwt) return null

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

  return (
    <AntiCheatWrapper examId={examId}>
      <div className="h-screen bg-exam-bg flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex-shrink-0 bg-white border-b border-exam-border px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="font-bold text-exam-blue text-sm">RGIPT</div>
            <div className="h-4 w-px bg-exam-border" />
            <div className="text-sm text-exam-text font-medium">DAT 2026</div>
            <div className={clsx(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              connectionStatus === 'connected'    ? 'bg-exam-green-light text-exam-green' :
              connectionStatus === 'reconnecting' ? 'bg-exam-amber-light text-exam-amber' :
              /* offline */                         'bg-gray-100 text-gray-400'
            )}>
              {connectionStatus === 'connected'    ? '● Connected' :
               connectionStatus === 'reconnecting' ? '● Connecting...' :
               /* offline */                         '● Saving locally'}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ExamTimer onTimeUp={() => setShowSubmitDialog(true)} />
            <div className="text-sm text-exam-muted hidden sm:block">
              {candidateName}
            </div>
            <button
              onClick={() => setShowSubmitDialog(true)}
              className="bg-exam-red text-white text-sm px-4 py-1.5 rounded-lg font-medium hover:bg-red-700 transition-colors"
            >
              Submit Exam
            </button>
          </div>
        </div>

        {/* Pause overlay */}
        {paused && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
            <div className="bg-white rounded-2xl p-8 text-center">
              <div className="text-4xl mb-4">⏸️</div>
              <h2 className="text-xl font-bold text-exam-text">Exam Paused</h2>
              <p className="text-exam-muted text-sm mt-2">The exam has been paused by the administrator. Please wait.</p>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Question area */}
          <div className="flex-1 overflow-y-auto p-4 lg:p-6">
            <div className="max-w-2xl mx-auto">
              {/* Question breadcrumb */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-exam-muted">
                  Question <strong className="text-exam-text">{currentQuestion + 1}</strong> of {totalQ}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleNavigate(Math.max(0, currentQuestion - 1))}
                    disabled={currentQuestion === 0}
                    className="px-3 py-1.5 text-sm border border-exam-border rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => handleNavigate(Math.min(totalQ - 1, currentQuestion + 1))}
                    disabled={currentQuestion === totalQ - 1}
                    className="px-3 py-1.5 text-sm border border-exam-border rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
              <QuestionPanel
                question={currentQ}
                questionNumber={currentQuestion + 1}
                totalQuestions={totalQ}
              />
            </div>
          </div>

          {/* Right sidebar */}
          <div className="flex-shrink-0 w-64 border-l border-exam-border bg-white overflow-y-auto p-4 hidden lg:block">
            {/* Sidebar tabs */}
            <div className="flex mb-4 border border-exam-border rounded-lg overflow-hidden">
              {['grid', 'info'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSidebarTab(tab)}
                  className={clsx(
                    'flex-1 py-1.5 text-xs font-medium capitalize transition-colors',
                    sidebarTab === tab ? 'bg-exam-blue text-white' : 'text-exam-muted hover:bg-gray-50'
                  )}
                >
                  {tab === 'grid' ? 'Questions' : 'Info'}
                </button>
              ))}
            </div>

            {sidebarTab === 'grid' && (
              <QuestionGrid questions={questions} onNavigate={handleNavigate} />
            )}

            {sidebarTab === 'info' && (
              <div className="flex flex-col gap-3 text-sm">
                <div className="p-3 bg-exam-blue-light rounded-lg">
                  <div className="font-medium text-exam-blue mb-1">Exam Info</div>
                  <div className="text-exam-muted text-xs space-y-1">
                    <div>Total Questions: {totalQ}</div>
                    <div>Duration: 3 hours</div>
                    <div>Marking: +4 / −1</div>
                  </div>
                </div>
                <div className="p-3 bg-exam-amber-light rounded-lg">
                  <div className="font-medium text-exam-amber mb-1 text-xs">⚠️ Proctoring Active</div>
                  <div className="text-exam-muted text-xs space-y-1">
                    <div>• Face monitoring: ON</div>
                    <div>• Voice monitoring: ON</div>
                    <div>• Screen recording: ON</div>
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg text-xs text-exam-muted">
                  Webcam snapshots every 2 minutes. Do not leave this window.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Hidden video for snapshots */}
        <video ref={videoRef} className="hidden" muted playsInline />
      </div>

      {/* Submit dialog */}
      {showSubmitDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-exam-text mb-3">Submit Exam?</h3>
            <div className="space-y-2 text-sm text-exam-muted mb-6">
              <p>Once submitted, you cannot make any changes.</p>
              <div className="bg-exam-blue-light rounded-lg p-3 text-exam-text">
                <div className="font-medium mb-1">Summary</div>
                <div className="text-xs space-y-1">
                  <div>Answered: {Object.keys(answers).length} / {totalQ}</div>
                  <div>Not attempted: {totalQ - Object.keys(answers).length}</div>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSubmitDialog(false)}
                className="flex-1 py-2.5 border border-exam-border rounded-lg text-sm font-medium text-exam-muted hover:bg-gray-50"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-2.5 bg-exam-red text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Yes, Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AntiCheatWrapper>
  )
}
