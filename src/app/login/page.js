'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { candidateLogin } from '@/lib/api/client'
import useExamStore from '@/lib/store/examStore'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useExamStore((s) => s.setAuth)

  const [form, setForm] = useState({ rollNumber: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.rollNumber.trim() || !form.password.trim()) {
      setError('Please enter your roll number and password.')
      return
    }
    setLoading(true)
    try {
      const res = await candidateLogin({
        roll_number: form.rollNumber.trim().toUpperCase(),
        password: form.password,
      })
      const { access_token, candidate } = res.data
      setAuth({
        jwt: access_token,
        candidateId: candidate.id,
        candidateName: candidate.name,
        candidateEmail: candidate.email,
        examId: candidate.exam_id,
      })
      router.push('/instructions')
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid roll number or password.')
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
        <h2 className="text-lg font-semibold text-exam-text mb-1">Candidate Login</h2>
        <p className="text-sm text-exam-muted mb-6">
          Enter your roll number and password from your admit card.
        </p>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-exam-text mb-1.5">Roll Number</label>
            <input
              type="text"
              value={form.rollNumber}
              onChange={(e) => setForm({ ...form, rollNumber: e.target.value })}
              placeholder="e.g. DAT260001"
              className="w-full px-4 py-3 rounded-lg border border-exam-border text-exam-text placeholder-exam-muted
                         focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue bg-white text-sm uppercase tracking-wider"
              autoComplete="username"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-exam-text mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Password from admit card"
                className="w-full px-4 py-3 pr-12 rounded-lg border border-exam-border text-exam-text placeholder-exam-muted
                           focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue bg-white text-sm"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-exam-muted hover:text-exam-text"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-exam-red-light border border-red-200 text-exam-red text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <Button type="submit" loading={loading} className="w-full py-3 mt-1">
            Login
          </Button>
        </form>

        <div className="mt-6 pt-5 border-t border-exam-border">
          <p className="text-xs text-exam-muted text-center leading-relaxed">
            Use <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> only.<br />
            Ensure your webcam and microphone are connected and working.<br />
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
