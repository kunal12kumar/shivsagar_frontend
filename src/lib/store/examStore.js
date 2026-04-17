'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
      serverEndTime: null, // ISO string from server — authoritative

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
      isConnected: false,
      isLowBandwidth: false,

      // Proctoring state
      proctoringActive: false,
      violations: [],
      integrityScore: 0,

      // Actions
      setAuth: (data) => set(data),
      setExamMeta: (data) => set(data),
      setQuestions: (questions) => set({ questions }),
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
        examStatus: 'not_started', violations: [], integrityScore: 0,
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
        currentQuestion: state.currentQuestion,
      }),
    }
  )
)

export default useExamStore
