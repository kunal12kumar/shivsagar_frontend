'use client'
/**
 * Admin Dashboard — /admin
 * Full exam-monitoring and management interface for faculty/admin.
 *
 * Tabs:
 *   Live Monitor  — candidate grid + violation feed + emergency controls
 *   Results       — compute + view result table
 *   Exam Control  — start exam, extend time, block candidates
 *
 * Auth: reads 'rgipt-admin-token' from localStorage.
 *       Redirects to /admin/login if not present or on 401.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  getCandidates, getViolations, controlExam,
  startExam, getResults, computeResults, indexFace,
} from '@/lib/api/adminClient'
import { clsx } from 'clsx'

// ── Constants ─────────────────────────────────────────────────────────────────

const EXAM_ID = 1

const SEV_LABEL = { 1:'Low', 2:'Low', 3:'Medium', 4:'Medium', 5:'High', 6:'Critical', 7:'Critical', 8:'Critical' }
const SEV_COLOR = {
  1:'text-gray-400', 2:'text-gray-400',
  3:'text-amber-600', 4:'text-amber-600',
  5:'text-red-600', 6:'text-red-600',
  7:'text-red-700 font-bold', 8:'text-red-700 font-bold',
}

// ── Small components ──────────────────────────────────────────────────────────

function IntegrityBadge({ score }) {
  const s = score || 0
  return (
    <span className={clsx(
      'inline-block text-xs font-bold px-2 py-0.5 rounded-full',
      s >= 70 ? 'bg-red-100 text-red-700' :
      s >= 40 ? 'bg-amber-100 text-amber-700' :
               'bg-green-100 text-green-700'
    )}>
      {s}
    </span>
  )
}

function StatCard({ label, value, color, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-exam-border p-5 text-center">
      <div className={clsx('text-4xl font-extrabold', color)}>{value}</div>
      <div className="text-xs font-semibold text-exam-muted mt-1 uppercase tracking-wide">{label}</div>
      {sub && <div className="text-xs text-exam-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function CandidateCard({ candidate, style, onClick }) {
  const s = candidate.integrity_score || 0
  return (
    <div style={style} onClick={() => onClick(candidate)} className="p-1 cursor-pointer">
      <div className={clsx(
        'h-full rounded-xl border p-2 text-xs flex flex-col justify-between transition-all hover:shadow-sm hover:border-exam-blue',
        s >= 70 ? 'border-red-300 bg-red-50' :
        s >= 40 ? 'border-amber-200 bg-amber-50' :
                 'border-exam-border bg-white'
      )}>
        <div className="font-semibold text-exam-text truncate">{candidate.name}</div>
        <div className="text-exam-muted truncate text-[11px]">{candidate.roll_number}</div>
        <div className="flex items-center justify-between mt-1">
          <span className={clsx('w-2 h-2 rounded-full', candidate.connected ? 'bg-green-500' : 'bg-gray-300')} />
          <IntegrityBadge score={s} />
        </div>
      </div>
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-5 py-2 text-sm font-semibold rounded-lg transition-colors',
        active
          ? 'bg-exam-blue text-white'
          : 'text-exam-muted hover:text-exam-text hover:bg-gray-100'
      )}
    >
      {children}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter()

  // ── Auth state
  const [adminEmail, setAdminEmail] = useState('')
  const [authReady, setAuthReady]   = useState(false)

  // ── Data state
  const [candidates, setCandidates] = useState([])
  const [violations, setViolations] = useState([])
  const [results, setResults]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [resultsLoading, setResultsLoading] = useState(false)

  // ── UI state
  const [tab, setTab]               = useState('monitor')   // monitor | results | control | enroll
  const [search, setSearch]         = useState('')
  const [selected, setSelected]     = useState(null)        // candidate detail modal
  const [toast, setToast]           = useState(null)        // {msg, ok}
  // Face enrollment state: { [candidateId]: 'idle'|'uploading'|'done'|'error', message? }
  const [enrollStatus, setEnrollStatus] = useState({})
  const [enrollPreview, setEnrollPreview] = useState({})   // { [candidateId]: objectURL }
  const fileInputRefs               = useRef({})           // { [candidateId]: <input> }
  const wsRef                       = useRef(null)

  const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'

  // ── Auth check ────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('rgipt-admin-token')
    const email = localStorage.getItem('rgipt-admin-email')
    if (!token) {
      router.replace('/admin/login')
      return
    }
    setAdminEmail(email || 'Admin')
    setAuthReady(true)
  }, [router])

  // ── Toast helper
  const showToast = useCallback((msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Load data
  useEffect(() => {
    if (!authReady) return

    Promise.all([getCandidates(EXAM_ID), getViolations(EXAM_ID)])
      .then(([cRes, vRes]) => {
        setCandidates(cRes.data)
        setViolations(vRes.data.slice(0, 100))
      })
      .catch(() => showToast('Failed to load data', false))
      .finally(() => setLoading(false))

    // Admin WebSocket
    const token = localStorage.getItem('rgipt-admin-token')
    if (token) {
      const ws = new WebSocket(`${WS_BASE}/ws/admin?token=${token}`)
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'CANDIDATE_UPDATE') {
            setCandidates(prev => prev.map(c => c.id === msg.candidate_id ? { ...c, ...msg.data } : c))
          }
          if (msg.type === 'VIOLATION') {
            setViolations(prev => [msg, ...prev].slice(0, 200))
          }
          if (msg.type === 'INTEGRITY_UPDATE') {
            setCandidates(prev => prev.map(c =>
              c.id === msg.candidate_id ? { ...c, integrity_score: msg.score } : c
            ))
          }
        } catch (_) {}
      }
    }

    return () => wsRef.current?.close()
  }, [authReady, WS_BASE, showToast])

  // ── Computed ──────────────────────────────────────────────────────────────
  const filtered = candidates.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.roll_number?.toLowerCase().includes(search.toLowerCase())
  )

  const stats = {
    total:     candidates.length,
    connected: candidates.filter(c => c.connected).length,
    watch:     candidates.filter(c => (c.integrity_score || 0) >= 40 && (c.integrity_score || 0) < 70).length,
    flagged:   candidates.filter(c => (c.integrity_score || 0) >= 70).length,
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleControl = async (action, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    try {
      await controlExam(EXAM_ID, action)
      showToast(`Action "${action}" applied`)
    } catch {
      showToast('Failed to send command', false)
    }
  }

  const handleStartExam = async () => {
    if (!window.confirm('Start the exam now? This sets status = ACTIVE and broadcasts to all candidates.')) return
    try {
      await startExam(EXAM_ID)
      showToast('Exam started!')
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to start exam', false)
    }
  }

  const handleComputeResults = async () => {
    try {
      setResultsLoading(true)
      await computeResults(EXAM_ID)
      showToast('Result computation queued — refresh in ~30s')
    } catch {
      showToast('Failed to queue computation', false)
    } finally {
      setResultsLoading(false)
    }
  }

  const handleLoadResults = async () => {
    setResultsLoading(true)
    try {
      const res = await getResults(EXAM_ID)
      setResults(res.data)
      if (res.data.length === 0) showToast('No results yet — compute first', false)
    } catch {
      showToast('Failed to load results', false)
    } finally {
      setResultsLoading(false)
    }
  }

  const handleBlockCandidate = async (candidateId) => {
    if (!window.confirm('Block this candidate? They will be removed from the exam.')) return
    try {
      await controlExam(EXAM_ID, `block_${candidateId}`)
      setCandidates(prev => prev.map(c => c.id === candidateId ? { ...c, is_blocked: true } : c))
      setSelected(null)
      showToast('Candidate blocked')
    } catch {
      showToast('Failed to block candidate', false)
    }
  }

  const handleFileSelect = (candidateId) => (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Show preview
    const url = URL.createObjectURL(file)
    setEnrollPreview(prev => ({ ...prev, [candidateId]: url }))
    // Auto-trigger upload
    handleIndexFace(candidateId, file)
  }

  const handleIndexFace = async (candidateId, file) => {
    setEnrollStatus(prev => ({ ...prev, [candidateId]: { state: 'uploading' } }))
    try {
      const res = await indexFace(candidateId, file)
      setEnrollStatus(prev => ({
        ...prev,
        [candidateId]: { state: 'done', message: res.data.message, faceId: res.data.face_id },
      }))
      // Update candidate in list so photo_indexed flips to true
      setCandidates(prev => prev.map(c =>
        c.id === candidateId
          ? { ...c, photo_indexed: true, rekognition_face_id: res.data.face_id, photo_s3_key: res.data.s3_key }
          : c
      ))
      showToast(`Face enrolled for ${res.data.name}`)
    } catch (err) {
      const msg = err.response?.data?.detail || 'Upload failed'
      setEnrollStatus(prev => ({ ...prev, [candidateId]: { state: 'error', message: msg } }))
      showToast(msg, false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('rgipt-admin-token')
    localStorage.removeItem('rgipt-admin-email')
    router.push('/admin/login')
  }

  // ── Wait for auth check
  if (!authReady) return null

  return (
    <div className="min-h-screen bg-exam-bg flex flex-col">

      {/* ── Top header ──────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-exam-border px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-exam-blue text-lg">RGIPT</span>
            <span className="text-exam-muted text-sm hidden sm:block">Admin · DAT 2026</span>
          </div>
          {/* Tabs */}
          <nav className="flex gap-1 ml-4">
            <TabButton active={tab === 'monitor'} onClick={() => setTab('monitor')}>
              📊 Live Monitor
            </TabButton>
            <TabButton active={tab === 'results'} onClick={() => { setTab('results'); handleLoadResults() }}>
              🏆 Results
            </TabButton>
            <TabButton active={tab === 'control'} onClick={() => setTab('control')}>
              ⚙ Exam Control
            </TabButton>
            <TabButton active={tab === 'enroll'} onClick={() => setTab('enroll')}>
              👤 Face Enrollment
            </TabButton>
            <TabButton active={false} onClick={() => router.push('/admin/questions')}>
              📚 Questions
            </TabButton>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-exam-muted hidden md:block">{adminEmail}</span>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs border border-exam-border rounded-lg text-exam-muted hover:text-exam-text hover:bg-gray-50 transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      {toast && (
        <div className={clsx(
          'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all',
          toast.ok ? 'bg-green-600' : 'bg-red-600'
        )}>
          {toast.msg}
        </div>
      )}

      {/* ── Tab: Live Monitor ────────────────────────────────────────────── */}
      {tab === 'monitor' && (
        <div className="flex-1 p-4 flex flex-col gap-4">

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total"     value={stats.total}     color="text-exam-blue"  />
            <StatCard label="Connected" value={stats.connected} color="text-green-600"  />
            <StatCard label="Watch"     value={stats.watch}     color="text-amber-600"  sub="Score 40–69" />
            <StatCard label="Flagged"   value={stats.flagged}   color="text-red-600"    sub="Score ≥ 70" />
          </div>

          {/* Emergency controls bar */}
          <div className="bg-white rounded-2xl border border-exam-border px-4 py-3 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-exam-muted uppercase tracking-wide mr-2">Emergency:</span>
            <button onClick={() => handleControl('pause',   'Pause exam for all candidates?')}
              className="px-3 py-1.5 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg font-medium hover:bg-amber-100">
              ⏸ Pause All
            </button>
            <button onClick={() => handleControl('resume',  'Resume exam for all candidates?')}
              className="px-3 py-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg font-medium hover:bg-green-100">
              ▶ Resume All
            </button>
            <button onClick={() => handleControl('extend', 'Extend exam time by 15 minutes?')}
              className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-medium hover:bg-blue-100">
              +15 min
            </button>
          </div>

          {/* Candidate grid + violation feed */}
          <div className="flex gap-4 flex-1 min-h-0">

            {/* Candidate grid */}
            <div className="flex-1 bg-white rounded-2xl border border-exam-border p-4 min-h-[480px]">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-exam-text">
                  Candidates
                  <span className="ml-2 text-xs font-normal text-exam-muted">
                    {filtered.length} shown
                  </span>
                </h2>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name / roll…"
                  className="text-sm px-3 py-1.5 border border-exam-border rounded-xl w-48
                             focus:outline-none focus:ring-1 focus:ring-exam-blue focus:border-exam-blue"
                />
              </div>

              {loading ? (
                <div className="text-center py-16 text-exam-muted">Loading candidates…</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-exam-muted">No candidates found</div>
              ) : (
                <div className="grid gap-1 overflow-y-auto max-h-[420px]"
                     style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                  {filtered.map((c) => (
                    <CandidateCard key={c.id} candidate={c} style={{}} onClick={setSelected} />
                  ))}
                </div>
              )}

              {/* Legend */}
              <div className="flex gap-4 mt-3 text-xs text-exam-muted">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-green-100 border border-green-200 inline-block" /> Score &lt; 40
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-amber-50 border border-amber-200 inline-block" /> 40–69
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-red-50 border border-red-200 inline-block" /> ≥ 70
                </span>
              </div>
            </div>

            {/* Violation feed */}
            <div className="w-80 flex-shrink-0 bg-white rounded-2xl border border-exam-border p-4 flex flex-col max-h-[600px]">
              <h2 className="font-bold text-exam-text mb-3 flex items-center gap-2">
                Live Violations
                <span className="text-xs font-normal text-exam-muted">
                  {violations.length} total
                </span>
              </h2>
              <div className="flex-1 overflow-y-auto space-y-2">
                {violations.length === 0 ? (
                  <div className="text-center py-10 text-exam-muted text-sm">No violations yet</div>
                ) : (
                  violations.map((v, i) => (
                    <div key={i} className={clsx(
                      'p-3 rounded-xl border text-xs',
                      v.severity >= 5 ? 'border-red-200 bg-red-50' :
                      v.severity >= 3 ? 'border-amber-200 bg-amber-50' :
                                       'border-gray-100 bg-gray-50'
                    )}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className={clsx('font-semibold', SEV_COLOR[v.severity] || 'text-exam-text')}>
                            {v.type?.replace(/_/g, ' ')}
                          </span>
                          <div className="text-exam-muted mt-0.5 truncate">
                            {v.candidate_name || v.candidateId}
                          </div>
                        </div>
                        <span className={clsx('text-[10px] flex-shrink-0 font-medium', SEV_COLOR[v.severity])}>
                          {SEV_LABEL[v.severity]}
                        </span>
                      </div>
                      {v.snapshot_url && (
                        <a href={v.snapshot_url} target="_blank" rel="noreferrer"
                          className="text-exam-blue underline mt-1 block text-[11px]">
                          View snapshot →
                        </a>
                      )}
                      <div className="text-gray-400 mt-1">
                        {v.created_at
                          ? new Date(v.created_at).toLocaleTimeString()
                          : v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Results ─────────────────────────────────────────────────── */}
      {tab === 'results' && (
        <div className="flex-1 p-4 flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-exam-border p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-exam-text">Exam Results — DAT 2026</h2>
                <p className="text-sm text-exam-muted mt-0.5">
                  Results are computed after the exam ends. Trigger computation once, then refresh.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleComputeResults}
                  disabled={resultsLoading}
                  className="px-4 py-2 text-sm bg-exam-blue text-white rounded-xl font-medium
                             hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {resultsLoading ? 'Working…' : '⚡ Compute Results'}
                </button>
                <button
                  onClick={handleLoadResults}
                  disabled={resultsLoading}
                  className="px-4 py-2 text-sm border border-exam-border rounded-xl font-medium
                             hover:bg-gray-50 disabled:opacity-60 transition-colors"
                >
                  🔄 Refresh
                </button>
              </div>
            </div>

            {results.length === 0 ? (
              <div className="text-center py-16 text-exam-muted">
                <div className="text-4xl mb-3">🏆</div>
                <p>No results yet. Click <strong>Compute Results</strong> after the exam ends.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-exam-border text-left">
                      {['Rank','Roll No','Name','Score','Percentile','Correct','Attempted'].map(h => (
                        <th key={h} className="pb-3 pr-4 text-xs font-semibold text-exam-muted uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-exam-border">
                    {results.map((r) => (
                      <tr key={r.rank} className="hover:bg-gray-50 transition-colors">
                        <td className="py-3 pr-4 font-bold text-exam-blue">#{r.rank}</td>
                        <td className="py-3 pr-4 text-exam-muted font-mono text-xs">{r.roll_number}</td>
                        <td className="py-3 pr-4 font-medium text-exam-text">{r.name}</td>
                        <td className="py-3 pr-4 font-bold text-exam-text">{r.score}</td>
                        <td className="py-3 pr-4">
                          <span className={clsx(
                            'px-2 py-0.5 rounded-full text-xs font-bold',
                            r.percentile >= 90 ? 'bg-green-100 text-green-700' :
                            r.percentile >= 70 ? 'bg-blue-100 text-blue-700' :
                                                 'bg-gray-100 text-gray-600'
                          )}>
                            {r.percentile?.toFixed(1)}%ile
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-green-700 font-medium">{r.correct}</td>
                        <td className="py-3 pr-4 text-exam-muted">{r.attempted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Exam Control ────────────────────────────────────────────── */}
      {tab === 'control' && (
        <div className="flex-1 p-4 grid grid-cols-1 md:grid-cols-2 gap-4 content-start">

          {/* Start / Status */}
          <div className="bg-white rounded-2xl border border-exam-border p-6">
            <h2 className="font-bold text-exam-text mb-1">Exam Lifecycle</h2>
            <p className="text-sm text-exam-muted mb-5">
              Start the exam once all candidates are ready. This broadcasts to every connected client.
            </p>
            <button
              onClick={handleStartExam}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold text-sm
                         hover:bg-green-700 transition-colors"
            >
              🚀 Start Exam Now
            </button>
          </div>

          {/* Time controls */}
          <div className="bg-white rounded-2xl border border-exam-border p-6">
            <h2 className="font-bold text-exam-text mb-1">Time Controls</h2>
            <p className="text-sm text-exam-muted mb-5">
              Adjust the running exam — broadcasts to all candidates in real time.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleControl('extend', 'Add 15 minutes to the exam?')}
                className="w-full py-2.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl
                           font-medium text-sm hover:bg-blue-100 transition-colors"
              >
                +15 min — Extend Time
              </button>
              <button
                onClick={() => handleControl('pause', 'Pause the exam for all candidates?')}
                className="w-full py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl
                           font-medium text-sm hover:bg-amber-100 transition-colors"
              >
                ⏸ Pause Exam
              </button>
              <button
                onClick={() => handleControl('resume', 'Resume the exam for all candidates?')}
                className="w-full py-2.5 bg-green-50 text-green-700 border border-green-200 rounded-xl
                           font-medium text-sm hover:bg-green-100 transition-colors"
              >
                ▶ Resume Exam
              </button>
            </div>
          </div>

          {/* Candidate list for block */}
          <div className="md:col-span-2 bg-white rounded-2xl border border-exam-border p-6">
            <h2 className="font-bold text-exam-text mb-1">Candidate Management</h2>
            <p className="text-sm text-exam-muted mb-4">
              Block a candidate to immediately remove them from the exam.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-exam-border text-left">
                    {['Roll No', 'Name', 'Email', 'Integrity', 'Violations', 'Status', 'Action'].map(h => (
                      <th key={h} className="pb-3 pr-4 text-xs font-semibold text-exam-muted uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-exam-border">
                  {candidates.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-4 font-mono text-xs text-exam-muted">{c.roll_number}</td>
                      <td className="py-3 pr-4 font-medium text-exam-text">{c.name}</td>
                      <td className="py-3 pr-4 text-exam-muted text-xs">{c.email}</td>
                      <td className="py-3 pr-4"><IntegrityBadge score={c.integrity_score || 0} /></td>
                      <td className="py-3 pr-4 text-center">{c.violation_count || 0}</td>
                      <td className="py-3 pr-4">
                        <span className={clsx(
                          'px-2 py-0.5 rounded-full text-xs font-medium',
                          c.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        )}>
                          {c.connected ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <button
                          onClick={() => handleBlockCandidate(c.id)}
                          className="px-3 py-1 text-xs bg-red-50 text-red-700 border border-red-200
                                     rounded-lg hover:bg-red-100 font-medium transition-colors"
                        >
                          Block
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Face Enrollment ────────────────────────────────────────── */}
      {tab === 'enroll' && (
        <div className="flex-1 p-4 flex flex-col gap-4">

          {/* Header card */}
          <div className="bg-white rounded-2xl border border-exam-border p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-bold text-exam-text text-base">Face Enrollment — Operation A</h2>
                <p className="text-sm text-exam-muted mt-1 max-w-2xl">
                  Upload each candidate's registration photo. AWS Rekognition converts the face
                  into a mathematical vector and stores it in the collection. The resulting
                  <strong className="text-exam-text"> FaceId</strong> is saved to the database
                  and used for live face verification during the exam.
                </p>
              </div>
              <div className="flex-shrink-0 ml-4 text-right">
                <div className="text-2xl font-extrabold text-exam-blue">
                  {candidates.filter(c => c.photo_indexed).length}
                  <span className="text-exam-muted font-normal text-sm"> / {candidates.length}</span>
                </div>
                <div className="text-xs text-exam-muted">enrolled</div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-exam-blue rounded-full transition-all duration-500"
                style={{
                  width: candidates.length
                    ? `${(candidates.filter(c => c.photo_indexed).length / candidates.length) * 100}%`
                    : '0%'
                }}
              />
            </div>

            {/* Legend */}
            <div className="flex gap-5 mt-3 text-xs text-exam-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                Face indexed — ready for exam
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
                Not enrolled — upload required
              </span>
            </div>
          </div>

          {/* Candidate enrollment table */}
          <div className="bg-white rounded-2xl border border-exam-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-exam-border">
                <tr>
                  {['Photo', 'Roll No', 'Name', 'Email', 'Status', 'Face ID', 'Action'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-exam-muted uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-exam-border">
                {candidates.map((c) => {
                  const es = enrollStatus[c.id]
                  const preview = enrollPreview[c.id]
                  const isIndexed = c.photo_indexed || es?.state === 'done'
                  const isUploading = es?.state === 'uploading'

                  return (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">

                      {/* Photo preview */}
                      <td className="px-4 py-3">
                        {preview ? (
                          <img src={preview} alt="" className="w-10 h-10 rounded-lg object-cover border border-exam-border" />
                        ) : isIndexed ? (
                          <div className="w-10 h-10 rounded-lg bg-green-50 border border-green-200 flex items-center justify-center text-green-600 text-lg">
                            ✓
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-lg">
                            👤
                          </div>
                        )}
                      </td>

                      {/* Roll */}
                      <td className="px-4 py-3 font-mono text-xs text-exam-muted">{c.roll_number}</td>

                      {/* Name */}
                      <td className="px-4 py-3 font-medium text-exam-text">{c.name}</td>

                      {/* Email */}
                      <td className="px-4 py-3 text-exam-muted text-xs">{c.email}</td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {isUploading ? (
                          <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                            <span className="animate-spin inline-block w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full" />
                            Indexing…
                          </span>
                        ) : es?.state === 'error' ? (
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            ✕ Error
                          </span>
                        ) : isIndexed ? (
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            ✓ Enrolled
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                            Pending
                          </span>
                        )}
                      </td>

                      {/* Face ID */}
                      <td className="px-4 py-3 font-mono text-xs text-exam-muted">
                        {(() => {
                          const fid = es?.faceId || c.rekognition_face_id
                          if (!fid) return <span className="text-gray-300">—</span>
                          return (
                            <span title={fid} className="cursor-help">
                              {fid.slice(0, 8)}…
                            </span>
                          )
                        })()}
                      </td>

                      {/* Upload action */}
                      <td className="px-4 py-3">
                        <input
                          ref={(el) => { fileInputRefs.current[c.id] = el }}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={handleFileSelect(c.id)}
                        />
                        <button
                          disabled={isUploading}
                          onClick={() => fileInputRefs.current[c.id]?.click()}
                          className={clsx(
                            'px-3 py-1.5 text-xs rounded-lg font-medium border transition-colors',
                            isIndexed
                              ? 'border-gray-200 text-exam-muted hover:border-exam-blue hover:text-exam-blue'
                              : 'border-exam-blue text-exam-blue bg-blue-50 hover:bg-blue-100',
                            isUploading && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          {isUploading ? 'Indexing…' : isIndexed ? '↑ Re-upload' : '↑ Upload Photo'}
                        </button>
                        {es?.state === 'error' && (
                          <div className="text-xs text-red-600 mt-1 max-w-[160px]">{es.message}</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {candidates.length === 0 && (
              <div className="text-center py-16 text-exam-muted">
                No candidates found. Run <code className="bg-gray-100 px-1 rounded">/dev/seed</code> first.
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="bg-white rounded-2xl border border-exam-border p-5">
            <h3 className="font-semibold text-exam-text mb-3">How IndexFaces Works</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
              {[
                { step: '1', icon: '📸', title: 'Upload Photo', desc: 'Admin uploads candidate\'s registration/ID photo (JPEG or PNG, max 5 MB).' },
                { step: '2', icon: '☁', title: 'S3 Storage', desc: 'Photo stored at photos/candidates/{id}/photo.jpg in your S3 bucket.' },
                { step: '3', icon: '🧠', title: 'AWS IndexFaces', desc: 'Rekognition detects the face, converts it to a vector, stores in collection "' + (process.env.NEXT_PUBLIC_REKOGNITION_COLLECTION || 'rgipt-dat-2026') + '".' },
                { step: '4', icon: '🔑', title: 'FaceId Saved', desc: 'The unique FaceId is saved to the database. Used for SearchFaces during the exam.' },
              ].map(({ step, icon, title, desc }) => (
                <div key={step} className="flex gap-3">
                  <div className="w-8 h-8 flex-shrink-0 rounded-full bg-exam-blue text-white text-xs font-bold flex items-center justify-center">
                    {step}
                  </div>
                  <div>
                    <div className="font-medium text-exam-text">{icon} {title}</div>
                    <div className="text-xs text-exam-muted mt-0.5 leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Candidate detail modal ───────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
             onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="font-bold text-exam-text text-lg">{selected.name}</h3>
                <p className="text-sm text-exam-muted font-mono">{selected.roll_number}</p>
              </div>
              <button onClick={() => setSelected(null)}
                className="text-exam-muted hover:text-exam-text w-8 h-8 flex items-center justify-center
                           rounded-lg hover:bg-gray-100">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-sm">
              {[
                { label: 'Email', value: selected.email },
                { label: 'Status', value: selected.connected ? '🟢 Connected' : '⚫ Disconnected' },
                { label: 'Integrity Score', value: <IntegrityBadge score={selected.integrity_score || 0} /> },
                { label: 'Violations', value: selected.violation_count || 0 },
                { label: 'Started At', value: selected.exam_started_at
                    ? new Date(selected.exam_started_at).toLocaleString() : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center py-2 border-b border-exam-border last:border-0">
                  <span className="text-exam-muted">{label}</span>
                  <span className="font-medium text-exam-text">{value}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => handleBlockCandidate(selected.id)}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold
                           hover:bg-red-700 transition-colors"
              >
                Block Candidate
              </button>
              <button onClick={() => setSelected(null)}
                className="flex-1 py-2.5 border border-exam-border rounded-xl text-sm font-medium
                           hover:bg-gray-50 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
