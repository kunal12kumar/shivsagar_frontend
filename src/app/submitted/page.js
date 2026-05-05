'use client'
/**
 * Exam submission confirmation page.
 *
 * Security:
 *  - Intercepts browser back-button / popstate so the candidate cannot
 *    navigate back to the exam page and reattempt.
 *  - Replaces the current history entry so /exam is not in the stack.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useExamStore from '@/lib/store/examStore'

export default function SubmittedPage() {
  const router = useRouter()
  const examStatus = useExamStore((s) => s.examStatus)
  const _hasHydrated = useExamStore((s) => s._hasHydrated)

  // Block back navigation — if the user presses back, push them forward to /submitted again
  useEffect(() => {
    // Push a duplicate entry so there is always a "forward" entry to return to
    window.history.pushState(null, '', window.location.href)

    const handlePopState = () => {
      // User pressed back — push them forward again
      window.history.pushState(null, '', window.location.href)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // If somehow someone lands here without having submitted (e.g. direct URL),
  // redirect them to login after hydration.
  useEffect(() => {
    if (_hasHydrated && examStatus !== 'submitted') {
      router.replace('/login')
    }
  }, [_hasHydrated, examStatus, router])

  return (
    <div className="min-h-screen bg-exam-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-exam-border p-10 max-w-md w-full text-center shadow-sm">
        <div className="w-16 h-16 bg-exam-green-light rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-exam-green" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-exam-text mb-3">Exam Submitted</h1>
        <p className="text-exam-muted text-sm mb-2">
          Your answers have been successfully recorded.
        </p>
        <p className="text-exam-muted text-sm mb-6">
          Results will be declared as per the official schedule. You may close this window.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-xs text-amber-700 mb-6">
          ⚠️ Do not press the back button — your exam has been locked and cannot be reattempted.
        </div>
        <div className="pt-4 border-t border-exam-border text-xs text-exam-muted">
          RGIPT DAT 2026 • Thank you for your participation
        </div>
      </div>
    </div>
  )
}
