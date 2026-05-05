'use client'
/**
 * instructions/page.js
 *
 * Exam instructions page — shown after the pre-exam checklist passes
 * and before the actual exam begins.
 *
 * On mount, fetches the currently ACTIVE exam from the backend so that
 * even if the candidate was registered under a different (older) exam_id,
 * they will be served the correct active exam paper.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import useExamStore from '@/lib/store/examStore'
import ExamInstructions from '@/components/instructions/ExamInstructions'
import { getActiveExam } from '@/lib/api/client'

export default function InstructionsPage() {
  const router = useRouter()
  const candidateName = useExamStore((s) => s.candidateName)
  const jwt = useExamStore((s) => s.jwt)
  const hasHydrated = useExamStore((s) => s._hasHydrated)
  const setAuth = useExamStore((s) => s.setAuth)
  const setExamMeta = useExamStore((s) => s.setExamMeta)

  const [activeExam, setActiveExam] = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [fetchDone, setFetchDone] = useState(false)

  // Redirect to login only after hydration
  useEffect(() => {
    if (hasHydrated && !jwt) {
      router.push('/login')
    }
  }, [hasHydrated, jwt, router])

  // Fetch the currently active exam to make sure we use the right exam_id
  useEffect(() => {
    if (!hasHydrated || !jwt) return

    getActiveExam()
      .then(({ data }) => {
        setActiveExam(data)
        // Update the store's examId to the ACTIVE exam — overrides stale registration exam_id
        setAuth({ examId: data.id })
        // Also update total questions / title from live exam
        setExamMeta({
          examTitle: data.title,
          totalQuestions: data.total_questions,
          examDuration: data.duration_minutes,
        })
      })
      .catch((err) => {
        // If no active exam yet, show a waiting screen
        const detail = err.response?.data?.detail || err.message
        setFetchError(detail)
      })
      .finally(() => setFetchDone(true))
  }, [hasHydrated, jwt, setAuth, setExamMeta])

  // Show nothing until localStorage is rehydrated
  if (!hasHydrated) return null
  if (!jwt) return null

  // Waiting for active exam fetch
  if (!fetchDone) {
    return (
      <div className="min-h-screen bg-exam-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-exam-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-exam-muted text-sm">Connecting to exam server…</p>
        </div>
      </div>
    )
  }

  // No active exam yet — show waiting screen
  if (fetchError) {
    return (
      <div className="min-h-screen bg-exam-bg flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-exam-border max-w-md w-full p-10 text-center">
          <p className="text-5xl mb-4">⏳</p>
          <h2 className="text-xl font-bold text-exam-navy mb-2">Exam Not Started Yet</h2>
          <p className="text-exam-muted text-sm mb-6">
            The Exam Controller has not started the exam. Please wait and refresh this page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 bg-exam-blue text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <ExamInstructions
      examName={activeExam?.title || 'DAT 2026'}
      duration={activeExam?.duration_minutes || 180}
      totalQuestions={activeExam?.total_questions || 90}
      candidateName={candidateName || 'Candidate'}
      onStartExam={() => router.push('/checklist')}
    />
  )
}
