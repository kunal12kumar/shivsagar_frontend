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
import toast from 'react-hot-toast'
import { fmtIST, fmtISTTime, fmtRelative } from '@/lib/utils/time'
import {
  getCandidates, getViolations, controlExam,
  startExam, endExam, getResults, computeResults, indexFace,
  getCandidateViolations, getLiveScores, resetCandidateScore,
  addCandidate, bulkImportCandidates, deleteCandidate,
  listExams, getAdminRole,
} from '@/lib/api/adminClient'
import { clsx } from 'clsx'

// ── Constants ─────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === 'development'

const SEV_LABEL = { 1:'Low', 2:'Low', 3:'Medium', 4:'Medium', 5:'High', 6:'Critical', 7:'Critical', 8:'Critical' }
const SEV_COLOR = {
  1:'text-gray-400', 2:'text-gray-400',
  3:'text-amber-600', 4:'text-amber-600',
  5:'text-red-600', 6:'text-red-600',
  7:'text-red-700 font-bold', 8:'text-red-700 font-bold',
}

// Mirrors VIOLATION_WEIGHTS in integrity_service.py  (weight × severity/4 = score increment)
const VIOLATION_SCORING = [
  { type: 'face_impersonation',    weight: 10.0, category: 'Face', description: 'Face matches another candidate — impersonation' },
  { type: 'face_mismatch',         weight: 8.0,  category: 'Face', description: 'Face does not match registered photo' },
  { type: 'voice_assistant_keyword', weight: 8.0, category: 'Voice', description: 'AI assistant keyword detected in audio' },
  { type: 'multiple_monitors',     weight: 5.0,  category: 'System', description: 'External monitor detected (production)' },
  { type: 'multiple_faces',        weight: 5.0,  category: 'Face', description: 'More than one person visible in frame' },
  { type: 'mic_permission_denied', weight: 5.0,  category: 'Voice', description: 'Microphone permission denied' },
  { type: 'screenshot_attempt',    weight: 4.0,  category: 'Copy', description: 'PrintScreen key pressed' },
  { type: 'sustained_speech',      weight: 4.0,  category: 'Voice', description: 'Continuous speech for extended period' },
  { type: 'extended_tab_switch',   weight: 4.0,  category: 'Focus', description: 'Away from exam for more than 10 seconds' },
  { type: 'face_detection_failed', weight: 3.0,  category: 'Face', description: 'Face not detectable in webcam frame' },
  { type: 'fullscreen_exit',       weight: 3.0,  category: 'Focus', description: 'Exited fullscreen mode' },
  { type: 'devtools_attempt',      weight: 3.0,  category: 'Focus', description: 'F12 / developer tools key pressed' },
  { type: 'gaze_deviation',        weight: 3.0,  category: 'Gaze', description: 'Eyes not focused on screen' },
  { type: 'tab_switch',            weight: 2.0,  category: 'Focus', description: 'Switched to another tab/window' },
  { type: 'tab_hidden',            weight: 2.0,  category: 'Focus', description: 'Browser tab hidden' },
  { type: 'paste_attempt',         weight: 2.0,  category: 'Copy', description: 'Paste action attempted' },
  { type: 'copy_attempt',          weight: 1.5,  category: 'Copy', description: 'Copy action attempted' },
  { type: 'cut_attempt',           weight: 1.5,  category: 'Copy', description: 'Cut action attempted' },
  { type: 'copy_paste_attempt',    weight: 1.0,  category: 'Copy', description: 'Ctrl+C/V keyboard shortcut' },
  { type: 'drag_attempt',          weight: 1.0,  category: 'Copy', description: 'Text drag attempted' },
  { type: 'camera_unavailable',    weight: 1.0,  category: 'System', description: 'Webcam disconnected or unavailable' },
  { type: 'audio_unavailable',     weight: 1.0,  category: 'System', description: 'Microphone not detected' },
  { type: 'right_click',           weight: 0.5,  category: 'Copy', description: 'Right-click context menu attempted' },
]

const CATEGORY_COLOR = {
  Face: 'bg-purple-100 text-purple-700',
  Voice: 'bg-blue-100 text-blue-700',
  Focus: 'bg-amber-100 text-amber-700',
  Copy: 'bg-orange-100 text-orange-700',
  Gaze: 'bg-cyan-100 text-cyan-700',
  System: 'bg-gray-100 text-gray-600',
}

// ── Confirmation toast (replaces window.confirm) ─────────────────────────────
// Returns a Promise<boolean>. Shows a toast with Confirm / Cancel buttons.
// Usage:  if (!await confirmToast('Are you sure?')) return
function confirmToast(message, { danger = false } = {}) {
  return new Promise((resolve) => {
    toast(
      (t) => (
        <div className="flex flex-col gap-3 min-w-[260px]">
          <p className="text-sm text-gray-800 leading-snug">{message}</p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { toast.dismiss(t.id); resolve(false) }}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg
                         text-gray-600 hover:bg-gray-100 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { toast.dismiss(t.id); resolve(true) }}
              className={clsx(
                'px-3 py-1.5 text-xs rounded-lg font-semibold text-white transition-colors',
                danger ? 'bg-red-600 hover:bg-red-700' : 'bg-exam-blue hover:bg-blue-700'
              )}
            >
              Confirm
            </button>
          </div>
        </div>
      ),
      {
        duration: Infinity,
        style: { padding: '14px 16px', maxWidth: '340px', borderRadius: '14px' },
      }
    )
  })
}

// ── Small components ──────────────────────────────────────────────────────────

function IntegrityBadge({ score }) {
  const s = score || 0
  return (
    <span className={clsx(
      'inline-block text-xs font-bold px-2 py-0.5 rounded-full',
      s >= 40 ? 'bg-red-100 text-red-700' :
      s >= 20 ? 'bg-amber-100 text-amber-700' :
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

function CandidateCard({ candidate, style, onClick, onAudit }) {
  const s = candidate.integrity_score || 0
  return (
    <div style={style} className="p-1">
      <div className={clsx(
        'h-full rounded-xl border p-2 text-xs flex flex-col justify-between transition-all hover:shadow-sm',
        s >= 40 ? 'border-red-300 bg-red-50' :
        s >= 20 ? 'border-amber-200 bg-amber-50' :
                 'border-exam-border bg-white'
      )}>
        <button
          onClick={() => onClick(candidate)}
          className="text-left w-full hover:opacity-80 transition-opacity"
        >
          <div className="font-semibold text-exam-text truncate">{candidate.name}</div>
          <div className="text-exam-muted truncate text-[11px]">{candidate.roll_number}</div>
          <div className="flex items-center justify-between mt-1">
            <span className={clsx('w-2 h-2 rounded-full', candidate.connected ? 'bg-green-500' : 'bg-gray-300')} />
            <IntegrityBadge score={s} />
          </div>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAudit(candidate) }}
          className="mt-1.5 w-full text-center text-[10px] text-exam-blue hover:underline font-medium"
        >
          View Audit →
        </button>
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

// ── Live countdown badge shown on exam control status bar ─────────────────────
function ExamCountdownBadge({ endTime }) {
  const [secs, setSecs] = useState(() => Math.max(0, Math.floor((new Date(endTime) - Date.now()) / 1000)))
  useEffect(() => {
    if (secs <= 0) return
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [secs])
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const label = h > 0
    ? `${h}h ${String(m).padStart(2,'0')}m`
    : `${m}:${String(s).padStart(2,'0')}`
  return (
    <div className={clsx(
      'text-center px-4 py-2 rounded-xl border flex-shrink-0',
      secs <= 300 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
    )}>
      <p className={clsx('text-xl font-bold tabular-nums', secs <= 300 ? 'text-red-600' : 'text-green-700')}>
        {secs === 0 ? 'ENDED' : label}
      </p>
      <p className="text-xs text-gray-500">remaining</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter()

  // ── Auth state
  const [adminEmail, setAdminEmail] = useState('')
  const [authReady, setAuthReady]   = useState(false)

  // ── Active exam state (replaces hardcoded EXAM_ID = 1)
  const [activeExam,   setActiveExam]   = useState(null)   // full exam object
  const [examLoading,  setExamLoading]  = useState(true)

  // Derived: always use the active exam's ID (fallback to 1 for safety)
  const EXAM_ID = activeExam?.id ?? 1

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
  const [selectedViolations, setSelectedViolations] = useState([])
  const [selectedViolationsLoading, setSelectedViolationsLoading] = useState(false)
  // Face enrollment state: { [candidateId]: 'idle'|'uploading'|'done'|'error', message? }
  const [enrollStatus, setEnrollStatus] = useState({})
  const [enrollPreview, setEnrollPreview] = useState({})   // { [candidateId]: objectURL }
  const fileInputRefs               = useRef({})           // { [candidateId]: <input> }
  const wsRef                       = useRef(null)
  const pollRef                     = useRef(null)
  const resultsPollRef              = useRef(null)

  // ── Students tab state ────────────────────────────────────────────────
  const [studentsMode, setStudentsMode] = useState('add')   // 'add' | 'bulk'
  const [addForm, setAddForm]           = useState({
    application_number: '', name: '', email: '',
    father_name: '', phone: '', date_of_birth: '', gender: '', category: '', state: '',
  })
  const [addLoading, setAddLoading]     = useState(false)
  const [bulkFile, setBulkFile]         = useState(null)    // File object
  const [bulkLoading, setBulkLoading]   = useState(false)
  const [bulkResult, setBulkResult]     = useState(null)    // API response
  const bulkFileRef                     = useRef(null)

  const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'

  // ── Auth check (exam_controller only) ───────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('rgipt-admin-token')
    const email = localStorage.getItem('rgipt-admin-email')
    const role  = getAdminRole()
    if (!token) {
      router.replace('/admin/login')
      return
    }
    // question_manager should be on /admin/questions, not here
    if (role && role !== 'exam_controller') {
      router.replace('/admin/questions')
      return
    }
    setAdminEmail(email || 'Admin')
    setAuthReady(true)
  }, [router])

  // ── Load active exam first, then candidates/violations ──────────────────────
  useEffect(() => {
    if (!authReady) return

    // Find the most relevant exam: ACTIVE first, then most recent
    listExams()
      .then(({ data }) => {
        const exams = data || []
        const active = exams.find(e => e.status === 'active')
          || exams.find(e => e.status === 'paused')
          || exams[0]   // most recent (list is ordered by created_at desc)
        if (active) {
          setActiveExam(active)
          // Auto-mark as COMPLETED if end_time has passed
          if (active.end_time && new Date(active.end_time) < new Date() && active.status === 'active') {
            endExam(active.id).catch(() => {})  // silent — server will mark it
            setActiveExam(e => e ? { ...e, status: 'completed' } : e)
          }
        }
      })
      .catch(() => {})
      .finally(() => setExamLoading(false))
  }, [authReady])

  // ── Load data
  useEffect(() => {
    if (!authReady || examLoading) return

    // getCandidates() with no arg returns ALL candidates regardless of exam_id
    Promise.all([getCandidates(), getViolations(EXAM_ID)])
      .then(([cRes, vRes]) => {
        setCandidates(cRes.data)
        setViolations(vRes.data.slice(0, 100))
      })
      .catch(() => toast.error('Failed to load data'))
      .finally(() => setLoading(false))

    // Admin WebSocket (best-effort — falls back to polling if not running)
    const token = localStorage.getItem('rgipt-admin-token')
    if (token) {
      try {
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
      } catch (_) {}
    }

    // ── Auto-poll integrity scores every 30s (WS fallback) ────────────────
    const pollScores = () => {
      getLiveScores(EXAM_ID)
        .then((res) => {
          const scores = res.data?.scores || {}
          setCandidates(prev => prev.map(c => {
            const s = scores[String(c.id)]
            return s !== undefined ? { ...c, integrity_score: s } : c
          }))
        })
        .catch(() => {})
    }
    // Poll immediately then every 30s
    pollScores()
    pollRef.current = setInterval(pollScores, 30000)

    return () => {
      wsRef.current?.close()
      if (pollRef.current) clearInterval(pollRef.current)
      if (resultsPollRef.current) clearInterval(resultsPollRef.current)
    }
  }, [authReady, examLoading, WS_BASE])   // examLoading must be here — data load fires only after exam fetch completes

  // ── Computed ──────────────────────────────────────────────────────────────
  const filtered = candidates.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.roll_number?.toLowerCase().includes(search.toLowerCase())
  )

  const stats = {
    total:     candidates.length,
    connected: candidates.filter(c => c.connected).length,
    watch:     candidates.filter(c => (c.integrity_score || 0) >= 20 && (c.integrity_score || 0) < 40).length,
    flagged:   candidates.filter(c => (c.integrity_score || 0) >= 40).length,
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleControl = async (action, confirmMsg) => {
    if (confirmMsg && !await confirmToast(confirmMsg)) return
    try {
      await controlExam(EXAM_ID, action)
      toast.success(`Action "${action}" applied`)
    } catch {
      toast.error('Failed to send command')
    }
  }

  const handleStartExam = async () => {
    if (!await confirmToast('Start the exam now? This sets status = ACTIVE and starts the 15-minute candidate countdown.')) return
    const toastId = toast.loading('Starting exam…')
    try {
      const res = await startExam(EXAM_ID)
      toast.success('Exam started! Candidates will see a 15-minute countdown.', { id: toastId })
      // Refresh exam state
      const { data } = await listExams()
      const updated = (data || []).find(e => e.id === EXAM_ID)
      if (updated) setActiveExam(updated)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to start exam', { id: toastId })
    }
  }

  const handleEndExam = async () => {
    if (!await confirmToast('End the exam now for ALL candidates? This cannot be undone.', { danger: true })) return
    const toastId = toast.loading('Ending exam…')
    try {
      await endExam(EXAM_ID)
      toast.success('Exam ended. Candidates have been notified.', { id: toastId })
      setActiveExam(e => e ? { ...e, status: 'completed' } : e)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to end exam', { id: toastId })
    }
  }

  // Silent poll — called automatically every 30s while Results tab is open
  // EXAM_ID must be in deps — otherwise the closure captures the stale value from mount (exam_id=1)
  const loadResultsSilent = useCallback(async () => {
    try {
      const res = await getResults(EXAM_ID)
      if (res.data.length > 0) setResults(res.data)
    } catch { /* silent — don't show errors on auto-poll */ }
  }, [EXAM_ID])

  // Manual refresh button — shows feedback
  const handleLoadResults = async () => {
    setResultsLoading(true)
    const toastId = toast.loading('Loading results…')
    try {
      const res = await getResults(EXAM_ID)
      setResults(res.data)
      if (res.data.length === 0) toast.error('No results yet — waiting for students to submit', { id: toastId })
      else toast.success(`${res.data.length} result(s) loaded`, { id: toastId })
    } catch {
      toast.error('Failed to load results', { id: toastId })
    } finally {
      setResultsLoading(false)
    }
  }

  // Manual re-compute — admin override for corrections / edge cases
  const handleComputeResults = async () => {
    const toastId = toast.loading('Re-computing results…')
    try {
      setResultsLoading(true)
      const computeRes = await computeResults(EXAM_ID)
      const { candidates = 0 } = computeRes.data || {}
      if (candidates === 0) {
        toast.error('No answers found — make sure candidates have submitted', { id: toastId })
        setResultsLoading(false)
        return
      }
      const res = await getResults(EXAM_ID)
      setResults(res.data)
      toast.success(`✓ ${res.data.length} result(s) re-computed`, { id: toastId })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Re-computation failed', { id: toastId })
    } finally {
      setResultsLoading(false)
    }
  }

  const handleSelectCandidate = (candidate) => {
    setSelected(candidate)
    setSelectedViolations([])
    setSelectedViolationsLoading(true)
    getCandidateViolations(candidate.id, EXAM_ID)
      .then(res => setSelectedViolations(res.data))
      .catch(() => {})
      .finally(() => setSelectedViolationsLoading(false))
  }

  const handleBlockCandidate = async (candidateId) => {
    if (!await confirmToast('Block this candidate? They will be removed from the exam.', { danger: true })) return
    const toastId = toast.loading('Blocking candidate…')
    try {
      await controlExam(EXAM_ID, `block_${candidateId}`)
      setCandidates(prev => prev.map(c => c.id === candidateId ? { ...c, is_blocked: true } : c))
      setSelected(null)
      setSelectedViolations([])
      toast.success('Candidate blocked', { id: toastId })
    } catch {
      toast.error('Failed to block candidate', { id: toastId })
    }
  }

  const handleResetScore = async (candidate) => {
    if (!await confirmToast(
      `[DEV] Reset integrity score + delete ALL violations for ${candidate.name}? This is irreversible — use only for testing.`,
      { danger: true }
    )) return
    const toastId = toast.loading(`Resetting ${candidate.name}…`)
    try {
      const res = await resetCandidateScore(candidate.id, EXAM_ID)
      const { violations_deleted } = res.data
      // Update UI immediately
      setCandidates(prev => prev.map(c =>
        c.id === candidate.id ? { ...c, integrity_score: 0, violation_count: 0 } : c
      ))
      if (selected?.id === candidate.id) {
        setSelected(prev => ({ ...prev, integrity_score: 0, violation_count: 0 }))
        setSelectedViolations([])
      }
      toast.success(`Score reset — ${violations_deleted} violation(s) deleted`, { id: toastId })
    } catch {
      toast.error('Reset failed', { id: toastId })
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
    const toastId = toast.loading('Indexing face with AWS Rekognition…')
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
      toast.success(`Face enrolled for ${res.data.name}`, { id: toastId })
    } catch (err) {
      const msg = err.response?.data?.detail || 'Upload failed'
      setEnrollStatus(prev => ({ ...prev, [candidateId]: { state: 'error', message: msg } }))
      toast.error(msg, { id: toastId })
    }
  }

  // ── Students handlers ─────────────────────────────────────────────────
  const EMPTY_ADD_FORM = {
    application_number: '', name: '', email: '',
    father_name: '', phone: '', date_of_birth: '', gender: '', category: '', state: '',
  }

  const handleAddCandidate = async (e) => {
    e.preventDefault()
    const { application_number, name, email } = addForm
    if (!application_number.trim() || !name.trim() || !email.trim()) {
      toast.error('Application Number, Name and Email are required')
      return
    }
    setAddLoading(true)
    const toastId = toast.loading('Adding candidate…')
    try {
      const payload = {
        application_number: application_number.trim(),
        name: name.trim(),
        email: email.trim(),
        exam_id: EXAM_ID,
        ...(addForm.father_name.trim()    && { father_name:    addForm.father_name.trim() }),
        ...(addForm.phone.trim()          && { phone:          addForm.phone.trim() }),
        ...(addForm.date_of_birth.trim()  && { date_of_birth:  addForm.date_of_birth.trim() }),
        ...(addForm.gender                && { gender:          addForm.gender }),
        ...(addForm.category              && { category:        addForm.category }),
        ...(addForm.state.trim()          && { state:           addForm.state.trim() }),
      }
      const res = await addCandidate(payload)
      setCandidates(prev => [...prev, {
        id: res.data.id,
        name: res.data.name,
        roll_number: res.data.roll_number,
        application_number: res.data.application_number,
        email: res.data.email,
        connected: false,
        integrity_score: 0,
        violation_count: 0,
        photo_indexed: false,
      }])
      setAddForm(EMPTY_ADD_FORM)
      toast.success(`✓ ${res.data.name} added — Roll: ${res.data.roll_number}`, { id: toastId })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to add candidate', { id: toastId })
    } finally {
      setAddLoading(false)
    }
  }

  const handleBulkUpload = async () => {
    if (!bulkFile) { toast.error('Select a CSV or Excel file first'); return }
    setBulkLoading(true)
    setBulkResult(null)
    const toastId = toast.loading(`Importing ${bulkFile.name}…`)
    try {
      const res = await bulkImportCandidates(bulkFile, EXAM_ID)
      setBulkResult(res.data)
      // Refresh candidate list so new rows appear immediately
      const cRes = await getCandidates()
      setCandidates(cRes.data)
      if (res.data.added > 0) {
        toast.success(`✓ ${res.data.added} candidate(s) imported`, { id: toastId })
      } else {
        toast.error('No new candidates added — check skipped details', { id: toastId })
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Import failed', { id: toastId })
    } finally {
      setBulkLoading(false)
    }
  }

  const handleDeleteCandidate = async (candidate) => {
    if (!await confirmToast(
      `Delete ${candidate.name} (Roll: ${candidate.roll_number})? This removes all their answers, violations and results. Irreversible.`,
      { danger: true }
    )) return
    const toastId = toast.loading('Deleting…')
    try {
      await deleteCandidate(candidate.id)
      setCandidates(prev => prev.filter(c => c.id !== candidate.id))
      toast.success(`${candidate.name} deleted`, { id: toastId })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Delete failed', { id: toastId })
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('rgipt-admin-token')
    localStorage.removeItem('rgipt-admin-email')
    localStorage.removeItem('rgipt-admin-role')
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
            <TabButton active={tab === 'monitor'} onClick={() => {
              setTab('monitor')
              if (resultsPollRef.current) { clearInterval(resultsPollRef.current); resultsPollRef.current = null }
            }}>
              📊 Live Monitor
            </TabButton>
            <TabButton active={tab === 'results'} onClick={() => {
              setTab('results')
              handleLoadResults()
              // Auto-poll every 30s while tab is open — catches new submissions
              if (resultsPollRef.current) clearInterval(resultsPollRef.current)
              resultsPollRef.current = setInterval(loadResultsSilent, 30000)
            }}>
              🏆 Results
            </TabButton>
            <TabButton active={tab === 'control'} onClick={() => {
              setTab('control')
              if (resultsPollRef.current) { clearInterval(resultsPollRef.current); resultsPollRef.current = null }
            }}>
              ⚙ Exam Control
            </TabButton>
            <TabButton active={tab === 'students'} onClick={() => {
              setTab('students')
              setBulkResult(null)
              if (resultsPollRef.current) { clearInterval(resultsPollRef.current); resultsPollRef.current = null }
            }}>
              👥 Students
            </TabButton>
            <TabButton active={tab === 'enroll'} onClick={() => {
              setTab('enroll')
              if (resultsPollRef.current) { clearInterval(resultsPollRef.current); resultsPollRef.current = null }
            }}>
              👤 Face Enrollment
            </TabButton>
            <TabButton active={tab === 'scoring'} onClick={() => {
              setTab('scoring')
              if (resultsPollRef.current) { clearInterval(resultsPollRef.current); resultsPollRef.current = null }
            }}>
              📊 Scoring Guide
            </TabButton>
            <TabButton active={false} onClick={() => router.push('/admin/live')}
              className="bg-green-600 hover:bg-green-700 text-white border-green-600">
              🚀 Live Questions
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

      {/* ── Tab: Live Monitor ────────────────────────────────────────────── */}
      {tab === 'monitor' && (
        <div className="flex-1 p-4 flex flex-col gap-4">

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total"     value={stats.total}     color="text-exam-blue"  />
            <StatCard label="Connected" value={stats.connected} color="text-green-600"  />
            <StatCard label="Watch"     value={stats.watch}     color="text-amber-600"  sub="Score 20–39" />
            <StatCard label="Flagged"   value={stats.flagged}   color="text-red-600"    sub="Score ≥ 40 🚨" />
          </div>

          {/* Candidate grid + violation feed */}
          <div className="flex gap-4 flex-1 min-h-0">

            {/* Candidate grid */}
            <div className="flex-1 bg-white rounded-2xl border border-exam-border p-4 min-h-[480px]">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-exam-text flex items-center gap-2">
                  Candidates
                  <span className="text-xs font-normal text-exam-muted">
                    {filtered.length} shown
                  </span>
                  <span className="text-[10px] text-exam-muted font-normal bg-gray-100 px-1.5 py-0.5 rounded-full">
                    scores refresh 30s
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
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      style={{}}
                      onClick={handleSelectCandidate}
                      onAudit={(cand) => router.push(`/admin/candidates/${cand.id}?exam_id=${EXAM_ID}`)}
                    />
                  ))}
                </div>
              )}

              {/* Legend */}
              <div className="flex gap-4 mt-3 text-xs text-exam-muted">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-green-100 border border-green-200 inline-block" /> Score &lt; 20
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-amber-50 border border-amber-200 inline-block" /> 20–39
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-red-50 border border-red-200 inline-block" /> ≥ 40 🚨
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
                        {fmtISTTime(v.created_at || v.timestamp)}
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
                <p className="mb-3">No results yet.</p>
                <p className="text-sm max-w-md mx-auto">
                  <strong>Step 1:</strong> Make sure at least one candidate has submitted the exam.<br />
                  <strong>Step 2:</strong> Click <strong>⚡ Compute Results</strong> — runs instantly, no Celery needed.<br />
                  <strong>Step 3:</strong> Results appear automatically. Use <strong>🔄 Refresh</strong> to re-fetch.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-exam-border text-left">
                      {['Rank','Roll No','Name','Score','Percentile','Correct','Incorrect','Attempted','Analysis'].map(h => (
                        <th key={h} className="pb-3 pr-4 text-xs font-semibold text-exam-muted uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-exam-border">
                    {results.map((r) => (
                      <tr
                        key={r.rank ?? r.roll_number}
                        className="hover:bg-gray-50 transition-colors"
                      >
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
                        <td className="py-3 pr-4 text-red-600 font-medium">{r.incorrect ?? '—'}</td>
                        <td className="py-3 pr-4 text-exam-muted">{r.attempted}</td>
                        <td className="py-3 pr-4">
                          {r.candidate_id ? (
                            <button
                              onClick={() => router.push(
                                `/admin/candidates/${r.candidate_id}?exam_id=${EXAM_ID}&tab=answers`
                              )}
                              className="px-2.5 py-1 text-xs bg-exam-blue/10 text-exam-blue rounded-lg
                                         hover:bg-exam-blue/20 font-medium transition-colors whitespace-nowrap"
                            >
                              📋 View Answers
                            </button>
                          ) : '—'}
                        </td>
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

          {/* Active Exam Status Banner */}
          {activeExam && (
            <div className="md:col-span-2">
              <div className={clsx(
                'rounded-2xl border px-6 py-4 flex items-center gap-4',
                activeExam.status === 'active'    ? 'bg-green-50 border-green-200' :
                activeExam.status === 'paused'    ? 'bg-amber-50 border-amber-200' :
                activeExam.status === 'completed' ? 'bg-gray-50 border-gray-200' :
                                                    'bg-blue-50 border-blue-200'
              )}>
                <div className={clsx(
                  'w-3 h-3 rounded-full flex-shrink-0',
                  activeExam.status === 'active'    ? 'bg-green-500 animate-pulse' :
                  activeExam.status === 'paused'    ? 'bg-amber-400' :
                  activeExam.status === 'completed' ? 'bg-gray-400' : 'bg-blue-400'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-800">
                    #{activeExam.id} — {activeExam.title}
                    <span className={clsx(
                      'ml-2 text-xs font-semibold px-2 py-0.5 rounded-full',
                      activeExam.status === 'active'    ? 'bg-green-100 text-green-700' :
                      activeExam.status === 'paused'    ? 'bg-amber-100 text-amber-700' :
                      activeExam.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                                                          'bg-blue-100 text-blue-700'
                    )}>
                      {activeExam.status?.toUpperCase()}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {activeExam.status === 'active' && activeExam.end_time && (
                      <>Ends {fmtIST(activeExam.end_time)} · {activeExam.total_questions} questions · {activeExam.duration_minutes} min</>
                    )}
                    {activeExam.status === 'completed' && 'Exam has ended'}
                    {activeExam.status === 'draft' && 'Exam not started yet'}
                  </p>
                </div>
                {activeExam.status === 'active' && activeExam.end_time && (
                  <ExamCountdownBadge endTime={activeExam.end_time} />
                )}
              </div>
            </div>
          )}

          {/* Start / Status */}
          <div className="bg-white rounded-2xl border border-exam-border p-6">
            <h2 className="font-bold text-exam-text mb-1">Exam Lifecycle</h2>
            <p className="text-sm text-exam-muted mb-4">
              Start the exam to begin the 15-minute candidate countdown, then questions appear.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleStartExam}
                disabled={activeExam?.status === 'active' || activeExam?.status === 'completed'}
                className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold text-sm
                           hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                🚀 Start Exam Now
              </button>
              <button
                onClick={handleEndExam}
                disabled={activeExam?.status !== 'active' && activeExam?.status !== 'paused'}
                className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold text-sm
                           hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ⏹ End Exam Now
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
                    {['Roll No', 'Name', 'Email', 'Integrity', 'Violations', 'Status', 'Action', ...(IS_DEV ? ['Dev'] : [])].map(h => (
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
                      {IS_DEV && (
                        <td className="py-3 pr-4">
                          <button
                            onClick={() => handleResetScore(c)}
                            className="px-3 py-1 text-xs bg-purple-50 text-purple-700 border border-purple-200
                                       rounded-lg hover:bg-purple-100 font-medium transition-colors"
                            title="DEV: reset Redis score + delete MySQL violations"
                          >
                            🔄 Reset
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Students ───────────────────────────────────────────────── */}
      {tab === 'students' && (
        <div className="flex-1 p-4 flex flex-col gap-4">

          {/* ── Mode switcher ─────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-exam-border p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-exam-text text-base">Student Management</h2>
                <p className="text-sm text-exam-muted mt-0.5">
                  Add candidates one by one or bulk-import from a CSV / Excel file.
                  After adding, go to <strong>Face Enrollment</strong> to upload their photos.
                </p>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <div className="text-3xl font-extrabold text-exam-blue">{candidates.length}</div>
                <div className="text-xs text-exam-muted">registered</div>
              </div>
            </div>

            {/* Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => { setStudentsMode('add'); setBulkResult(null) }}
                className={clsx(
                  'px-4 py-2 rounded-xl text-sm font-semibold border transition-colors',
                  studentsMode === 'add'
                    ? 'bg-exam-blue text-white border-exam-blue'
                    : 'border-exam-border text-exam-muted hover:bg-gray-50'
                )}
              >
                ➕ Add Single
              </button>
              <button
                onClick={() => { setStudentsMode('bulk'); setBulkResult(null) }}
                className={clsx(
                  'px-4 py-2 rounded-xl text-sm font-semibold border transition-colors',
                  studentsMode === 'bulk'
                    ? 'bg-exam-blue text-white border-exam-blue'
                    : 'border-exam-border text-exam-muted hover:bg-gray-50'
                )}
              >
                📂 Bulk Upload (CSV / Excel)
              </button>
            </div>
          </div>

          {/* ── Add Single form ────────────────────────────────────────── */}
          {studentsMode === 'add' && (
            <div className="bg-white rounded-2xl border border-exam-border p-6">
              <h3 className="font-semibold text-exam-text mb-1">Add New Candidate</h3>
              <p className="text-xs text-exam-muted mb-4">
                Roll number is <strong>auto-generated</strong> by the system. Fields marked <span className="text-red-500">*</span> are required.
              </p>
              <form onSubmit={handleAddCandidate} className="grid grid-cols-1 sm:grid-cols-3 gap-4">

                {/* Row 1 — required fields */}
                <div>
                  <label className="block text-xs font-semibold text-exam-muted mb-1 uppercase tracking-wide">
                    Application Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. APP260001"
                    value={addForm.application_number}
                    onChange={e => setAddForm(f => ({ ...f, application_number: e.target.value }))}
                    className="w-full px-3 py-2 border border-exam-border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-exam-muted mb-1 uppercase tracking-wide">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rahul Kumar Singh"
                    value={addForm.name}
                    onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-exam-border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-exam-muted mb-1 uppercase tracking-wide">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. rahul@example.com"
                    value={addForm.email}
                    onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-exam-border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue"
                    required
                  />
                </div>

                {/* Row 2 — admit card fields */}
                <div>
                  <label className="block text-xs font-semibold text-exam-muted mb-1 uppercase tracking-wide">Father&apos;s Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Rajesh Kumar Singh"
                    value={addForm.father_name}
                    onChange={e => setAddForm(f => ({ ...f, father_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-exam-border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-exam-muted mb-1 uppercase tracking-wide">Phone</label>
                  <input
                    type="text"
                    placeholder="e.g. 9876543210"
                    value={addForm.phone}
                    onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-exam-border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-exam-muted mb-1 uppercase tracking-wide">
                    Date of Birth <span className="text-xs text-exam-muted normal-case font-normal">(= exam password)</span>
                  </label>
                  <input
                    type="date"
                    value={addForm.date_of_birth}
                    onChange={e => setAddForm(f => ({ ...f, date_of_birth: e.target.value }))}
                    className="w-full px-3 py-2 border border-exam-border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue"
                  />
                </div>

                {/* Row 3 — dropdowns + state */}
                <div>
                  <label className="block text-xs font-semibold text-exam-muted mb-1 uppercase tracking-wide">Gender</label>
                  <select
                    value={addForm.gender}
                    onChange={e => setAddForm(f => ({ ...f, gender: e.target.value }))}
                    className="w-full px-3 py-2 border border-exam-border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue bg-white"
                  >
                    <option value="">— Select —</option>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-exam-muted mb-1 uppercase tracking-wide">Category</label>
                  <select
                    value={addForm.category}
                    onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2 border border-exam-border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue bg-white"
                  >
                    <option value="">— Select —</option>
                    {['GEN','OBC','OBC-NCL','SC','ST','EWS','PwD'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-exam-muted mb-1 uppercase tracking-wide">State</label>
                  <input
                    type="text"
                    placeholder="e.g. Assam"
                    value={addForm.state}
                    onChange={e => setAddForm(f => ({ ...f, state: e.target.value }))}
                    className="w-full px-3 py-2 border border-exam-border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue"
                  />
                </div>

                {/* Actions */}
                <div className="sm:col-span-3 flex items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={addLoading}
                    className="px-6 py-2.5 bg-exam-blue text-white rounded-xl text-sm font-semibold
                               hover:bg-blue-700 disabled:opacity-60 transition-colors"
                  >
                    {addLoading ? 'Adding…' : '➕ Add Candidate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddForm(EMPTY_ADD_FORM)}
                    className="px-4 py-2.5 text-sm text-exam-muted border border-exam-border rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Clear
                  </button>
                  <span className="text-xs text-exam-muted ml-auto">
                    Exam ID: <strong>{EXAM_ID}</strong>
                  </span>
                </div>
              </form>
            </div>
          )}

          {/* ── Bulk Upload ────────────────────────────────────────────── */}
          {studentsMode === 'bulk' && (
            <div className="bg-white rounded-2xl border border-exam-border p-6 space-y-5">
              <div>
                <h3 className="font-semibold text-exam-text mb-1">Bulk Import from CSV / Excel</h3>
                <p className="text-sm text-exam-muted">
                  Upload a <strong>.csv</strong> or <strong>.xlsx</strong> file.
                  The file must have these column headers (exact, case-insensitive):
                </p>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {['application_number','name','email','father_name','phone','date_of_birth','gender','category','state'].map((col, i) => (
                    <code key={col} className={`border px-2 py-0.5 rounded text-xs font-mono ${i < 3 ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                      {col}{i < 3 ? ' *' : ''}
                    </code>
                  ))}
                </div>
                <p className="text-xs text-exam-muted mt-1.5">
                  Roll number is <strong>auto-generated</strong> — do not include a roll_number column. The exam is set by the upload endpoint.
                </p>
              </div>

              {/* Template download hint */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                <strong>Template format (use the Excel template — first data row example):</strong>
                <pre className="mt-1 font-mono leading-relaxed whitespace-pre-wrap">{`application_number,name,father_name,email,phone,date_of_birth,gender,category,state
APP260001,Rahul Kumar Singh,Rajesh Kumar Singh,rahul@gmail.com,9876543210,2008-08-15,Male,GEN,Assam`}</pre>
              </div>

              {/* File picker */}
              <div>
                <input
                  ref={bulkFileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={e => { setBulkFile(e.target.files?.[0] || null); setBulkResult(null) }}
                />
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => bulkFileRef.current?.click()}
                    className="px-4 py-2.5 border-2 border-dashed border-exam-border rounded-xl text-sm
                               text-exam-muted hover:border-exam-blue hover:text-exam-blue transition-colors font-medium"
                  >
                    📁 {bulkFile ? bulkFile.name : 'Choose CSV or Excel file'}
                  </button>
                  {bulkFile && (
                    <>
                      <span className="text-xs text-exam-muted">
                        {(bulkFile.size / 1024).toFixed(1)} KB
                      </span>
                      <button
                        onClick={() => { setBulkFile(null); setBulkResult(null); if (bulkFileRef.current) bulkFileRef.current.value = '' }}
                        className="text-xs text-red-500 hover:underline"
                      >
                        ✕ Remove
                      </button>
                    </>
                  )}
                </div>
              </div>

              <button
                onClick={handleBulkUpload}
                disabled={!bulkFile || bulkLoading}
                className="px-6 py-2.5 bg-exam-blue text-white rounded-xl text-sm font-semibold
                           hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {bulkLoading ? '⏳ Importing…' : '⬆ Import Now'}
              </button>

              {/* Result summary */}
              {bulkResult && (
                <div className="space-y-3">
                  {/* Summary row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                      <div className="text-2xl font-extrabold text-green-600">{bulkResult.added}</div>
                      <div className="text-xs text-green-700 font-semibold mt-0.5">Added</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                      <div className="text-2xl font-extrabold text-amber-600">{bulkResult.skipped}</div>
                      <div className="text-xs text-amber-700 font-semibold mt-0.5">Skipped</div>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                      <div className="text-2xl font-extrabold text-red-600">{bulkResult.errors}</div>
                      <div className="text-xs text-red-700 font-semibold mt-0.5">Errors</div>
                    </div>
                  </div>

                  {/* Skipped details */}
                  {bulkResult.skipped_details?.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                      <p className="text-xs font-semibold text-amber-800 mb-2">Skipped rows:</p>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {bulkResult.skipped_details.map((s, i) => (
                          <div key={i} className="text-xs text-amber-700 font-mono">
                            Row {s.row} — {s.application_number || s.roll_number} — {s.reason}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Added list */}
                  {bulkResult.candidates?.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                      <p className="text-xs font-semibold text-green-800 mb-2">Successfully added:</p>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {bulkResult.candidates.map((c) => (
                          <div key={c.id} className="text-xs text-green-700 font-mono">
                            #{c.id} — Roll: {c.roll_number} — App: {c.application_number} — {c.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Student list ───────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-exam-border overflow-hidden">
            <div className="px-5 py-4 border-b border-exam-border flex items-center justify-between">
              <h3 className="font-semibold text-exam-text">
                All Candidates
                <span className="ml-2 text-xs font-normal text-exam-muted">({candidates.length} total)</span>
              </h3>
              <span className="text-xs text-exam-muted">
                {candidates.filter(c => c.photo_indexed).length} / {candidates.length} photos enrolled
              </span>
            </div>

            {candidates.length === 0 ? (
              <div className="text-center py-16 text-exam-muted">
                <div className="text-4xl mb-3">👥</div>
                <p>No candidates yet — add them above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-exam-border">
                    <tr>
                      {['#', 'Roll No (auto)', 'App No', 'Name', 'Email', 'Photo', 'Exam Started', 'Action'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-exam-muted uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-exam-border">
                    {candidates.map((c, i) => (
                      <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-xs text-exam-muted">{i + 1}</td>
                        <td className="px-4 py-3 font-mono text-xs text-exam-blue font-bold">{c.roll_number}</td>
                        <td className="px-4 py-3 font-mono text-xs text-exam-muted">{c.application_number || '—'}</td>
                        <td className="px-4 py-3 font-medium text-exam-text">{c.name}</td>
                        <td className="px-4 py-3 text-xs text-exam-muted">{c.email}</td>
                        <td className="px-4 py-3">
                          {c.photo_indexed ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">✓ Enrolled</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-exam-muted">
                          {c.exam_started_at ? fmtISTTime(c.exam_started_at) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleDeleteCandidate(c)}
                            className="px-3 py-1 text-xs bg-red-50 text-red-700 border border-red-200
                                       rounded-lg hover:bg-red-100 font-medium transition-colors"
                          >
                            🗑 Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

      {/* ── Tab: Scoring Guide ──────────────────────────────────────────── */}
      {tab === 'scoring' && (
        <div className="flex-1 p-4 flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-exam-border p-5">
            <h2 className="font-bold text-exam-text mb-1">Violation Scoring Guide</h2>
            <p className="text-sm text-exam-muted mb-1">
              Each violation adds <strong>weight × (severity ÷ 4)</strong> to the candidate&apos;s integrity score (0–100).
              Score ≥ 40 triggers a red alert. All flags are advisory — nothing auto-disqualifies.
            </p>
            <div className="flex items-center gap-4 text-xs text-exam-muted mt-2 mb-4 flex-wrap">
              <span>Example: <strong>face_mismatch</strong> (weight 8.0) at severity 4 → +8.0 pts</span>
              <span>Example: <strong>right_click</strong> (weight 0.5) at severity 1 → +0.125 pts</span>
            </div>

            {/* Formula card */}
            <div className="bg-exam-blue-light border border-blue-200 rounded-xl p-4 mb-5 text-sm">
              <code className="font-mono text-exam-blue font-bold">
                score_increment = weight × (severity / 4)
              </code>
              <div className="text-xs text-exam-muted mt-1">
                Severity range: 1 (Low) → 8 (Critical). Score is atomic-incremented in Redis and capped at 100.
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-exam-border text-left">
                    {['Violation Type', 'Category', 'Weight', 'Sev 2 score', 'Sev 4 score', 'Description'].map(h => (
                      <th key={h} className="pb-3 pr-4 text-xs font-semibold text-exam-muted uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-exam-border">
                  {VIOLATION_SCORING.map((row) => (
                    <tr key={row.type} className="hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 pr-4">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-exam-text">
                          {row.type}
                        </code>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', CATEGORY_COLOR[row.category])}>
                          {row.category}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-bold text-exam-text">{row.weight}</td>
                      <td className="py-2.5 pr-4 text-exam-muted font-mono text-xs">
                        +{(row.weight * 0.5).toFixed(2)}
                      </td>
                      <td className="py-2.5 pr-4 text-exam-muted font-mono text-xs">
                        +{(row.weight * 1.0).toFixed(2)}
                      </td>
                      <td className="py-2.5 text-exam-muted text-xs">{row.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Alert threshold info */}
          <div className="bg-white rounded-2xl border border-exam-border p-5">
            <h3 className="font-semibold text-exam-text mb-3">Alert Thresholds</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
                <span className="text-exam-muted">Score 0–19: Clean — no action needed</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />
                <span className="text-exam-muted">Score 20–39: Watch — review violations</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
                <span className="text-exam-muted">Score ≥ 40: 🚨 Alert — faculty review required</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Candidate detail modal ───────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
             onClick={() => { setSelected(null); setSelectedViolations([]) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
               onClick={(e) => e.stopPropagation()}>

            {/* Modal header */}
            <div className="flex items-start justify-between p-6 pb-4 border-b border-exam-border flex-shrink-0">
              <div>
                <h3 className="font-bold text-exam-text text-lg">{selected.name}</h3>
                <p className="text-sm text-exam-muted font-mono">{selected.roll_number}</p>
              </div>
              <button onClick={() => { setSelected(null); setSelectedViolations([]) }}
                className="text-exam-muted hover:text-exam-text w-8 h-8 flex items-center justify-center
                           rounded-lg hover:bg-gray-100 flex-shrink-0">
                ✕
              </button>
            </div>

            {/* Modal body — scrollable */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">

              {/* Quick stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-xs text-exam-muted mb-1">Status</div>
                  <div className={clsx('text-sm font-semibold', selected.connected ? 'text-green-600' : 'text-gray-400')}>
                    {selected.connected ? '🟢 Online' : '⚫ Offline'}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-xs text-exam-muted mb-1">Integrity Score</div>
                  <div className="flex justify-center">
                    <IntegrityBadge score={selected.integrity_score || 0} />
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-xs text-exam-muted mb-1">Violations</div>
                  <div className="text-sm font-bold text-exam-text">{selected.violation_count || 0}</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-xs text-exam-muted mb-1">Started</div>
                  <div className="text-xs font-medium text-exam-text">
                    {fmtISTTime(selected.exam_started_at)}
                  </div>
                </div>
              </div>

              {/* Email */}
              <div className="flex justify-between items-center text-sm py-1 border-b border-exam-border">
                <span className="text-exam-muted">Email</span>
                <span className="font-medium text-exam-text">{selected.email}</span>
              </div>

              {/* Violations list */}
              <div>
                <h4 className="font-semibold text-exam-text text-sm mb-2 flex items-center gap-2">
                  Violation Log
                  {selectedViolationsLoading && (
                    <span className="animate-spin inline-block w-3 h-3 border-2 border-gray-300 border-t-exam-blue rounded-full" />
                  )}
                  <span className="text-xs font-normal text-exam-muted">
                    ({selectedViolations.length} events)
                  </span>
                </h4>

                {selectedViolations.length === 0 && !selectedViolationsLoading ? (
                  <div className="text-sm text-exam-muted text-center py-4 bg-gray-50 rounded-xl">
                    No violations recorded
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {selectedViolations.map((v, i) => (
                      <div key={i} className={clsx(
                        'flex items-start justify-between gap-2 p-2.5 rounded-lg border text-xs',
                        v.severity >= 5 ? 'border-red-200 bg-red-50' :
                        v.severity >= 3 ? 'border-amber-200 bg-amber-50' :
                                         'border-gray-100 bg-gray-50'
                      )}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={clsx('font-semibold', SEV_COLOR[v.severity] || 'text-exam-text')}>
                              {v.type?.replace(/_/g, ' ')}
                            </span>
                            <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                              v.severity >= 5 ? 'bg-red-200 text-red-700' :
                              v.severity >= 3 ? 'bg-amber-200 text-amber-700' :
                                               'bg-gray-200 text-gray-600'
                            )}>
                              sev {v.severity}
                            </span>
                          </div>
                          <div className="text-gray-400 mt-0.5">
                            {fmtISTTime(v.created_at)}
                          </div>
                        </div>
                        {v.snapshot_url && (
                          <a href={v.snapshot_url} target="_blank" rel="noreferrer"
                            className="flex-shrink-0">
                            <img src={v.snapshot_url} alt="snapshot"
                              className="w-14 h-10 object-cover rounded border border-gray-200 hover:opacity-80 transition-opacity" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Snapshot thumbnails (violations with snapshot_url) */}
              {(() => {
                const snaps = selectedViolations.filter(v => v.snapshot_url)
                if (snaps.length === 0) return null
                return (
                  <div>
                    <h4 className="font-semibold text-exam-text text-sm mb-2">
                      Snapshots ({snaps.length})
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {snaps.map((v, i) => (
                        <a key={i} href={v.snapshot_url} target="_blank" rel="noreferrer"
                          title={`${v.type} · ${fmtISTTime(v.created_at)}`}>
                          <img src={v.snapshot_url} alt={v.type}
                            className="w-20 h-14 object-cover rounded-lg border border-gray-200 hover:border-exam-blue hover:shadow transition-all" />
                        </a>
                      ))}
                    </div>
                  </div>
                )
              })()}

            </div>

            {/* Modal footer */}
            <div className="flex gap-2 p-6 pt-4 border-t border-exam-border flex-shrink-0 flex-wrap">
              <button
                onClick={() => {
                  router.push(`/admin/candidates/${selected.id}?exam_id=${EXAM_ID}`)
                  setSelected(null)
                  setSelectedViolations([])
                }}
                className="flex-1 py-2.5 bg-exam-blue text-white rounded-xl text-sm font-semibold
                           hover:bg-blue-700 transition-colors min-w-[120px]"
              >
                🔍 Full Audit Page
              </button>
              {IS_DEV && (
                <button
                  onClick={() => handleResetScore(selected)}
                  className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold
                             hover:bg-purple-700 transition-colors min-w-[120px]"
                  title="DEV only — resets Redis score + deletes violations from MySQL"
                >
                  🔄 Reset Score
                </button>
              )}
              <button
                onClick={() => handleBlockCandidate(selected.id)}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold
                           hover:bg-red-700 transition-colors min-w-[120px]"
              >
                Block Candidate
              </button>
              <button onClick={() => { setSelected(null); setSelectedViolations([]) }}
                className="flex-1 py-2.5 border border-exam-border rounded-xl text-sm font-medium
                           hover:bg-gray-50 transition-colors min-w-[80px]">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
