'use client'
import { motion, AnimatePresence } from 'framer-motion'
import useExamStore from '@/lib/store/examStore'
import { clsx } from 'clsx'
import 'katex/dist/katex.min.css'
import MathRenderer from '@/components/admin/MathRenderer'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function resolveImageUrl(url) {
  if (!url) return null
  if (url.startsWith('/')) return `${API_BASE}${url}`
  return url
}

// ── Text MCQ option ──────────────────────────────────────────────────────────
function MCQOption({ label, text, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(label)}
      className={clsx(
        'w-full text-left flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition-all duration-150 group',
        selected
          ? 'border-blue-500 bg-blue-50 shadow-md shadow-blue-100'
          : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 hover:shadow-sm'
      )}
    >
      {/* Letter badge */}
      <span className={clsx(
        'flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-extrabold border-2 transition-all',
        selected
          ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
          : 'border-slate-300 text-slate-500 group-hover:border-blue-400 group-hover:text-blue-500'
      )}>
        {label}
      </span>
      <span className={clsx(
        'flex-1 text-[15px] leading-relaxed transition-colors',
        selected ? 'text-blue-900 font-semibold' : 'text-slate-700 font-medium'
      )}>
        <MathRenderer text={text} />
      </span>
      {/* Selected checkmark */}
      {selected && (
        <svg className="flex-shrink-0 w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
        </svg>
      )}
    </button>
  )
}

// ── Image MCQ option ─────────────────────────────────────────────────────────
function MCQImageOption({ label, text, imageUrl, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(label)}
      className={clsx(
        'flex flex-col rounded-2xl border-2 overflow-hidden transition-all duration-150',
        selected ? 'border-blue-500 shadow-lg shadow-blue-100' : 'border-slate-200 hover:border-blue-300'
      )}
    >
      <div className={clsx(
        'flex items-center gap-2 px-3 py-2 border-b',
        selected ? 'bg-blue-500 border-blue-500' : 'bg-slate-50 border-slate-200'
      )}>
        <span className={clsx(
          'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border',
          selected ? 'bg-white border-white text-blue-600' : 'border-slate-300 text-slate-500 bg-white'
        )}>
          {label}
        </span>
        {selected && <span className="text-xs text-white font-semibold">Selected</span>}
      </div>
      <div className="flex items-center justify-center p-3 bg-white min-h-[100px]">
        {imageUrl
          ? <img src={resolveImageUrl(imageUrl)} alt={`Option ${label}`} className="max-h-28 max-w-full object-contain" />
          : <span className="text-slate-400 text-xs italic">No image</span>
        }
      </div>
      {text && (
        <div className="px-3 pb-2 text-xs text-slate-500 text-center border-t border-slate-100 bg-white">
          <MathRenderer text={text} />
        </div>
      )}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function QuestionPanel({ question, questionNumber, totalQuestions }) {
  const answers         = useExamStore((s) => s.answers)
  const answerStatus    = useExamStore((s) => s.answerStatus)
  const setAnswer       = useExamStore((s) => s.setAnswer)
  const toggleMarked    = useExamStore((s) => s.toggleMarked)
  const markedForReview = useExamStore((s) => s.markedForReview)

  if (!question) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
      Loading question…
    </div>
  )

  const currentAnswer = answers[question.id]
  const status        = answerStatus[question.id]
  const isMarked      = markedForReview[question.id]

  const optionEntries = question.options
    ? Object.entries(question.options).sort(([a], [b]) => a.localeCompare(b))
    : []

  const hasOptionImages = question.option_images &&
    Object.values(question.option_images).some(Boolean)

  const handleOptionSelect = (label) => {
    if (question.type === 'multi_mcq') {
      const prev = Array.isArray(currentAnswer) ? currentAnswer : []
      const next = prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label]
      setAnswer(question.id, next.length > 0 ? next : null)
    } else if (question.type !== 'numerical') {
      setAnswer(question.id, currentAnswer === label ? null : label)
    }
  }

  const isSelected = (label) => {
    if (question.type === 'multi_mcq') return Array.isArray(currentAnswer) && currentAnswer.includes(label)
    return currentAnswer === label
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={question.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.18 }}
        className="flex flex-col gap-5"
      >
        {/* ── Meta row ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Subject badge */}
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 uppercase tracking-wider">
              {question.subject || 'General'}
            </span>
            {question.type === 'multi_mcq' && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                Multi-correct
              </span>
            )}
            {question.type === 'numerical' && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">
                Numerical
              </span>
            )}
            {/* Marks */}
            {question.marks && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                +{question.marks}{question.negative_marks ? ` / −${question.negative_marks}` : ''} marks
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Save status */}
            {status === 'pending' && (
              <span className="text-xs text-amber-600 flex items-center gap-1.5 font-medium">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
                </svg>
                Saving…
              </span>
            )}
            {status === 'saved' && (
              <span className="text-xs text-emerald-600 flex items-center gap-1.5 font-medium">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
                Saved
              </span>
            )}
            {/* Mark for review */}
            <button
              onClick={() => toggleMarked(question.id)}
              className={clsx(
                'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-semibold transition-all',
                isMarked
                  ? 'bg-amber-100 border-amber-400 text-amber-700'
                  : 'bg-white border-slate-300 text-slate-500 hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50'
              )}
            >
              {isMarked ? '★' : '☆'} {isMarked ? 'Marked' : 'Mark for Review'}
            </button>
          </div>
        </div>

        {/* ── Question text ─────────────────────────────────────────── */}
        <div className="bg-white border-2 border-slate-200 rounded-2xl px-6 py-5 shadow-sm">
          <p className="text-slate-800 text-[15px] leading-[1.8] font-medium">
            <MathRenderer text={question.text} />
          </p>
          {question.image_url && (
            <img
              src={resolveImageUrl(question.image_url)}
              alt="Question diagram"
              className="mt-4 max-w-full rounded-xl border border-slate-200"
              style={{ maxHeight: '280px', objectFit: 'contain' }}
            />
          )}
        </div>

        {/* ── Answer area ───────────────────────────────────────────── */}
        {question.type === 'numerical' ? (
          <div className="flex flex-col gap-2">
            <label className="text-sm text-slate-500 font-semibold">Enter your numerical answer:</label>
            <input
              type="number"
              value={currentAnswer ?? ''}
              onChange={e => setAnswer(question.id, e.target.value || null)}
              placeholder="Type your answer here"
              className="w-52 px-4 py-3 rounded-xl border-2 border-slate-200 text-lg font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 bg-white"
            />
            <p className="text-xs text-slate-400">Round to 2 decimal places if needed</p>
          </div>

        ) : hasOptionImages ? (
          <div className="grid grid-cols-2 gap-3">
            {optionEntries.map(([label, text]) => (
              <MCQImageOption
                key={label} label={label} text={text}
                imageUrl={question.option_images?.[label]}
                selected={isSelected(label)} onSelect={handleOptionSelect}
              />
            ))}
          </div>

        ) : (
          <div className="flex flex-col gap-2.5">
            {optionEntries.map(([label, text]) => (
              <MCQOption
                key={label} label={label} text={text}
                selected={isSelected(label)} onSelect={handleOptionSelect}
              />
            ))}
          </div>
        )}

        {question.type === 'multi_mcq' && (
          <p className="text-xs text-slate-400 text-center italic">
            Multiple answers may be correct — select all that apply
          </p>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
