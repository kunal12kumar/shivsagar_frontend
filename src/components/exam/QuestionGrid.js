'use client'
import useExamStore from '@/lib/store/examStore'
import { clsx } from 'clsx'

function getQuestionState(questionId, answers, markedForReview) {
  const answered = answers[questionId] !== undefined && answers[questionId] !== '' && answers[questionId] !== null
  const marked = markedForReview[questionId]
  if (marked && answered) return 'marked-answered'
  if (marked) return 'marked'
  if (answered) return 'answered'
  return 'unattempted'
}

export default function QuestionGrid({ questions, onNavigate }) {
  const currentQuestion = useExamStore((s) => s.currentQuestion)
  const answers         = useExamStore((s) => s.answers)
  const markedForReview = useExamStore((s) => s.markedForReview)

  const answered   = questions.filter(q => answers[q.id] !== undefined && answers[q.id] !== '' && answers[q.id] !== null).length
  const marked     = questions.filter(q => markedForReview[q.id]).length
  const remaining  = questions.length - answered

  return (
    <div className="flex flex-col gap-4">

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center justify-center rounded-xl py-2.5 px-1 bg-emerald-50 border border-emerald-200">
          <span className="text-xl font-extrabold text-emerald-600 leading-tight">{answered}</span>
          <span className="text-[10px] font-semibold text-emerald-500 mt-0.5 uppercase tracking-wide">Answered</span>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl py-2.5 px-1 bg-amber-50 border border-amber-200">
          <span className="text-xl font-extrabold text-amber-500 leading-tight">{marked}</span>
          <span className="text-[10px] font-semibold text-amber-400 mt-0.5 uppercase tracking-wide">Marked</span>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl py-2.5 px-1 bg-slate-50 border border-slate-200">
          <span className="text-xl font-extrabold text-slate-500 leading-tight">{remaining}</span>
          <span className="text-[10px] font-semibold text-slate-400 mt-0.5 uppercase tracking-wide">Left</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-slate-500 px-0.5">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />
          Answered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" />
          Marked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-white border border-slate-300 inline-block" />
          Not visited
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-5 gap-1.5">
        {questions.map((q, idx) => {
          const state     = getQuestionState(q.id, answers, markedForReview)
          const isCurrent = idx === currentQuestion

          const base = 'relative flex items-center justify-center rounded-lg text-xs font-bold border transition-all duration-100 cursor-pointer select-none'

          const stateClass =
            state === 'answered'        ? 'bg-emerald-500 text-white border-emerald-600 shadow-sm' :
            state === 'marked'          ? 'bg-amber-100 text-amber-700 border-amber-400' :
            state === 'marked-answered' ? 'bg-amber-400 text-white border-amber-500 shadow-sm' :
            /* unattempted */             'bg-white text-slate-500 border-slate-300 hover:border-blue-400 hover:text-blue-600'

          return (
            <button
              key={q.id}
              onClick={() => onNavigate(idx)}
              style={{ aspectRatio: '1' }}
              className={clsx(
                base,
                stateClass,
                isCurrent && 'ring-2 ring-blue-500 ring-offset-1 scale-110 z-10 shadow-md'
              )}
            >
              {idx + 1}
              {/* Current dot indicator */}
              {isCurrent && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full border border-white" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
