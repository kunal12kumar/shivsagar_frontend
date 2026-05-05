'use client'
/**
 * /admin/live — Exam Readiness Dashboard (Exam Controller)
 *
 * Shows the exam controller which exams have questions published
 * by the Question Manager, and lets them START the exam.
 *
 * Workflow:
 *   1. Question Manager uploads PDF → reviews → approves → Go Live
 *   2. Exam Controller sees questions are live here
 *   3. Exam Controller clicks "Start Exam"
 *   4. Candidates see a 15-minute countdown, then questions appear
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  listExams, startExam, getAdminRole,
} from '@/lib/api/adminClient'

function fmtIST(isoStr) {
  if (!isoStr) return '—'
  try {
    return new Date(isoStr).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return isoStr }
}

export default function ExamReadinessPage() {
  const router = useRouter()

  const [exams, setExams]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [starting, setStarting] = useState(null) // exam id being started
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')

  // Auth guard — exam_controller only
  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('rgipt-admin-token')
    const role  = getAdminRole()
    if (!token) { router.replace('/admin/login'); return }
    if (role && role !== 'exam_controller') { router.replace('/admin/questions'); return }
  }, [router])

  const loadExams = useCallback(async () => {
    try {
      const { data } = await listExams()
      setExams(data || [])
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load exams')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadExams() }, [loadExams])

  async function handleStartExam(examId) {
    setStarting(examId)
    setError('')
    setSuccess('')
    try {
      await startExam(examId)
      setSuccess(`Exam #${examId} started successfully! Candidates will see a 15-minute countdown.`)
      loadExams()
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to start exam')
    } finally {
      setStarting(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center gap-5">
          <button
            onClick={() => router.push('/admin')}
            className="text-sm text-gray-500 hover:text-gray-800 font-medium flex items-center gap-1"
          >
            <span>←</span> Back to Monitor
          </button>
          <div className="w-px h-6 bg-gray-200" />
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center text-lg">🖥️</div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Exam Readiness</h1>
              <p className="text-xs text-gray-400">View published questions &amp; start exams</p>
            </div>
          </div>
          <div className="ml-auto">
            <span className="text-xs bg-emerald-100 text-emerald-700 font-bold px-3 py-1.5 rounded-full">
              Exam Controller
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Info banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">💡</span>
            <div>
              <p className="text-sm font-semibold text-blue-800">How it works</p>
              <ol className="text-sm text-blue-700 mt-1 space-y-1 list-decimal list-inside">
                <li><strong>Question Manager</strong> uploads a PDF, reviews questions, and publishes them (Go Live)</li>
                <li><strong>You (Exam Controller)</strong> verify questions are live below, then click <strong>Start Exam</strong></li>
                <li>Candidates see a <strong>15-minute countdown</strong> after you start — questions appear after the countdown</li>
              </ol>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700 flex items-start gap-2">
            <span>⚠️</span><span>{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-700 flex items-start gap-2">
            <span>✅</span><span>{success}</span>
          </div>
        )}

        {/* Exam list */}
        {exams.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <p className="text-5xl mb-4">📋</p>
            <p className="text-gray-600 text-lg font-semibold">No exams found</p>
            <p className="text-gray-400 text-sm mt-1">Ask the Question Manager to create an exam and publish questions first.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {exams.map(exam => {
              const hasQuestions = exam.questions_live_at || (exam.question_count && exam.question_count > 0)
              const isActive    = exam.status === 'active'
              const isCompleted = exam.status === 'completed'
              const isDraft     = exam.status === 'draft'
              const canStart    = hasQuestions && isDraft

              const statusColor =
                isActive    ? 'bg-green-100 text-green-700 border-green-200' :
                isCompleted ? 'bg-gray-100 text-gray-600 border-gray-200' :
                isDraft     ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                              'bg-blue-50 text-blue-700 border-blue-200'

              return (
                <div key={exam.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="p-6">
                    <div className="flex items-start gap-4">
                      {/* Left: Exam info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                          <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md">#{exam.id}</span>
                          <h3 className="text-lg font-bold text-gray-900">{exam.title}</h3>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${statusColor}`}>
                            {exam.status?.toUpperCase()}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                          <div className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs text-gray-500">Duration</p>
                            <p className="text-sm font-bold text-gray-800">{exam.duration_minutes} min</p>
                          </div>
                          <div className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs text-gray-500">Total Questions</p>
                            <p className="text-sm font-bold text-gray-800">{exam.question_count ?? exam.total_questions ?? '—'}</p>
                          </div>
                          <div className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs text-gray-500">Marks</p>
                            <p className="text-sm font-bold text-gray-800">+{exam.positive_marks} / −{exam.negative_marks}</p>
                          </div>
                          <div className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs text-gray-500">Scheduled</p>
                            <p className="text-sm font-bold text-gray-800">{fmtIST(exam.scheduled_for)}</p>
                          </div>
                        </div>

                        {/* Questions status */}
                        <div className={`rounded-xl p-4 border ${
                          hasQuestions
                            ? 'bg-green-50 border-green-200'
                            : 'bg-amber-50 border-amber-200'
                        }`}>
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{hasQuestions ? '✅' : '⏳'}</span>
                            <div>
                              <p className={`text-sm font-semibold ${hasQuestions ? 'text-green-700' : 'text-amber-700'}`}>
                                {hasQuestions
                                  ? `Questions are LIVE (published ${fmtIST(exam.questions_live_at)})`
                                  : 'Waiting for Question Manager to publish questions'
                                }
                              </p>
                              {hasQuestions && (
                                <p className="text-xs text-green-600 mt-0.5">
                                  {exam.question_count ?? '?'} questions ready for candidates
                                </p>
                              )}
                              {!hasQuestions && (
                                <p className="text-xs text-amber-600 mt-0.5">
                                  The Question Manager needs to upload a PDF, review questions, and click &quot;Go Live&quot;
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right: Start button */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {isActive ? (
                          <div className="text-center">
                            <span className="inline-flex items-center gap-2 px-5 py-3 bg-green-100 text-green-700 font-bold text-sm rounded-xl border border-green-200">
                              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                              EXAM RUNNING
                            </span>
                            <p className="text-xs text-gray-400 mt-2">
                              Started {fmtIST(exam.start_time)}
                            </p>
                          </div>
                        ) : isCompleted ? (
                          <span className="px-5 py-3 bg-gray-100 text-gray-500 font-bold text-sm rounded-xl border border-gray-200">
                            COMPLETED
                          </span>
                        ) : canStart ? (
                          <button
                            type="button"
                            onClick={() => handleStartExam(exam.id)}
                            disabled={starting === exam.id}
                            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-200 transition-all"
                          >
                            {starting === exam.id ? 'Starting…' : '▶ Start Exam'}
                          </button>
                        ) : (
                          <div className="text-center">
                            <button
                              disabled
                              className="px-6 py-3 bg-gray-100 text-gray-400 font-bold text-sm rounded-xl border border-gray-200 cursor-not-allowed"
                            >
                              ▶ Start Exam
                            </button>
                            <p className="text-xs text-gray-400 mt-2 max-w-[160px]">
                              {!hasQuestions ? 'Questions not published yet' : 'Exam not in draft status'}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
