'use client'
/**
 * QuestionPanel — renders a single question for the candidate exam view.
 *
 * Supports:
 *   - single_mcq  : pick exactly one option (A/B/C/D)
 *   - multi_mcq   : pick one or more
 *   - numerical   : type a number
 *
 * Options format: dict { A: text, B: text, C: text, D: text }
 * option_images:  dict { A: url|null, B: url|null, ... } for diagram questions
 *
 * Math rendering: $...$ inline, $$...$$ block via KaTeX.
 * Framer Motion fade transition between questions.
 */
import { motion, AnimatePresence } from 'framer-motion'
import useExamStore from '@/lib/store/examStore'
import { clsx } from 'clsx'
import 'katex/dist/katex.min.css'
import MathRenderer from '@/components/admin/MathRenderer'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

/** Convert relative proxy paths (/questions/image-proxy?key=...) to absolute URLs */
function resolveImageUrl(url) {
  if (!url) return null
  if (url.startsWith('/')) return `${API_BASE}${url}`
  return url  // already absolute (https://... or data:...)
}

// ── MCQ option (text-only layout) ───────────────────────────────────────────
function MCQOption({ label, text, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(label)}
      className={clsx(
        'w-full text-left flex items-start gap-3 p-4 rounded-lg border transition-all duration-150',
        'hover:border-exam-blue hover:bg-exam-blue-light',
        selected
          ? 'border-exam-blue bg-exam-blue-light text-exam-blue font-medium'
          : 'border-exam-border bg-white text-exam-text'
      )}
    >
      <span className={clsx(
        'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border',
        selected ? 'bg-exam-blue border-exam-blue text-white' : 'border-exam-border text-exam-muted'
      )}>
        {label}
      </span>
      <span className="flex-1 text-sm leading-relaxed pt-0.5 font-serif">
        <MathRenderer text={text} />
      </span>
    </button>
  )
}

// ── MCQ option (image / diagram layout — 2×2 grid card) ────────────────────
function MCQImageOption({ label, text, imageUrl, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(label)}
      className={clsx(
        'flex flex-col rounded-xl border-2 overflow-hidden transition-all duration-150',
        selected
          ? 'border-exam-blue shadow-md'
          : 'border-exam-border hover:border-exam-blue/50'
      )}
    >
      {/* Label row */}
      <div className={clsx(
        'flex items-center gap-2 px-3 py-1.5 border-b',
        selected ? 'bg-exam-blue border-exam-blue' : 'bg-gray-50 border-exam-border'
      )}>
        <span className={clsx(
          'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border',
          selected ? 'bg-white border-white text-exam-blue' : 'border-exam-border text-exam-muted bg-white'
        )}>
          {label}
        </span>
        {selected && <span className="text-xs text-white font-semibold">Selected</span>}
      </div>

      {/* Diagram */}
      <div className="flex items-center justify-center p-3 bg-white min-h-[100px]">
        {imageUrl ? (
          <img
            src={resolveImageUrl(imageUrl)}
            alt={`Option ${label}`}
            className="max-h-28 max-w-full object-contain"
          />
        ) : (
          <span className="text-exam-muted text-xs italic">No image</span>
        )}
      </div>

      {/* Caption (if any text alongside the image) */}
      {text && (
        <div className="px-3 pb-2 text-xs text-exam-muted text-center border-t border-exam-border bg-white font-serif">
          <MathRenderer text={text} />
        </div>
      )}
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function QuestionPanel({ question, questionNumber, totalQuestions }) {
  const answers        = useExamStore((s) => s.answers)
  const answerStatus   = useExamStore((s) => s.answerStatus)
  const setAnswer      = useExamStore((s) => s.setAnswer)
  const toggleMarked   = useExamStore((s) => s.toggleMarked)
  const markedForReview = useExamStore((s) => s.markedForReview)

  if (!question) return (
    <div className="flex items-center justify-center h-64 text-exam-muted">
      Loading question…
    </div>
  )

  const currentAnswer = answers[question.id]
  const status        = answerStatus[question.id]
  const isMarked      = markedForReview[question.id]

  // ── Normalise options to sorted entries [['A',text],['B',text],...] ───────
  // options arrives as dict {A:str, B:str, ...} from API
  const optionEntries = question.options
    ? Object.entries(question.options).sort(([a], [b]) => a.localeCompare(b))
    : []

  // Check if any option has a diagram image
  const hasOptionImages = question.option_images &&
    Object.values(question.option_images).some(Boolean)

  // ── Answer selection logic ────────────────────────────────────────────────
  // Answers are stored as the LETTER key ('A'/'B'/'C'/'D') — matches DB correct_answer.
  // NOTE: questions extracted from PDFs may arrive with type='text' or 'visual' instead of
  // 'single_mcq' — we treat ANY non-multi, non-numerical type as single MCQ so clicking
  // always works regardless of what the backend stored.
  const handleOptionSelect = (label) => {
    if (question.type === 'multi_mcq') {
      const prev = Array.isArray(currentAnswer) ? currentAnswer : []
      const next = prev.includes(label)
        ? prev.filter((x) => x !== label)
        : [...prev, label]
      setAnswer(question.id, next.length > 0 ? next : null)
    } else if (question.type !== 'numerical') {
      // Covers: 'single_mcq', 'text', 'visual', null, undefined, or any other MCQ variant
      // Toggle off if the same option is clicked again
      setAnswer(question.id, currentAnswer === label ? null : label)
    }
  }

  const isSelected = (label) => {
    if (question.type === 'multi_mcq') {
      return Array.isArray(currentAnswer) && currentAnswer.includes(label)
    }
    return currentAnswer === label
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={question.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col gap-5"
      >
        {/* ── Question header ──────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex-shrink-0 bg-exam-blue text-white text-sm font-bold w-8 h-8 rounded-full flex items-center justify-center">
              {questionNumber}
            </span>
            <div>
              <span className="text-xs text-exam-muted uppercase tracking-wide">
                {question.subject || 'General'}
                {question.type === 'multi_mcq' && ' • Multiple correct'}
                {question.type === 'numerical'  && ' • Numerical answer'}
              </span>
              {question.marks && (
                <span className="ml-2 text-xs text-exam-green font-medium">
                  +{question.marks} marks{question.negative_marks ? ` / −${question.negative_marks}` : ''}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Save status */}
            {status === 'pending' && (
              <span className="text-xs text-exam-amber flex items-center gap-1">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
                </svg>
                Saving
              </span>
            )}
            {status === 'saved' && (
              <span className="text-xs text-exam-green flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
                Saved
              </span>
            )}
            {/* Mark for review */}
            <button
              onClick={() => toggleMarked(question.id)}
              className={clsx(
                'text-xs px-3 py-1 rounded-full border transition-colors',
                isMarked
                  ? 'bg-exam-amber-light border-amber-300 text-exam-amber font-medium'
                  : 'border-exam-border text-exam-muted hover:border-exam-amber'
              )}
            >
              {isMarked ? '★ Marked' : '☆ Mark for Review'}
            </button>
          </div>
        </div>

        {/* ── Question text + body image ───────────────────────────── */}
        <div className="bg-white border border-exam-border rounded-xl p-5">
          <div className="text-exam-text text-base leading-relaxed font-medium font-serif">
            <MathRenderer text={question.text} />
          </div>
          {question.image_url && (
            <img
              src={resolveImageUrl(question.image_url)}
              alt="Question diagram"
              className="mt-4 max-w-full rounded-lg border border-exam-border"
              style={{ maxHeight: '280px', objectFit: 'contain' }}
            />
          )}
        </div>

        {/* ── Answer area ──────────────────────────────────────────── */}
        {question.type === 'numerical' ? (
          <div className="flex flex-col gap-2">
            <label className="text-sm text-exam-muted font-medium">Enter your numerical answer:</label>
            <input
              type="number"
              value={currentAnswer ?? ''}
              onChange={(e) => setAnswer(question.id, e.target.value || null)}
              placeholder="Type your answer here"
              className={clsx(
                'w-48 px-4 py-3 rounded-lg border text-lg font-mono text-exam-text',
                'focus:outline-none focus:ring-2 focus:ring-exam-blue focus:border-exam-blue',
                'border-exam-border bg-white'
              )}
            />
            <p className="text-xs text-exam-muted">Round to 2 decimal places if needed</p>
          </div>

        ) : hasOptionImages ? (
          // ── Diagram options: 2×2 grid ───────────────────────────
          <div className="grid grid-cols-2 gap-3">
            {optionEntries.map(([label, text]) => (
              <MCQImageOption
                key={label}
                label={label}
                text={text}
                imageUrl={question.option_images?.[label]}
                selected={isSelected(label)}
                onSelect={handleOptionSelect}
              />
            ))}
          </div>

        ) : (
          // ── Text options: vertical list ─────────────────────────
          <div className="flex flex-col gap-3">
            {optionEntries.map(([label, text]) => (
              <MCQOption
                key={label}
                label={label}
                text={text}
                selected={isSelected(label)}
                onSelect={handleOptionSelect}
              />
            ))}
          </div>
        )}

        {/* Multi-select hint */}
        {question.type === 'multi_mcq' && (
          <p className="text-xs text-exam-muted text-center">
            Multiple answers may be correct — select all that apply
          </p>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
