/**
 * Axios API client — wraps all HTTP calls to the FastAPI backend.
 * Automatically attaches the JWT from the exam store on every request.
 * Handles 401 (token expired) by redirecting to login.
 */
import axios from 'axios'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token on every request
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('rgipt-exam-store')
      if (raw) {
        const state = JSON.parse(raw)
        const jwt = state?.state?.jwt
        if (jwt) config.headers.Authorization = `Bearer ${jwt}`
      }
    } catch (_) {}
  }
  return config
})

// Handle auth errors globally
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('rgipt-exam-store')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// --- Auth ---
export const sendOTP = (data) => apiClient.post('/auth/otp/send', data)
export const verifyOTP = (data) => apiClient.post('/auth/otp/verify', data)

// --- Exam ---
export const getActiveExam = () => apiClient.get('/exams/active')
export const getExamInfo = (examId) => apiClient.get(`/exams/${examId}`)
export const startExam = (examId) => apiClient.post(`/exams/${examId}/start`)
export const submitExam = (examId, answers) => apiClient.post(`/exams/${examId}/submit`, { answers })

// --- Questions ---
// Load the entire question paper in one request (preferred — shows all 100 questions at once)
export const getAllQuestions = (examId) =>
  apiClient.get(`/exams/${examId}/questions/all`, { timeout: 30000 })
// Legacy batch loader (kept for reference; no longer used by the exam page)
export const getQuestionBatch = (examId, batchNum) =>
  apiClient.get(`/exams/${examId}/questions/batch/${batchNum}`)

// --- Face Verification ---
export const verifyFaceLogin = (examId, imageBlob) => {
  const form = new FormData()
  form.append('image', imageBlob, 'face.jpg')
  return apiClient.post(`/exams/${examId}/verify-face`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// --- Violations ---
export const reportViolation = (examId, violation) =>
  apiClient.post(`/exams/${examId}/violations`, violation)

// --- Admin ---
export const getAdminCandidates = () => apiClient.get('/admin/candidates')
export const getAdminViolations = () => apiClient.get('/admin/violations')
export const controlExam = (examId, action) => apiClient.post(`/admin/exams/${examId}/control`, { action })

export default apiClient
