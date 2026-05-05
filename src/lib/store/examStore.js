'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Seeded PRNG (mulberry32) — deterministic shuffle per candidate_id.
// Same candidate always sees the same question order across refreshes.
function _seededRand(seed) {
  let s = (seed >>> 0) || 1
  return () => {
    s += 0x6D2B79F5
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function _shuffled(arr, seed) {
  const out = [...arr]
  const rand = _seededRand(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * examStore — central state for the active exam session.
 * Uses localStorage persistence so answers survive a browser refresh or network drop.
 * On reconnect, pending answers are bulk-synced to the server.
 *
 * _hasHydrated: set to true once Zustand has finished reading from localStorage.
 * Pages should wait for this before checking auth to avoid redirect flicker.
 */
const useExamStore = create(
  persist(
    (set, get) => ({
      // Hydration flag — false until localStorage has been read
      _hasHydrated: false,
      setHasHydrated: (val) => set({ _hasHydrated: val }),

      // Auth
      candidateId: null,
      candidateName: '',
      candidateEmail: '',
      examId: null,
      jwt: null,

      // Exam metadata
      examTitle: '',
      totalQuestions: 0,
      examDuration: 180, // minutes
      serverEndTime: null,          // ISO string from server — authoritative end time
      questionsAvailableAt: null,   // ISO string — show questions after this time (post-countdown)

      // Questions (decrypted batch)
      questions: [],
      currentQuestion: 0,

      // Answers: { questionId: selectedOption }
      answers: {},
      // 'pending' = saved locally but not ACKed by server
      // 'saved' = server ACKed
      answerStatus: {}, // { questionId: 'pending' | 'saved' }

      // Marked for review
      markedForReview: {},

      // Exam status
      examStatus: 'not_started', // not_started | active | paused | submitted
      // Which exam_id was submitted — used to allow re-entry into a DIFFERENT exam
      submittedExamId: null,
      isConnected: false,
      isLowBandwidth: false,

      // Proctoring state
      proctoringActive: false,
      violations: [],
      integrityScore: 0,

      // Actions
      setAuth: (data) => set(data),
      setExamMeta: (data) => set(data),
      setQuestions: (questions) => {
        // Shuffle deterministically by candidateId so each student sees a unique
        // order that stays stable across refreshes. Also resets to question 1
        // so a previous session's position in localStorage doesn't carry over.
        const seed = get().candidateId || 0
        set({ questions: _shuffled(questions, seed), currentQuestion: 0 })
      },
      setCurrentQuestion: (idx) => set({ currentQuestion: idx }),

      setAnswer: (questionId, answer) => {
        set((state) => ({
          answers: { ...state.answers, [questionId]: answer },
          answerStatus: { ...state.answerStatus, [questionId]: 'pending' },
        }))
      },

      confirmAnswer: (questionId) => {
        set((state) => ({
          answerStatus: { ...state.answerStatus, [questionId]: 'saved' },
        }))
      },

      toggleMarked: (questionId) => {
        set((state) => ({
          markedForReview: {
            ...state.markedForReview,
            [questionId]: !state.markedForReview[questionId],
          },
        }))
      },

      syncFromServer: (serverAnswers) => {
        // Merge server answers with local — server wins for confirmed, local wins for pending
        set((state) => {
          const merged = { ...serverAnswers }
          Object.entries(state.answers).forEach(([qId, ans]) => {
            if (state.answerStatus[qId] === 'pending') {
              merged[qId] = ans
            }
          })
          return { answers: merged }
        })
      },

      setConnected: (val) => set({ isConnected: val }),
      setLowBandwidth: (val) => set({ isLowBandwidth: val }),
      setExamStatus: (status) => set({ examStatus: status }),
      setProctoringActive: (val) => set({ proctoringActive: val }),

      addViolation: (violation) => {
        set((state) => ({
          violations: [...state.violations.slice(-49), violation], // keep last 50
        }))
      },

      setIntegrityScore: (score) => set({ integrityScore: score }),

      reset: () => set({
        candidateId: null, jwt: null, examId: null, questions: [],
        answers: {}, answerStatus: {}, markedForReview: {},
        examStatus: 'not_started', submittedExamId: null,
        violations: [], integrityScore: 0,
      }),
    }),
    {
      name: 'rgipt-exam-store',
      // Notify when Zustand finishes reading from localStorage
      onRehydrateStorage: () => (state) => {
        if (state) state.setHasHydrated(true)
      },
      // Only persist what's needed to survive a browser refresh or network drop
      partialize: (state) => ({
        candidateId: state.candidateId,
        candidateName: state.candidateName,
        candidateEmail: state.candidateEmail,
        jwt: state.jwt,
        examId: state.examId,
        examTitle: state.examTitle,
        totalQuestions: state.totalQuestions,
        examDuration: state.examDuration,
        answers: state.answers,
        answerStatus: state.answerStatus,
        markedForReview: state.markedForReview,
        serverEndTime: state.serverEndTime,
        questionsAvailableAt: state.questionsAvailableAt,
        currentQuestion: state.currentQuestion,
        // Persist submission state per-exam so a new exam can still be attempted
        examStatus: state.examStatus,
        submittedExamId: state.submittedExamId,
      }),
    }
  )
)

export default useExamStore
