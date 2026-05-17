/**
 * adminClient.js — Axios client for admin-only API calls.
 * Reads the admin JWT from localStorage ('rgipt-admin-token'),
 * separate from the candidate exam store.
 * On 401, clears the token and redirects to /admin/login.
 */
import axios from 'axios'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const adminClient = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach admin JWT on every request
adminClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('rgipt-admin-token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// On 401, clear token and redirect to admin login
adminClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('rgipt-admin-token')
      localStorage.removeItem('rgipt-admin-email')
      localStorage.removeItem('rgipt-admin-role')
      window.location.href = '/admin/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const adminLogin   = (data)    => adminClient.post('/admin/auth/login', data)
export const adminMe      = ()        => adminClient.get('/admin/auth/me')

// ── Candidates ────────────────────────────────────────────────────────────────
// No exam_id filter — returns ALL candidates regardless of which exam they were registered under.
// exam_id is still forwarded if provided so the backend can use it for live scores/violations.
export const getCandidates   = (examId = null) =>
  adminClient.get(examId != null ? `/admin/candidates?exam_id=${examId}` : '/admin/candidates')
export const addCandidate    = (data)       => adminClient.post('/admin/candidates', data)
export const bulkImportCandidates = (file, examId = null) => {
  const form = new FormData()
  form.append('file', file)
  const url = examId != null
    ? `/admin/candidates/bulk?exam_id=${examId}`
    : '/admin/candidates/bulk'
  return adminClient.post(url, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const deleteCandidate = (candidateId) => adminClient.delete(`/admin/candidates/${candidateId}`)
export const bulkDeleteCandidates = (candidateIds) =>
  adminClient.delete('/admin/candidates/bulk-delete', { data: { candidate_ids: candidateIds } })
export const getViolations   = (examId = 1, limit = 100) =>
  adminClient.get(`/admin/violations?exam_id=${examId}&limit=${limit}`)
export const getCandidateViolations = (candidateId, examId = 1, limit = 100) =>
  adminClient.get(`/admin/candidates/${candidateId}/violations?exam_id=${examId}&limit=${limit}`)
export const getCandidateSnapshots = (candidateId, examId = 1) =>
  adminClient.get(`/admin/candidates/${candidateId}/snapshots?exam_id=${examId}`)
export const resetCandidateScore = (candidateId, examId = 1) =>
  adminClient.post(`/admin/candidates/${candidateId}/reset-score?exam_id=${examId}`)
export const getCandidateAnswers = (candidateId, examId = 1) =>
  adminClient.get(`/admin/candidates/${candidateId}/answers?exam_id=${examId}`)
export const getLiveScores   = (examId = 1) => adminClient.get(`/admin/exams/${examId}/scores`)

// ── Exam control ──────────────────────────────────────────────────────────────
export const controlExam     = (examId, action) =>
  adminClient.post(`/admin/exams/${examId}/control`, { action })
export const startExam       = (examId) => adminClient.post(`/admin/exams/${examId}/start`)
export const endExam         = (examId) => adminClient.post(`/admin/exams/${examId}/control`, { action: 'complete' })

// ── Credentials ───────────────────────────────────────────────────────────────
// Generates roll numbers + passwords for all candidates missing them.
// Returns an Excel blob — caller must trigger a browser download.
export const generateCredentials = () =>
  adminClient.post('/admin/candidates/generate-credentials', {}, { responseType: 'blob', timeout: 60000 })
export const exportCredentials = () =>
  adminClient.get('/admin/candidates/export-credentials', { responseType: 'blob', timeout: 60000 })

// ── Results ───────────────────────────────────────────────────────────────────
export const getResults      = (examId) => adminClient.get(`/admin/exams/${examId}/results`)
export const computeResults  = (examId) => adminClient.post(`/admin/exams/${examId}/results/compute`)
export const exportResults   = (examId) =>
  adminClient.get(`/admin/exams/${examId}/results/export`, { responseType: 'blob', timeout: 60000 })

// ── Answer sheets ─────────────────────────────────────────────────────────────
export const exportAllAnswerSheets = (examId) =>
  adminClient.get(`/admin/exams/${examId}/answers/export`, { responseType: 'blob', timeout: 120000 })
export const exportCandidateAnswerSheet = (candidateId, examId) =>
  adminClient.get(`/admin/candidates/${candidateId}/answers/export?exam_id=${examId}`, { responseType: 'blob', timeout: 30000 })

// ── Face Enrollment (Operation A — IndexFaces) ────────────────────────────────
export const getCandidatePhotoUrl = (candidateId) =>
  adminClient.get(`/admin/candidates/${candidateId}/photo-url`)
export const indexFace = (candidateId, imageFile) => {
  const form = new FormData()
  form.append('image', imageFile)
  return adminClient.post(`/admin/candidates/${candidateId}/index-face`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// ── Exam management ───────────────────────────────────────────────────────────
export const listExams   = ()           => adminClient.get('/admin/exams')
export const createExam  = (data)       => adminClient.post('/admin/exams', data)

// ── Question management ───────────────────────────────────────────────────────
export const listQuestions   = (examId)                => adminClient.get(`/admin/exams/${examId}/questions`)
export const createQuestion  = (examId, data)          => adminClient.post(`/admin/exams/${examId}/questions`, data)
export const updateQuestion  = (questionId, data)      => adminClient.put(`/admin/questions/${questionId}`, data)
export const deleteQuestion  = (questionId)            => adminClient.delete(`/admin/questions/${questionId}`)
export const uploadQuestionImage = (imageFile) => {
  const form = new FormData()
  form.append('image', imageFile)
  return adminClient.post('/admin/questions/upload-image', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// ── Question extraction (PDF → AI extract → review) ──────────────────────────
export const uploadExamPdf = (file, title, expectedQuestions = 100, onUploadProgress) => {
  const form = new FormData()
  form.append('file', file)
  form.append('title', title)
  form.append('expected_questions', String(expectedQuestions))
  return adminClient.post('/admin/extractions/upload-pdf', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,        // PDFs up to 50MB — give the upload time
    onUploadProgress,
  })
}
export const getExtractionProgress = (extractionId) =>
  adminClient.get(`/admin/extractions/${extractionId}/progress`, { timeout: 30000 })
export const listExtractions = () =>
  adminClient.get('/admin/extractions')
export const retryExtraction = (extractionId) =>
  adminClient.post(`/admin/extractions/${extractionId}/retry`, {}, { timeout: 30000 })

// ── Extraction review (Phase 2) ───────────────────────────────────────────────
export const listExtractedQuestions = (extractionId, status) =>
  adminClient.get(`/admin/extractions/${extractionId}/questions${status ? `?status=${status}` : ''}`)
export const getReviewStats        = (extractionId) =>
  adminClient.get(`/admin/extractions/${extractionId}/review-stats`)
export const updateExtractedQuestion = (questionId, data) =>
  adminClient.patch(`/admin/extractions/questions/${questionId}`, data)
export const approveQuestion       = (questionId) =>
  adminClient.post(`/admin/extractions/questions/${questionId}/approve`)
export const rejectQuestion        = (questionId) =>
  adminClient.post(`/admin/extractions/questions/${questionId}/reject`)
export const skipQuestion          = (questionId) =>
  adminClient.post(`/admin/extractions/questions/${questionId}/skip`)
export const uploadExtractedQuestionImage = (questionId, imageFile) => {
  const form = new FormData()
  form.append('image', imageFile)
  return adminClient.post(
    `/admin/extractions/questions/${questionId}/upload-question-image`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 },
  )
}
export const uploadOptionImage     = (questionId, optionLetter, imageFile) => {
  const form = new FormData()
  form.append('option_letter', optionLetter)
  form.append('image', imageFile)
  return adminClient.post(
    `/admin/extractions/questions/${questionId}/upload-option-image`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 },
  )
}
export const getExtractionPageUrls = (extractionId) =>
  adminClient.get(`/admin/extractions/${extractionId}/page-urls`, { timeout: 30000 })

// ── Go-Live (exam_controller only) ────────────────────────────────────────────
export const goLiveQuestions = (examId, extractionId, replaceExisting = true) =>
  adminClient.post(`/admin/exams/${examId}/go-live`, {
    extraction_id: extractionId,
    replace_existing: replaceExisting,
  })

// ── Delete extraction ─────────────────────────────────────────────────────────
export const deleteExtraction = (extractionId) =>
  adminClient.delete(`/admin/extractions/${extractionId}`)

// ── Role helpers (read from localStorage) ────────────────────────────────────
export const getAdminRole    = () =>
  typeof window !== 'undefined' ? (localStorage.getItem('rgipt-admin-role') || '') : ''
export const isQuestionManager = () => getAdminRole() === 'question_manager'
export const isExamController  = () => getAdminRole() === 'exam_controller'

export default adminClient
