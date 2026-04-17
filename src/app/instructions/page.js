'use client'
/**
 * instructions/page.js
 *
 * Exam instructions page — shown after the pre-exam checklist passes
 * and before the actual exam begins.
 *
 * Reads candidate info from the Zustand exam store (set during OTP login).
 * Calls router.push('/exam') when the candidate clicks Start Exam.
 *
 * Waits for Zustand localStorage hydration (_hasHydrated) before checking
 * auth to avoid a false redirect loop on page reload.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useExamStore from '@/lib/store/examStore'
import ExamInstructions from '@/components/instructions/ExamInstructions'

export default function InstructionsPage() {
  const router = useRouter()
  const candidateName = useExamStore((s) => s.candidateName)
  const jwt = useExamStore((s) => s.jwt)
  const hasHydrated = useExamStore((s) => s._hasHydrated)

  // Redirect to login only after hydration — avoids false redirect on refresh
  useEffect(() => {
    if (hasHydrated && !jwt) {
      router.push('/login')
    }
  }, [hasHydrated, jwt, router])

  // Show nothing until localStorage is rehydrated
  if (!hasHydrated) return null

  // Not authenticated
  if (!jwt) return null

  return (
    <ExamInstructions
      examName="DAT 2026"
      duration={180}
      totalQuestions={90}
      candidateName={candidateName || 'Candidate'}
      examDate="May 15, 2026"
      onStartExam={() => router.push('/exam')}
    />
  )
}
