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
      window.location.href = '/admin/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const adminLogin   = (data)    => adminClient.post('/admin/auth/login', data)
export const adminMe      = ()        => adminClient.get('/admin/auth/me')

// ── Candidates ────────────────────────────────────────────────────────────────
export const getCandidates   = (examId = 1) => adminClient.get(`/admin/candidates?exam_id=${examId}`)
export const getViolations   = (examId = 1, limit = 100) =>
  adminClient.get(`/admin/violations?exam_id=${examId}&limit=${limit}`)

// ── Exam control ──────────────────────────────────────────────────────────────
export const controlExam     = (examId, action) =>
  adminClient.post(`/admin/exams/${examId}/control`, { action })
export const startExam       = (examId) => adminClient.post(`/admin/exams/${examId}/start`)

// ── Results ───────────────────────────────────────────────────────────────────
export const getResults      = (examId) => adminClient.get(`/admin/exams/${examId}/results`)
export const computeResults  = (examId) => adminClient.post(`/admin/exams/${examId}/results/compute`)

// ── Face Enrollment (Operation A — IndexFaces) ────────────────────────────────
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

export default adminClient
