'use client'
/**
 * Candidate Audit Page — /admin/candidates/[id]
 *
 * Full dispute-resolution evidence page per candidate:
 *   - Identity card (name, roll, email, photo)
 *   - Integrity score with colour-coded risk level
 *   - Violation timeline (sorted newest-first, with score contribution)
 *   - Score breakdown by category (Face / Voice / Focus / Copy / Gaze / System)
 *   - Webcam snapshot gallery from S3 (clickable to full-size lightbox)
 *
 * Accessed from the admin dashboard candidate grid: click "View Audit" on any row.
 * Linked via router.push(`/admin/candidates/${candidate.id}?exam_id=${EXAM_ID}`)
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { fmtIST, fmtISTTime, fmtRelative } from '@/lib/utils/time'
import {
  getCandidates,
  getCandidateViolations,
  getCandidateSnapshots,
  getCandidateAnswers,
  getLiveScores,
  resetCandidateScore,
} from '@/lib/api/adminClient'
import { clsx } from 'clsx'

const IS_DEV = process.env.NODE_ENV === 'development'

// Replaces window.confirm — shows a toast with Confirm / Cancel buttons
function confirmToast(message, { danger = false } = {}) {
  return new Promise((resolve) => {
    toast(
      (t) => (
        <div className="flex flex-col gap-3 min-w-[240px]">
          <p className="text-sm text-gray-800 leading-snug">{message}</p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { toast.dismiss(t.id); resolve(false) }}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={() => { toast.dismiss(t.id); resolve(true) }}
              className={`px-3 py-1.5 text-xs rounded-lg font-semibold text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              Confirm
            </button>
          </div>
        </div>
      ),
      { duration: Infinity, style: { padding: '14px 16px', maxWidth: '320px', borderRadius: '14px' } }
    )
  })
}

// ── Mirrors VIOLATION_WEIGHTS from integrity_service.py ────────────────────────
const VIOLATION_WEIGHTS = {
  face_impersonation:       10.0,
  face_mismatch:            8.0,
  voice_assistant_keyword:  8.0,
  multiple_monitors:        5.0,
  multiple_faces:           5.0,
  mic_permission_denied:    5.0,
  screenshot_attempt:       4.0,
  sustained_speech:         4.0,
  extended_tab_switch:      4.0,
  face_detection_failed:    3.0,
  fullscreen_exit:          3.0,
  devtools_attempt:         3.0,
  gaze_deviation:           3.0,
  tab_switch:               2.0,
  tab_hidden:               2.0,
  paste_attempt:            2.0,
  copy_attempt:             1.5,
  cut_attempt:              1.5,
  copy_paste_attempt:       1.0,
  drag_attempt:             1.0,
  camera_unavailable:       1.0,
  audio_unavailable:        1.0,
  right_click:              0.5,
  multiple_monitors_dev:    0.5,
  gaze_tracker_unavailable: 0.5,
  speech_api_unavailable:   0.5,
  multiple_monitors_resolved: 0.0,
}

const VIOLATION_CATEGORY = {
  face_impersonation:       'Face',
  face_mismatch:            'Face',
  face_detection_failed:    'Face',
  multiple_faces:           'Face',
  voice_assistant_keyword:  'Voice',
  sustained_speech:         'Voice',
  mic_permission_denied:    'Voice',
  speech_api_unavailable:   'Voice',
  audio_unavailable:        'Voice',
  gaze_deviation:           'Gaze',
  gaze_tracker_unavailable: 'Gaze',
  tab_switch:               'Focus',
  tab_hidden:               'Focus',
  extended_tab_switch:      'Focus',
  fullscreen_exit:          'Focus',
  devtools_attempt:         'Focus',
  copy_attempt:             'Copy',
  cut_attempt:              'Copy',
  paste_attempt:            'Copy',
  copy_paste_attempt:       'Copy',
  screenshot_attempt:       'Copy',
  drag_attempt:             'Copy',
  right_click:              'Copy',
  multiple_monitors:        'System',
  multiple_monitors_dev:    'System',
  multiple_monitors_resolved: 'System',
  camera_unavailable:       'System',
}

const CATEGORY_COLORS = {
  Face:   { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  Voice:  { bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-200'   },
  Focus:  { bg: 'bg-amber-100',  text: 'text-amber-700',  border: 'border-amber-200'  },
  Copy:   { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  Gaze:   { bg: 'bg-cyan-100',   text: 'text-cyan-700',   border: 'border-cyan-200'   },
  System: { bg: 'bg-gray-100',   text: 'text-gray-600',   border: 'border-gray-200'   },
}

const SEV_LABEL = {
  1:'Low', 2:'Low', 3:'Medium', 4:'Medium', 5:'High', 6:'Critical', 7:'Critical', 8:'Critical'
}

// Compute score contribution of a violation row
function scoreContribution(v) {
  const weight = v.integrity_weight || VIOLATION_WEIGHTS[v.type] || 1.0
  return Math.round(weight * (v.severity / 4.0) * 10) / 10
}

// ── Small components ──────────────────────────────────────────────────────────

function CategoryBadge({ type }) {
  const cat = VIOLATION_CATEGORY[type] || 'System'
  const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.System
  return (
    <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', c.bg, c.text)}>
      {cat}
    </span>
  )
}

function SeverityDot({ severity }) {
  const s = severity || 1
  const color =
    s >= 6 ? 'bg-red-600' :
    s >= 4 ? 'bg-amber-500' :
    s >= 3 ? 'bg-yellow-400' :
             'bg-gray-300'
  return (
    <span className={clsx('inline-block w-2 h-2 rounded-full mr-1.5 flex-shrink-0', color)} />
  )
}

function ScoreRing({ score }) {
  const s = Math.min(100, score || 0)
  const color =
    s >= 40 ? 'text-red-600' :
    s >= 20 ? 'text-amber-600' :
              'text-green-600'
  const ringColor =
    s >= 40 ? 'stroke-red-500' :
    s >= 20 ? 'stroke-amber-500' :
              'stroke-green-500'
  const r = 36
  const circumference = 2 * Math.PI * r
  const dashoffset = circumference * (1 - s / 100)

  return (
    <div className="relative flex items-center justify-center">
      <svg width="100" height="100" className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          className={ringColor}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <div className={clsx('text-2xl font-extrabold leading-none', color)}>{s.toFixed(1)}</div>
        <div className="text-xs text-gray-400 mt-0.5">/ 100</div>
      </div>
    </div>
  )
}

function CategoryBreakdown({ violations }) {
  const totals = {}
  for (const v of violations) {
    const cat = VIOLATION_CATEGORY[v.type] || 'System'
    const contrib = scoreContribution(v)
    totals[cat] = (totals[cat] || 0) + contrib
  }
  const cats = Object.entries(totals).sort((a, b) => b[1] - a[1])
  if (cats.length === 0) return <p className="text-sm text-gray-400 italic">No violations recorded.</p>
  return (
    <div className="space-y-2">
      {cats.map(([cat, val]) => {
        const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.System
        const pct = Math.min(100, (val / 100) * 100)
        return (
          <div key={cat}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className={clsx('font-semibold', c.text)}>{cat}</span>
              <span className="text-gray-500">+{val.toFixed(1)} pts</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={clsx('h-full rounded-full', c.bg.replace('100', '400'))}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Snapshot lightbox ─────────────────────────────────────────────────────────

function SnapshotLightbox({ url, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl max-h-[90vh] w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-8 right-0 text-white/70 hover:text-white text-sm"
        >
          ✕ Close (Esc)
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Snapshot"
          className="w-full h-auto max-h-[85vh] object-contain rounded-lg"
        />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CandidateAuditPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()

  const candidateId = parseInt(params.id)
  const examId = parseInt(searchParams.get('exam_id') || '1')

  const [candidate, setCandidate] = useState(null)
  const [violations, setViolations] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [answers, setAnswers] = useState(null)    // null = not loaded yet
  const [answersLoading, setAnswersLoading] = useState(false)
  const [score, setScore] = useState(0)
  const [loading, setLoading] = useState(true)
  // Allow deep-linking to a specific tab via ?tab=answers
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'violations')
  const [lightbox, setLightbox] = useState(null) // URL or null
  const [error, setError] = useState(null)
  // Answer sheet filters
  const [answerFilter, setAnswerFilter] = useState('all')   // all | correct | incorrect | unattempted
  const [subjectFilter, setSubjectFilter] = useState('all')

  // Auth check
  useEffect(() => {
    const token = localStorage.getItem('rgipt-admin-token')
    if (!token) {
      router.replace('/admin/login')
    }
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [candRes, violRes, snapRes, scoresRes] = await Promise.allSettled([
        getCandidates(examId),
        getCandidateViolations(candidateId, examId, 200),
        getCandidateSnapshots(candidateId, examId),
        getLiveScores(examId),
      ])

      if (candRes.status === 'fulfilled') {
        const found = candRes.value.data.find((c) => c.id === candidateId)
        setCandidate(found || null)
      }

      if (violRes.status === 'fulfilled') {
        setViolations(violRes.value.data || [])
      }

      if (snapRes.status === 'fulfilled') {
        setSnapshots(snapRes.value.data?.snapshots || [])
      }

      if (scoresRes.status === 'fulfilled') {
        const sc = scoresRes.value.data?.scores?.[String(candidateId)]
        if (sc !== undefined) setScore(sc)
      }
    } catch (err) {
      setError('Failed to load candidate data.')
      toast.error('Failed to load candidate data')
    } finally {
      setLoading(false)
    }
  }, [candidateId, examId])

  useEffect(() => { load() }, [load])

  // Load answer sheet on demand — defined before the effect that calls it
  const loadAnswers = useCallback(async () => {
    try {
      setAnswersLoading(true)
      const res = await getCandidateAnswers(candidateId, examId)
      setAnswers(res.data)
    } catch (err) {
      toast.error('Failed to load answer sheet')
      console.error('loadAnswers error', err)
    } finally {
      setAnswersLoading(false)
    }
  }, [candidateId, examId])

  // When switching to answers tab, auto-load if not yet loaded
  const handleTabChange = (newTab) => {
    setTab(newTab)
    if (newTab === 'answers' && answers === null) {
      loadAnswers()
    }
  }

  // If deep-linked directly to the answers tab, load answers after initial page data loads
  useEffect(() => {
    if (!loading && tab === 'answers' && answers === null && !answersLoading) {
      loadAnswers()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]) // intentionally only re-runs when loading state flips to false

  // ── Computed stats ──────────────────────────────────────────────────────────
  const totalScoreAdded = violations.reduce((acc, v) => acc + scoreContribution(v), 0)
  const highestSeverity = violations.length ? Math.max(...violations.map((v) => v.severity || 0)) : 0
  const violByCategory = violations.reduce((acc, v) => {
    const cat = VIOLATION_CATEGORY[v.type] || 'System'
    acc[cat] = (acc[cat] || 0) + 1
    return acc
  }, {})
  const topCategory = Object.entries(violByCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'

  const riskLevel =
    score >= 40 ? { label: 'HIGH RISK', color: 'text-red-600', bg: 'bg-red-50 border-red-200' } :
    score >= 20 ? { label: 'WATCH',     color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' } :
                 { label: 'CLEAN',      color: 'text-green-600', bg: 'bg-green-50 border-green-200' }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-exam-muted animate-pulse text-sm">Loading audit data…</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-red-600 text-sm">{error}</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-exam-border px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <button
          onClick={() => router.push('/admin')}
          className="text-exam-blue hover:underline text-sm font-medium flex items-center gap-1"
        >
          ← Back to Dashboard
        </button>
        <span className="text-exam-muted">|</span>
        <h1 className="text-base font-bold text-exam-text">
          Candidate Audit Report
        </h1>
        <span className="text-xs text-exam-muted ml-auto">
          Exam #{examId} · Candidate #{candidateId}
        </span>
        {IS_DEV && (
          <button
            onClick={async () => {
              if (!await confirmToast(`[DEV] Reset score + delete ALL violations for candidate #${candidateId}?`, { danger: true })) return
              const toastId = toast.loading('Resetting…')
              try {
                const res = await resetCandidateScore(candidateId, examId)
                setScore(0)
                setViolations([])
                toast.success(`Reset done — ${res.data.violations_deleted} violation(s) deleted`, { id: toastId })
              } catch {
                toast.error('Reset failed', { id: toastId })
              }
            }}
            className="text-xs text-purple-600 font-semibold border border-purple-200 bg-purple-50 px-2 py-1 rounded-lg hover:bg-purple-100 transition-colors"
            title="DEV only — resets Redis integrity score and deletes all MySQL violations"
          >
            🔄 Reset Score (DEV)
          </button>
        )}
        <button
          onClick={load}
          className="text-xs text-exam-blue hover:underline"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ── Identity + Score card ──────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-exam-border p-6 flex flex-col sm:flex-row gap-6">
          {/* Candidate info */}
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-exam-blue flex items-center justify-center text-white font-bold text-lg">
                {candidate?.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div>
                <h2 className="text-xl font-bold text-exam-text">
                  {candidate?.name || `Candidate #${candidateId}`}
                </h2>
                <p className="text-sm text-exam-muted">
                  Roll: <span className="font-medium text-exam-text">{candidate?.roll_number || '—'}</span>
                  {candidate?.email && (
                    <> · <span className="font-medium">{candidate.email}</span></>
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <StatCard label="Violations" value={violations.length} />
              <StatCard label="Snapshots" value={snapshots.length} />
              <StatCard label="Highest Severity" value={highestSeverity || '—'} />
              <StatCard label="Top Category" value={topCategory} small />
            </div>

            {/* Exam timeline */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-exam-muted">
              {candidate?.exam_started_at && (
                <div>Started: <span className="font-medium text-exam-text">{fmtIST(candidate.exam_started_at)}</span></div>
              )}
            </div>
          </div>

          {/* Score + Risk */}
          <div className={clsx('flex flex-col items-center justify-center gap-2 rounded-xl border p-4 min-w-[160px]', riskLevel.bg)}>
            <ScoreRing score={score} />
            <div className={clsx('text-sm font-extrabold tracking-wide', riskLevel.color)}>
              {riskLevel.label}
            </div>
            <div className="text-xs text-gray-500 text-center">
              Integrity Score<br />
              <span className="font-medium">+{totalScoreAdded.toFixed(1)} from {violations.length} events</span>
            </div>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="flex gap-2 border-b border-exam-border flex-wrap">
          {[
            { key: 'violations', label: `Violations (${violations.length})` },
            { key: 'snapshots',  label: `Snapshots (${snapshots.length})` },
            { key: 'breakdown',  label: 'Score Breakdown' },
            { key: 'answers',    label: answers ? `Answer Sheet (${answers.total_questions}Q)` : 'Answer Sheet' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className={clsx(
                'px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors',
                tab === t.key
                  ? 'border-exam-blue text-exam-blue'
                  : 'border-transparent text-exam-muted hover:text-exam-text'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Violations tab ───────────────────────────────────────────────── */}
        {tab === 'violations' && (
          <div className="space-y-2">
            {violations.length === 0 ? (
              <div className="bg-white rounded-2xl border border-exam-border p-8 text-center">
                <div className="text-3xl mb-2">✅</div>
                <p className="text-exam-muted text-sm">No violations recorded for this candidate.</p>
                <p className="text-xs text-gray-400 mt-1">
                  If you expected violations, ensure the Celery worker is running and the exam was active.
                </p>
              </div>
            ) : (
              violations.map((v, i) => {
                const contrib = scoreContribution(v)
                const cat = VIOLATION_CATEGORY[v.type] || 'System'
                const catColor = CATEGORY_COLORS[cat] || CATEGORY_COLORS.System
                return (
                  <div
                    key={v.id || i}
                    className="bg-white rounded-xl border border-exam-border p-4 flex gap-4 items-start"
                  >
                    {/* Snapshot thumbnail */}
                    {v.snapshot_url ? (
                      <button
                        onClick={() => setLightbox(v.snapshot_url)}
                        className="flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden border border-exam-border hover:opacity-80 transition-opacity"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={v.snapshot_url}
                          alt="snapshot"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="flex-shrink-0 w-16 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xs border border-exam-border">
                        No photo
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <SeverityDot severity={v.severity} />
                        <span className="font-semibold text-sm text-exam-text">{v.type}</span>
                        <CategoryBadge type={v.type} />
                        <span className={clsx(
                          'text-xs px-1.5 py-0.5 rounded font-medium',
                          v.severity >= 5 ? 'bg-red-100 text-red-700' :
                          v.severity >= 3 ? 'bg-amber-100 text-amber-700' :
                                           'bg-gray-100 text-gray-500'
                        )}>
                          Severity {v.severity} — {SEV_LABEL[v.severity] || 'Low'}
                        </span>
                        <span className={clsx(
                          'ml-auto text-xs font-bold px-2 py-0.5 rounded-full',
                          catColor.bg, catColor.text
                        )}>
                          +{contrib.toFixed(2)} pts
                        </span>
                      </div>

                      <div className="text-xs text-exam-muted mt-1">{fmtIST(v.created_at)}</div>

                      {v.extra_data && Object.keys(v.extra_data).length > 0 && (
                        <div className="mt-1.5 text-xs text-gray-500 bg-gray-50 rounded px-2 py-1 font-mono">
                          {Object.entries(v.extra_data).map(([k, val]) => (
                            <span key={k} className="mr-3">
                              {k}: <span className="text-exam-text">{String(val)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Running total */}
                    <div className="flex-shrink-0 text-right">
                      <div className="text-xs text-exam-muted">Event #{violations.length - i}</div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ── Snapshots tab ─────────────────────────────────────────────────── */}
        {tab === 'snapshots' && (
          <div>
            {snapshots.length === 0 ? (
              <div className="bg-white rounded-2xl border border-exam-border p-8 text-center">
                <div className="text-3xl mb-2">📷</div>
                <p className="text-exam-muted text-sm">No snapshots found for this candidate.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Snapshots are uploaded every 30s during the exam. They appear here if AWS S3 is configured.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {snapshots.map((snap, i) => (
                  <button
                    key={snap.key || i}
                    onClick={() => setLightbox(snap.url)}
                    className="group relative rounded-xl overflow-hidden border border-exam-border bg-gray-100 aspect-video hover:border-exam-blue hover:shadow-md transition-all"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={snap.url}
                      alt={`Snapshot ${i + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                      <p className="text-white text-[10px] leading-tight">
                        {snap.taken_at ? fmtISTTime(snap.taken_at) : `#${i + 1}`}
                      </p>
                    </div>
                    <div className="absolute inset-0 bg-exam-blue/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-xs font-semibold bg-exam-blue/80 px-2 py-1 rounded-lg">
                        View
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Score Breakdown tab ────────────────────────────────────────────── */}
        {tab === 'breakdown' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Category bar chart */}
            <div className="bg-white rounded-2xl border border-exam-border p-6">
              <h3 className="text-sm font-bold text-exam-text mb-4">Score by Category</h3>
              <CategoryBreakdown violations={violations} />
            </div>

            {/* Per-violation type table */}
            <div className="bg-white rounded-2xl border border-exam-border p-6">
              <h3 className="text-sm font-bold text-exam-text mb-4">Violation Type Summary</h3>
              {violations.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No violations recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-exam-muted border-b border-exam-border">
                        <th className="text-left py-1.5 font-semibold">Type</th>
                        <th className="text-center py-1.5 font-semibold">Count</th>
                        <th className="text-right py-1.5 font-semibold">Total Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(
                        violations.reduce((acc, v) => {
                          const key = v.type
                          acc[key] = acc[key] || { count: 0, score: 0, sev: v.severity }
                          acc[key].count++
                          acc[key].score += scoreContribution(v)
                          acc[key].sev = Math.max(acc[key].sev, v.severity)
                          return acc
                        }, {})
                      )
                        .sort((a, b) => b[1].score - a[1].score)
                        .map(([type, data]) => {
                          const cat = VIOLATION_CATEGORY[type] || 'System'
                          const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.System
                          return (
                            <tr key={type} className="border-b border-exam-border/40 hover:bg-gray-50">
                              <td className="py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', c.bg.replace('100', '500'))} />
                                  <span className="font-mono text-exam-text">{type}</span>
                                </div>
                              </td>
                              <td className="text-center py-2 font-semibold">{data.count}</td>
                              <td className="text-right py-2 font-bold text-exam-blue">
                                +{data.score.toFixed(2)}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-exam-border">
                        <td className="py-2 font-bold text-exam-text">Total</td>
                        <td className="text-center py-2 font-bold">{violations.length}</td>
                        <td className="text-right py-2 font-extrabold text-exam-blue">
                          +{totalScoreAdded.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Disclaimer */}
            <div className="md:col-span-2 bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700 leading-relaxed">
              <strong>Dispute Resolution Note:</strong> The integrity score is computed as{' '}
              <code className="bg-blue-100 px-1 rounded">weight × (severity / 4)</code> per event,
              capped at 100. Scores ≥ 40 trigger admin alerts. All events are advisory — no candidate
              is auto-disqualified. Final decisions rest with the examination committee.
            </div>
          </div>
        )}
        {/* ── Answer Sheet tab ──────────────────────────────────────────────── */}
        {tab === 'answers' && (
          <div className="space-y-4">
            {/* Loading state */}
            {answersLoading && (
              <div className="bg-white rounded-2xl border border-exam-border p-10 text-center">
                <div className="text-exam-muted animate-pulse text-sm">Loading answer sheet…</div>
              </div>
            )}

            {/* Not loaded + not loading */}
            {!answersLoading && answers === null && (
              <div className="bg-white rounded-2xl border border-exam-border p-10 text-center">
                <div className="text-3xl mb-2">📋</div>
                <p className="text-exam-muted text-sm mb-4">Answer sheet not loaded yet.</p>
                <button
                  onClick={loadAnswers}
                  className="px-4 py-2 bg-exam-blue text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Load Answer Sheet
                </button>
              </div>
            )}

            {/* Loaded */}
            {!answersLoading && answers !== null && (
              <>
                {/* Summary bar */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="bg-white rounded-xl border border-exam-border p-3 text-center">
                    <div className="text-2xl font-extrabold text-exam-text">{answers.total_questions}</div>
                    <div className="text-[10px] text-exam-muted font-semibold uppercase tracking-wide mt-0.5">Total</div>
                  </div>
                  <div className="bg-white rounded-xl border border-green-200 p-3 text-center">
                    <div className="text-2xl font-extrabold text-green-600">{answers.total_correct}</div>
                    <div className="text-[10px] text-green-600 font-semibold uppercase tracking-wide mt-0.5">Correct</div>
                  </div>
                  <div className="bg-white rounded-xl border border-red-200 p-3 text-center">
                    <div className="text-2xl font-extrabold text-red-600">{answers.total_incorrect}</div>
                    <div className="text-[10px] text-red-600 font-semibold uppercase tracking-wide mt-0.5">Incorrect</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                    <div className="text-2xl font-extrabold text-gray-400">{answers.total_unattempted}</div>
                    <div className="text-[10px] text-exam-muted font-semibold uppercase tracking-wide mt-0.5">Skipped</div>
                  </div>
                  <div className={clsx(
                    'bg-white rounded-xl border p-3 text-center',
                    answers.total_score >= 0 ? 'border-blue-200' : 'border-red-200'
                  )}>
                    <div className={clsx(
                      'text-2xl font-extrabold',
                      answers.total_score >= 0 ? 'text-exam-blue' : 'text-red-600'
                    )}>
                      {answers.total_score > 0 ? '+' : ''}{answers.total_score}
                    </div>
                    <div className="text-[10px] text-exam-muted font-semibold uppercase tracking-wide mt-0.5">Score</div>
                  </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl border border-exam-border p-3 flex flex-wrap gap-3 items-center">
                  <span className="text-xs font-semibold text-exam-muted">Filter:</span>
                  <div className="flex gap-1 flex-wrap">
                    {[
                      { val: 'all',          label: 'All',          color: 'bg-gray-100 text-gray-700' },
                      { val: 'correct',      label: '✅ Correct',    color: 'bg-green-100 text-green-700' },
                      { val: 'incorrect',    label: '❌ Incorrect',  color: 'bg-red-100 text-red-700' },
                      { val: 'unattempted',  label: '⬜ Skipped',    color: 'bg-gray-100 text-gray-500' },
                    ].map(f => (
                      <button
                        key={f.val}
                        onClick={() => setAnswerFilter(f.val)}
                        className={clsx(
                          'px-2.5 py-1 text-xs rounded-full font-medium transition-all border',
                          answerFilter === f.val
                            ? `${f.color} border-current shadow-sm`
                            : 'border-transparent text-exam-muted hover:bg-gray-100'
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  {/* Subject filter */}
                  {(() => {
                    const subjects = [...new Set(answers.questions.map(q => q.subject).filter(Boolean))]
                    if (subjects.length <= 1) return null
                    return (
                      <div className="flex gap-1 flex-wrap ml-2 pl-2 border-l border-exam-border">
                        <button
                          onClick={() => setSubjectFilter('all')}
                          className={clsx(
                            'px-2.5 py-1 text-xs rounded-full font-medium transition-all border',
                            subjectFilter === 'all'
                              ? 'bg-exam-blue text-white border-exam-blue'
                              : 'border-transparent text-exam-muted hover:bg-gray-100'
                          )}
                        >
                          All Subjects
                        </button>
                        {subjects.map(s => (
                          <button
                            key={s}
                            onClick={() => setSubjectFilter(s)}
                            className={clsx(
                              'px-2.5 py-1 text-xs rounded-full font-medium transition-all border',
                              subjectFilter === s
                                ? 'bg-exam-blue text-white border-exam-blue'
                                : 'border-transparent text-exam-muted hover:bg-gray-100'
                            )}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                  <button
                    onClick={loadAnswers}
                    className="ml-auto text-xs text-exam-blue hover:underline"
                  >
                    ↻ Refresh
                  </button>
                </div>

                {/* Question list */}
                <div className="space-y-2">
                  {answers.questions
                    .filter(q => answerFilter === 'all' || q.status === answerFilter)
                    .filter(q => subjectFilter === 'all' || q.subject === subjectFilter)
                    .map((q) => (
                      <AnswerCard key={q.question_id} q={q} />
                    ))
                  }
                  {answers.questions.filter(q =>
                    (answerFilter === 'all' || q.status === answerFilter) &&
                    (subjectFilter === 'all' || q.subject === subjectFilter)
                  ).length === 0 && (
                    <div className="bg-white rounded-2xl border border-exam-border p-8 text-center text-exam-muted text-sm">
                      No questions match the selected filter.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <SnapshotLightbox url={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

// ── Reusable stat card ────────────────────────────────────────────────────────
function StatCard({ label, value, small }) {
  return (
    <div className="bg-gray-50 rounded-xl border border-exam-border px-3 py-2.5 text-center">
      <div className={clsx('font-extrabold text-exam-text', small ? 'text-base' : 'text-2xl')}>
        {value}
      </div>
      <div className="text-[10px] text-exam-muted font-semibold uppercase tracking-wide mt-0.5">
        {label}
      </div>
    </div>
  )
}

// ── Answer card (per-question row in Answer Sheet tab) ────────────────────────
function AnswerCard({ q }) {
  const [expanded, setExpanded] = useState(false)

  const statusConfig = {
    correct:     { icon: '✅', label: 'Correct',    bg: 'bg-green-50 border-green-200', badge: 'bg-green-100 text-green-700', score: '+' },
    incorrect:   { icon: '❌', label: 'Incorrect',  bg: 'bg-red-50 border-red-200',     badge: 'bg-red-100 text-red-700',    score: ''  },
    unattempted: { icon: '⬜', label: 'Not Attempted', bg: 'bg-gray-50 border-gray-200', badge: 'bg-gray-100 text-gray-500', score: ''  },
  }
  const cfg = statusConfig[q.status] || statusConfig.unattempted

  // Format an answer value for display (handles string, list, number)
  const formatAnswer = (val) => {
    if (val === null || val === undefined) return '—'
    if (Array.isArray(val)) return val.join(', ')
    return String(val)
  }

  return (
    <div className={clsx('rounded-xl border p-4', cfg.bg)}>
      {/* ── Header row ── */}
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <span className="text-xl flex-shrink-0 mt-0.5">{cfg.icon}</span>

        {/* Question text (truncated unless expanded) */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-bold text-exam-muted">Q{q.sequence_number}</span>
            {q.subject && (
              <span className="text-[10px] bg-white border border-exam-border px-1.5 py-0.5 rounded-full text-exam-muted font-medium">
                {q.subject}
              </span>
            )}
            {q.question_type !== 'single_mcq' && (
              <span className="text-[10px] bg-white border border-exam-border px-1.5 py-0.5 rounded-full text-exam-muted font-medium">
                {q.question_type === 'multi_mcq' ? 'Multi-select' : 'Numerical'}
              </span>
            )}
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-semibold', cfg.badge)}>
              {cfg.label}
            </span>
            <span className={clsx(
              'ml-auto text-xs font-bold flex-shrink-0',
              q.marks_earned > 0 ? 'text-green-600' :
              q.marks_earned < 0 ? 'text-red-600' :
                                   'text-gray-400'
            )}>
              {q.marks_earned > 0 ? '+' : ''}{q.marks_earned} / {q.marks}
            </span>
          </div>

          {/* Question text — first 200 chars collapsed */}
          <p className={clsx(
            'text-sm text-exam-text leading-relaxed',
            !expanded && 'line-clamp-2'
          )}>
            {q.text}
          </p>
          {q.text.length > 200 && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-exam-blue hover:underline mt-0.5"
            >
              {expanded ? 'Show less ▲' : 'Show more ▼'}
            </button>
          )}
        </div>
      </div>

      {/* ── Answer detail (always visible) ── */}
      <div className="mt-3 ml-8 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {/* Correct answer */}
        <div className="flex items-center gap-1.5">
          <span className="text-exam-muted font-semibold w-24 flex-shrink-0">Correct Ans:</span>
          <span className="font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded font-mono">
            {formatAnswer(q.correct_answer)}
          </span>
        </div>
        {/* Selected answer */}
        <div className="flex items-center gap-1.5">
          <span className="text-exam-muted font-semibold w-24 flex-shrink-0">Candidate:</span>
          <span className={clsx(
            'font-bold px-2 py-0.5 rounded font-mono',
            q.status === 'correct'     ? 'text-green-700 bg-green-100' :
            q.status === 'incorrect'   ? 'text-red-700 bg-red-100' :
                                         'text-gray-400 bg-gray-100'
          )}>
            {formatAnswer(q.selected_answer)}
          </span>
        </div>
      </div>

      {/* ── Expanded: full options table ── */}
      {expanded && q.options && Object.keys(q.options).length > 0 && (
        <div className="mt-3 ml-8 space-y-1">
          {Object.entries(q.options).map(([key, text]) => {
            const isCorrect  = String(q.correct_answer).toUpperCase().includes(key.toUpperCase())
            const isSelected = q.selected_answer !== null &&
              q.selected_answer !== undefined &&
              (Array.isArray(q.selected_answer)
                ? q.selected_answer.some(s => String(s).toUpperCase() === key.toUpperCase())
                : String(q.selected_answer).toUpperCase() === key.toUpperCase())
            return (
              <div
                key={key}
                className={clsx(
                  'flex items-start gap-2 text-xs px-2 py-1.5 rounded-lg',
                  isCorrect && isSelected ? 'bg-green-100 border border-green-300' :
                  isCorrect               ? 'bg-green-50 border border-green-200' :
                  isSelected              ? 'bg-red-50 border border-red-200' :
                                            'bg-white border border-exam-border/50'
                )}
              >
                <span className={clsx(
                  'font-bold w-5 flex-shrink-0',
                  isCorrect ? 'text-green-700' :
                  isSelected ? 'text-red-700' :
                               'text-exam-muted'
                )}>
                  {key}.
                </span>
                <span className="text-exam-text leading-relaxed">{text}</span>
                <div className="ml-auto flex-shrink-0 flex gap-1">
                  {isCorrect  && <span className="text-green-600 font-bold">✓</span>}
                  {isSelected && !isCorrect && <span className="text-red-600 font-bold">✗</span>}
                  {isSelected && isCorrect  && <span className="text-green-600 font-bold">✓ Selected</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Solution (if available and expanded) */}
      {expanded && q.solution && (
        <div className="mt-2 ml-8 bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs text-blue-800">
          <span className="font-semibold">Solution: </span>{q.solution}
        </div>
      )}
    </div>
  )
}
