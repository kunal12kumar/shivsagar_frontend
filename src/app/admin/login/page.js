'use client'
/**
 * Admin Login Page — /admin/login
 * Simple email + password form that calls POST /admin/auth/login.
 * On success, stores the JWT in localStorage and redirects to /admin.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { adminLogin } from '@/lib/api/adminClient'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [showPw, setShowPw]     = useState(false)

  // Already logged in? Skip straight to dashboard
  useEffect(() => {
    if (localStorage.getItem('rgipt-admin-token')) {
      router.replace('/admin')
    }
  }, [router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await adminLogin({ email: email.trim(), password })
      localStorage.setItem('rgipt-admin-token', res.data.access_token)
      localStorage.setItem('rgipt-admin-email', res.data.admin_email)
      router.replace('/admin')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-exam-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">

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
