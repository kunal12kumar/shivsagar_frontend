'use client'
/**
 * Login page — OTP-based authentication.
 * Step 1: Enter roll number + email → OTP sent via AWS SES
 * Step 2: Enter 6-digit OTP → JWT issued → redirect to /checklist
 *
 * No passwords. Candidates authenticate only with their registered email.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendOTP, verifyOTP } from '@/lib/api/client'
import useExamStore from '@/lib/store/examStore'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useExamStore((s) => s.setAuth)

  const [step, setStep] = useState(1) // 1 = enter details, 2 = enter OTP
  const [form, setForm] = useState({ rollNumber: '', email: '' })
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSendOTP = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.rollNumber.trim() || !form.email.trim()) {
      setError('Please enter your roll number and registered email.')
      return
    }
    setLoading(true)
    try {
      await sendOTP({ roll_number: form.rollNumber.trim(), email: form.email.trim().toLowerCase() })
      setStep(2)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to send OTP. Please check your details.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOTP = async (e) => {
    e.preventDefault()
    setError('')
    if (otp.length !== 6) {
      setError('Please enter the 6-digit OTP sent to your email.')
      return
    }
    setLoading(true)
    try {
      const res = await verifyOTP({ roll_number: form.rollNumber.trim(), otp })
      const { access_token, candidate } = res.data
      setAuth({
        jwt: access_token,
        candidateId: candidate.id,
        candidateName: candidate.name,
        candidateEmail: candidate.email,
        examId: candidate.exam_id,
      })
      router.push('/checklist')
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid OTP. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-exam-bg flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-exam-blue mb-4">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-exam-text">RGIPT Exam Portal</h1>
        <p className="text-exam-muted text-sm mt-1">DAT 2026 — AI-Proctored Online Examination</p>
      </div>

      <Card className="w-full max-w-md">
        {step === 1 ? (
          <>
            <h2 className="text-lg font-semibold text-exam-text mb-1">Candidate Login</h2>
            <p className="text-sm text-exam-muted mb-6">
              Enter your roll number and registered email. An OTP will be sent to your email.
            </p>
            <form onSubmit={handleSendOTP} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-exam-text mb-1.5">Roll Number</label>
                <input
                  type="text"
                  value={form.rollNumber}
                  onChange={(e) => setForm({ ...form, rollNumber: e.target.value })}
                  placeholder="e.g. 23CS3035"
                  className="w-full px-4 py-3 rounded-lg border border-exam-border text-exam-text placeholder-exam-muted focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue bg-white text-sm"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-exam-text mb-1.5">Registered Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="your@email.com"
                  className="w-full px-4 py-3 rounded-lg border border-exam-border text-exam-text placeholder-exam-muted focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue bg-white text-sm"
                  autoComplete="email"
                />
              </div>
              {error && (
                <div className="bg-exam-red-light border border-red-200 text-exam-red text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}
              <Button type="submit" loading={loading} className="w-full py-3 mt-1">
                Send OTP to Email
              </Button>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-exam-text mb-1">Enter OTP</h2>
            <p className="text-sm text-exam-muted mb-6">
              A 6-digit OTP was sent to <strong>{form.email}</strong>. Enter it below.
            </p>
            <form onSubmit={handleVerifyOTP} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-exam-text mb-1.5">OTP Code</label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit OTP"
                  className="w-full px-4 py-3 rounded-lg border border-exam-border text-exam-text text-center text-2xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-exam-blue bg-white"
                  autoFocus
                  maxLength={6}
                />
              </div>
              {error && (
                <div className="bg-exam-red-light border border-red-200 text-exam-red text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}
              <Button type="submit" loading={loading} className="w-full py-3">
                Verify & Login
              </Button>
              <button
                type="button"
                onClick={() => { setStep(1); setOtp(''); setError('') }}
                className="text-sm text-exam-blue hover:underline text-center"
              >
                ← Back / Resend OTP
              </button>
            </form>
          </>
        )}

        {/* Important notice */}
        <div className="mt-6 pt-5 border-t border-exam-border">
          <p className="text-xs text-exam-muted text-center leading-relaxed">
            Use <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> only.<br/>
            Ensure your webcam and microphone are connected and working.<br/>
            Keep your government-issued ID ready for verification.
          </p>
        </div>
      </Card>

      <p className="text-xs text-exam-muted mt-6">
        RGIPT Exam Portal v1.0 • Powered by AI Proctoring
      </p>
    </div>
  )
}
