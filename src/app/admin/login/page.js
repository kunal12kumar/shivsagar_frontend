'use client'
/**
 * Admin Login Page — /admin/login
 *
 * Two admin roles share this login page:
 *   • question_manager → /admin/questions  (upload PDFs, review, go-live)
 *   • exam_controller  → /admin            (candidates, start exam, monitor)
 *
 * If already logged in, shows a banner with current session and a
 * "Switch Account" button to log out and re-login as the other role.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { adminLogin } from '@/lib/api/adminClient'

const ROLE_LABELS = {
  question_manager: 'Question Manager',
  exam_controller:  'Exam Controller',
}
const ROLE_COLORS = {
  question_manager: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', icon: '📚' },
  exam_controller:  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: '🖥️' },
}

function clearSession() {
  localStorage.removeItem('rgipt-admin-token')
  localStorage.removeItem('rgipt-admin-email')
  localStorage.removeItem('rgipt-admin-role')
}

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [showPw, setShowPw]     = useState(false)

  // Existing session info (for "switch account" banner)
  const [existingRole, setExistingRole]   = useState(null)
  const [existingEmail, setExistingEmail] = useState(null)

  // Check for existing session on mount
  useEffect(() => {
    const token = localStorage.getItem('rgipt-admin-token')
    const role  = localStorage.getItem('rgipt-admin-role')
    const em    = localStorage.getItem('rgipt-admin-email')
    if (token && role) {
      setExistingRole(role)
      setExistingEmail(em)
    }
  }, [])

  function goToDashboard(role) {
    router.replace(role === 'exam_controller' ? '/admin' : '/admin/questions')
  }

  function handleSwitchAccount() {
    clearSession()
    setExistingRole(null)
    setExistingEmail(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // Clear any existing session before logging in
      clearSession()
      const res = await adminLogin({ email: email.trim(), password })
      localStorage.setItem('rgipt-admin-token', res.data.access_token)
      localStorage.setItem('rgipt-admin-email', res.data.admin_email)
      localStorage.setItem('rgipt-admin-role', res.data.role)
      goToDashboard(res.data.role)
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  const rc = ROLE_COLORS[existingRole] || ROLE_COLORS.question_manager

  return (
    <div className="min-h-screen bg-exam-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* ── Already logged in banner ── */}
        {existingRole && (
          <div className={`${rc.bg} ${rc.border} border rounded-2xl p-5 mb-4`}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">{rc.icon}</span>
              <div>
                <p className={`text-sm font-bold ${rc.text}`}>
                  Logged in as {ROLE_LABELS[existingRole] || existingRole}
                </p>
                {existingEmail && (
                  <p className="text-xs text-gray-500">{existingEmail}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => goToDashboard(existingRole)}
                className={`flex-1 px-4 py-2.5 ${rc.text} bg-white border ${rc.border} rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors`}
              >
                Go to Dashboard
              </button>
              <button
                type="button"
                onClick={handleSwitchAccount}
                className="flex-1 px-4 py-2.5 bg-gray-600 text-white rounded-xl text-sm font-semibold hover:bg-gray-700 transition-colors"
              >
                Switch Account
              </button>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="bg-white rounded-2xl border border-exam-border shadow-sm overflow-hidden">

          {/* Header strip */}
          <div className="bg-exam-navy px-8 py-6">
            <p className="text-xs text-white/60 uppercase tracking-widest mb-1">
              Rajiv Gandhi Institute of Petroleum Technology
            </p>
            <h1 className="text-xl font-bold text-white">Admin Panel</h1>
            <p className="text-sm text-white/70 mt-0.5">DAT 2026 Examination Portal</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-8 py-7 space-y-5">

            {/* Role hint */}
            <div className="flex gap-2 text-xs">
              <div className="flex-1 bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 text-center">
                <span className="block text-base mb-0.5">📚</span>
                <span className="font-semibold text-indigo-700">Question Manager</span>
                <span className="block text-indigo-400 mt-0.5">Upload &amp; review papers</span>
              </div>
              <div className="flex-1 bg-emerald-50 border border-emerald-100 rounded-lg p-2.5 text-center">
                <span className="block text-base mb-0.5">🖥️</span>
                <span className="font-semibold text-emerald-700">Exam Controller</span>
                <span className="block text-emerald-400 mt-0.5">Start exam &amp; monitor</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-exam-text mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-exam-border rounded-xl text-sm
                           focus:outline-none focus:ring-2 focus:ring-exam-blue/20 focus:border-exam-blue
                           transition-colors placeholder:text-exam-muted"
                placeholder="admin@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-exam-text mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 pr-10 border border-exam-border rounded-xl text-sm
                             focus:outline-none focus:ring-2 focus:ring-exam-blue/20 focus:border-exam-blue
                             transition-colors placeholder:text-exam-muted"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-exam-muted hover:text-exam-text text-xs"
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50
                              border border-red-200 rounded-xl px-4 py-3">
                <span className="mt-px">⚠</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-exam-blue text-white rounded-xl text-sm font-semibold
                         hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed
                         transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign In to Admin Panel'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-exam-muted mt-4">
          RGIPT AI-Proctored Examination System · Admin Access Only
        </p>
      </div>
    </div>
  )
}
