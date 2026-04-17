'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useExamStore from '@/lib/store/examStore'
import PreExamChecklist from '@/components/checklist/PreExamChecklist'

export default function ChecklistPage() {
  const router = useRouter()
  const examId = useExamStore((s) => s.examId)
  const candidateId = useExamStore((s) => s.candidateId)
  const jwt = useExamStore((s) => s.jwt)
  const hasHydrated = useExamStore((s) => s._hasHydrated)

  // Guard: redirect to login only after hydration has completed
  useEffect(() => {
    if (hasHydrated && !jwt) {
      router.push('/login')
    }
  }, [hasHydrated, jwt, router])

  // Show nothing until store is hydrated from localStorage
  if (!hasHydrated) return null

  // Not authenticated
  if (!jwt) return null

  return (
    <div className="min-h-screen bg-exam-bg py-8 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-exam-text">Pre-Exam System Check</h1>
          <p className="text-exam-muted text-sm mt-1">Ensure everything is working before your exam starts</p>
        </div>
        <div className="bg-white rounded-2xl border border-exam-border shadow-sm p-6">
          <PreExamChecklist
            examId={examId}
            candidateId={candidateId}
            onComplete={() => router.push('/instructions')}
          />
        </div>
      </div>
    </div>
  )
}
