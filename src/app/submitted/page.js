/**
 * Confirmation page shown after exam submission.
 */
export default function SubmittedPage() {
  return (
    <div className="min-h-screen bg-exam-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-exam-border p-10 max-w-md w-full text-center shadow-sm">
        <div className="w-16 h-16 bg-exam-green-light rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-exam-green" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-exam-text mb-3">Exam Submitted</h1>
        <p className="text-exam-muted text-sm mb-2">
          Your answers have been successfully recorded.
        </p>
        <p className="text-exam-muted text-sm">
          Results will be declared as per the official schedule. You may close this window.
        </p>
        <div className="mt-8 pt-6 border-t border-exam-border text-xs text-exam-muted">
          RGIPT DAT 2026 • Thank you for your participation
        </div>
      </div>
    </div>
  )
}
