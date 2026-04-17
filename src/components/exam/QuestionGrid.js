'use client'
/**
 * QuestionGrid — displays all 90 questions as a scrollable grid.
 * Color coding:
 *   - Gray (unattempted): not visited
 *   - Blue (answered): answer saved
 *   - Amber (marked for review): flagged by candidate
 *   - Green border: current question
 * Clicking any cell navigates to that question.
 */
import useExamStore from '@/lib/store/examStore'
import { clsx } from 'clsx'

function getQuestionState(questionId, answers, answerStatus, markedForReview) {
  const answered = answers[questionId] !== undefined && answers[questionId] !== ''
  const marked = markedForReview[questionId]
  if (marked && answered) return 'marked-answered'
  if (marked) return 'marked'
  if (answered) return 'answered'
  return 'unattempted'
}

const stateStyles = {
  'answered': 'bg-exam-green text-white border-exam-green',
  'marked': 'bg-exam-amber-light text-exam-amber border-amber-400',
  'marked-answered': 'bg-amber-400 text-white border-amber-500',
  'unattempted': 'bg-white text-exam-muted border-exam-border',
}

export default function QuestionGrid({ questions, onNavigate }) {
  const currentQuestion = useExamStore((s) => s.currentQuestion)
  const answers = useExamStore((s) => s.answers)
  const answerStatus = useExamStore((s) => s.answerStatus)
  const markedForReview = useExamStore((s) => s.markedForReview)

  const answered = questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== '').length
  const marked = questions.filter((q) => markedForReview[q.id]).length

  return (
    <div className="flex flex-col gap-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        {[
          { label: 'Answered', color: 'bg-exam-green' },
          { label: 'Marked', color: 'bg-amber-400' },
          { label: 'Not visited', color: 'bg-white border border-exam-border' },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1.5 text-exam-muted">
            <span className={clsx('w-3 h-3 rounded-sm', color)} />
            {label}
          </span>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Answered', value: answered, color: 'text-exam-green' },
          { label: 'Marked', value: marked, color: 'text-exam-amber' },
          { label: 'Remaining', value: questions.length - answered, color: 'text-exam-muted' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg p-2 border border-exam-border">
            <div className={clsx('text-lg font-bold', color)}>{value}</div>
            <div className="text-xs text-exam-muted">{label}</div>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-5 gap-1.5 max-h-96 overflow-y-auto">
        {questions.map((q, idx) => {
          const state = getQuestionState(q.id, answers, answerStatus, markedForReview)
          const isCurrent = idx === currentQuestion
          return (
            <button
              key={q.id}
              onClick={() => onNavigate(idx)}
              className={clsx(
                'aspect-square rounded-lg border text-xs font-bold transition-all duration-100',
                'hover:ring-2 hover:ring-exam-blue hover:ring-offset-1',
                stateStyles[state],
                isCurrent && 'ring-2 ring-exam-blue ring-offset-1 scale-110 z-10'
              )}
            >
              {idx + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}
