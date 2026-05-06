'use client'
/**
 * /admin/questions — Question Bank Management
 *
 * Features:
 *  • Exam selector (create new or pick existing)
 *  • Question list with subject badges, type tags, correct-answer peek
 *  • Full-screen modal editor:
 *      Left  → form (math toolbar, textarea, options A-D, image upload, marks)
 *      Right → live student-view preview (KaTeX rendered, looks exactly like exam)
 *  • Supports: inline math $...$, block math $$...$$, image upload → S3
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import 'katex/dist/katex.min.css'
import MathRenderer from '@/components/admin/MathRenderer'
import {
  listExams, createExam,
  listQuestions, createQuestion, updateQuestion, deleteQuestion,
  uploadQuestionImage,
  uploadExamPdf, getExtractionProgress, listExtractions, retryExtraction,
  goLiveQuestions, deleteExtraction,
  getAdminRole,
} from '@/lib/api/adminClient'

// ── Subject options ──────────────────────────────────────────────────────────
const SUBJECTS = ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'General', 'English']
const QUESTION_TYPES = [
  { value: 'single_mcq', label: 'Single Choice (MCQ)' },
  { value: 'multi_mcq',  label: 'Multi Choice' },
  { value: 'numerical',  label: 'Numerical' },
]

// ── Math toolbar symbols ─────────────────────────────────────────────────────
const MATH_SYMBOLS = [
  // Wrap in $...$  when inserting into plain text
  { label: 'x²',   insert: '^{2}',                     tip: 'Superscript' },
  { label: 'xₙ',   insert: '_{n}',                     tip: 'Subscript' },
  { label: '½',    insert: '\\frac{1}{2}',              tip: 'Fraction' },
  { label: '√',    insert: '\\sqrt{}',                  tip: 'Square root' },
  { label: '∛',    insert: '\\sqrt[3]{}',               tip: 'Cube root' },
  { label: '∫',    insert: '\\int_{a}^{b}',             tip: 'Integral' },
  { label: '∮',    insert: '\\oint',                    tip: 'Contour integral' },
  { label: '∑',    insert: '\\sum_{i=1}^{n}',           tip: 'Summation' },
  { label: '∏',    insert: '\\prod_{i=1}^{n}',          tip: 'Product' },
  { label: 'lim',  insert: '\\lim_{x \\to \\infty}',    tip: 'Limit' },
  { label: 'd/dx', insert: '\\frac{d}{dx}',             tip: 'Derivative' },
  { label: '∂',    insert: '\\partial',                  tip: 'Partial derivative' },
  { label: 'log',  insert: '\\log',                     tip: 'Logarithm' },
  { label: 'ln',   insert: '\\ln',                      tip: 'Natural log' },
  { label: 'sin',  insert: '\\sin',                     tip: 'Sine' },
  { label: 'cos',  insert: '\\cos',                     tip: 'Cosine' },
  { label: 'tan',  insert: '\\tan',                     tip: 'Tangent' },
  { label: 'π',    insert: '\\pi',                      tip: 'Pi' },
  { label: '∞',    insert: '\\infty',                   tip: 'Infinity' },
  { label: 'θ',    insert: '\\theta',                   tip: 'Theta' },
  { label: 'α',    insert: '\\alpha',                   tip: 'Alpha' },
  { label: 'β',    insert: '\\beta',                    tip: 'Beta' },
  { label: 'λ',    insert: '\\lambda',                  tip: 'Lambda' },
  { label: 'μ',    insert: '\\mu',                      tip: 'Mu' },
  { label: 'σ',    insert: '\\sigma',                   tip: 'Sigma (lower)' },
  { label: 'Σ',    insert: '\\Sigma',                   tip: 'Sigma (upper)' },
  { label: 'Δ',    insert: '\\Delta',                   tip: 'Delta' },
  { label: '±',    insert: '\\pm',                      tip: 'Plus-minus' },
  { label: '≤',    insert: '\\leq',                     tip: 'Less than or equal' },
  { label: '≥',    insert: '\\geq',                     tip: 'Greater than or equal' },
  { label: '≠',    insert: '\\neq',                     tip: 'Not equal' },
  { label: '≈',    insert: '\\approx',                  tip: 'Approximately' },
  { label: '→',    insert: '\\to',                      tip: 'Arrow' },
  { label: '⟺',   insert: '\\iff',                     tip: 'If and only if' },
  { label: 'vec',  insert: '\\vec{A}',                  tip: 'Vector' },
  { label: '|x|',  insert: '|x|',                       tip: 'Absolute value' },
  { label: 'mat',  insert: '\\begin{pmatrix} a & b \\\\\\\\ c & d \\end{pmatrix}', tip: '2×2 Matrix' },
  { label: '°',    insert: '^{\\circ}',                 tip: 'Degree' },
  { label: 'Å',    insert: '\\text{Å}',                 tip: 'Angstrom' },
]

// ── Blank question form ──────────────────────────────────────────────────────
const BLANK_FORM = {
  sequence_number: 1,
  question_type: 'single_mcq',
  subject: 'Physics',
  text: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  option_image_a: null,
  option_image_b: null,
  option_image_c: null,
  option_image_d: null,
  correct_answer: 'A',
  marks: 4,
  negative_marks: 1,
  image_url: null,
  solution: '',
}

// ── Colour helpers ───────────────────────────────────────────────────────────
const SUBJECT_COLORS = {
  Physics:     'bg-blue-100 text-blue-800',
  Chemistry:   'bg-green-100 text-green-800',
  Mathematics: 'bg-purple-100 text-purple-800',
  Biology:     'bg-emerald-100 text-emerald-800',
  General:     'bg-gray-100 text-gray-700',
  English:     'bg-yellow-100 text-yellow-800',
}
const TYPE_COLORS = {
  single_mcq: 'bg-indigo-100 text-indigo-700',
  multi_mcq:  'bg-orange-100 text-orange-700',
  numerical:  'bg-pink-100 text-pink-700',
}
const OPTION_LABELS  = ['A', 'B', 'C', 'D']
const OPTION_FIELDS  = ['option_a', 'option_b', 'option_c', 'option_d']
const OPTION_IMG_FIELDS = ['option_image_a', 'option_image_b', 'option_image_c', 'option_image_d']

// ── Insert at textarea cursor ────────────────────────────────────────────────
function insertAtCursor(ref, insert, setVal, currentVal) {
  const el = ref.current
  if (!el) return currentVal + insert

  const start = el.selectionStart ?? currentVal.length
  const end   = el.selectionEnd   ?? currentVal.length
  const before = currentVal.slice(0, start)
  const after  = currentVal.slice(end)
  const newVal = before + insert + after

  setVal(newVal)

  // Restore cursor after the inserted text
  requestAnimationFrame(() => {
    el.focus()
    const cursorPos = start + insert.length
    el.setSelectionRange(cursorPos, cursorPos)
  })
  return newVal
}

// ═══════════════════════════════════════════════════════════════════════════
//  EDITOR MODAL
// ═══════════════════════════════════════════════════════════════════════════
function QuestionEditorModal({ examId, editing, onSave, onClose }) {
  const [form, setForm] = useState(editing
    ? {
        sequence_number: editing.sequence_number,
        question_type:   editing.question_type,
        subject:         editing.subject,
        text:            editing.text || '',
        option_a:        editing.options?.A || '',
        option_b:        editing.options?.B || '',
        option_c:        editing.options?.C || '',
        option_d:        editing.options?.D || '',
        option_image_a:  editing.option_images?.A || null,
        option_image_b:  editing.option_images?.B || null,
        option_image_c:  editing.option_images?.C || null,
        option_image_d:  editing.option_images?.D || null,
        correct_answer:  editing.correct_answer || 'A',
        marks:           editing.marks || 4,
        negative_marks:  editing.negative_marks || 1,
        image_url:       editing.image_url || null,
        solution:        editing.solution || '',
      }
    : { ...BLANK_FORM }
  )

  const [saving,        setSaving]        = useState(false)
  // uploading tracks which field is uploading: 'question' | 'opt_A' | 'opt_B' | etc.
  const [uploading,     setUploading]     = useState(null)
  const [error,         setError]         = useState(null)
  const [activeField,   setActiveField]   = useState('text')
  const [imgPreview,    setImgPreview]    = useState(editing?.image_url || null)

  // Local blob URLs for instant in-browser preview (independent of S3 / upload response).
  // Keys: 'question' | 'opt_A' | 'opt_B' | 'opt_C' | 'opt_D'
  const [localPreviews, setLocalPreviews] = useState(() => {
    const init = {}
    if (editing?.image_url)         init.question = editing.image_url
    if (editing?.option_images?.A)  init.opt_A    = editing.option_images.A
    if (editing?.option_images?.B)  init.opt_B    = editing.option_images.B
    if (editing?.option_images?.C)  init.opt_C    = editing.option_images.C
    if (editing?.option_images?.D)  init.opt_D    = editing.option_images.D
    return init
  })

  // Revoke local blob URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      Object.values(localPreviews).forEach(url => {
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Refs for each textarea (for cursor insertion)
  const textRef  = useRef(null)
  const optRefs  = { A: useRef(null), B: useRef(null), C: useRef(null), D: useRef(null) }
  const solRef   = useRef(null)

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  // ── Math symbol insertion ─────────────────────────────────────────────
  function insertSymbol(symbol) {
    // Wrap in $...$ if inserting into a plain-text field
    const toInsert = `$${symbol}$`

    if (activeField === 'text') {
      insertAtCursor(textRef, toInsert, (v) => set('text', v), form.text)
    } else if (activeField === 'solution') {
      insertAtCursor(solRef, toInsert, (v) => set('solution', v), form.solution)
    } else if (activeField.startsWith('opt_')) {
      const key = activeField.split('_')[1] // A/B/C/D
      const field = `option_${key.toLowerCase()}`
      insertAtCursor(optRefs[key], toInsert, (v) => set(field, v), form[field])
    }
  }

  // Wrap selected text in $...$
  function wrapInMath(ref, getVal, setVal) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end   = el.selectionEnd
    const val   = getVal()
    if (start === end) {
      // No selection → insert $|$ with cursor inside
      insertAtCursor(ref, '$$', setVal, val)
    } else {
      const selected = val.slice(start, end)
      const newVal   = val.slice(0, start) + `$${selected}$` + val.slice(end)
      setVal(newVal)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start + 1, start + 1 + selected.length)
      })
    }
  }

  // ── Image upload — handles question body image AND per-option images ─────
  async function handleImageUpload(e, target = 'question') {
    // target: 'question' | 'opt_A' | 'opt_B' | 'opt_C' | 'opt_D'
    const file = e.target.files?.[0]
    if (!file) return

    // ── Step 1: Create a local blob URL for INSTANT in-browser preview ──
    // This shows the image immediately, regardless of whether S3 upload
    // succeeds or the presigned URL is accessible from the browser.
    const blobUrl = URL.createObjectURL(file)
    setLocalPreviews(prev => ({ ...prev, [target]: blobUrl }))
    if (target === 'question') setImgPreview(blobUrl)

    setUploading(target)
    setError(null)

    // ── Step 2: Upload to S3 in background; store the server URL in form ──
    // The server URL is what gets saved to the DB (permanent reference).
    // The blob URL is only for local display during the editing session.
    try {
      const { data } = await uploadQuestionImage(file)
      if (target === 'question') {
        set('image_url', data.url)
        // Update preview to server URL only if it's a real URL (not data:)
        // For S3 presigned URLs, keep the blob URL for reliable display
        if (!data.url.startsWith('data:')) {
          // Keep blob URL for display; server URL is stored for DB save
        } else {
          // Dev mode returned a data URL — safe to use directly
          setLocalPreviews(prev => ({ ...prev, [target]: data.url }))
          if (target === 'question') setImgPreview(data.url)
        }
      } else {
        const optLetter = target.split('_')[1]   // 'A' / 'B' / 'C' / 'D'
        set(`option_image_${optLetter.toLowerCase()}`, data.url)
        if (!data.url.startsWith('data:')) {
          // Keep blob URL for in-session display; DB stores the S3 URL
        } else {
          setLocalPreviews(prev => ({ ...prev, [target]: data.url }))
        }
      }
    } catch (err) {
      // Upload failed — clear the blob preview and the form value
      setLocalPreviews(prev => { const n = {...prev}; delete n[target]; return n })
      if (target === 'question') { set('image_url', null); setImgPreview(null) }
      else {
        const optLetter = target.split('_')[1]
        set(`option_image_${optLetter.toLowerCase()}`, null)
      }
      setError('Image upload failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUploading(null)
    }
  }

  function removeOptionImage(label) {
    const target = `opt_${label}`
    setLocalPreviews(prev => {
      const next = { ...prev }
      if (next[target]?.startsWith('blob:')) URL.revokeObjectURL(next[target])
      delete next[target]
      return next
    })
    set(`option_image_${label.toLowerCase()}`, null)
  }

  function removeQuestionImage() {
    if (localPreviews.question?.startsWith('blob:')) URL.revokeObjectURL(localPreviews.question)
    setLocalPreviews(prev => { const n = {...prev}; delete n.question; return n })
    set('image_url', null)
    setImgPreview(null)
  }

  // ── Save ─────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.text.trim()) { setError('Question text is required.'); return }
    if (form.question_type !== 'numerical') {
      // An option is valid if it has TEXT or an IMAGE (diagram options need no text)
      const optFilled = (i) =>
        form[OPTION_FIELDS[i]]?.trim() ||           // has text
        form[OPTION_IMG_FIELDS[i]] ||               // has server-uploaded URL
        localPreviews[`opt_${OPTION_LABELS[i]}`]    // has local blob (upload in progress)
      const missing = OPTION_LABELS.filter((_, i) => !optFilled(i))
      if (missing.length > 0) {
        setError(`Option${missing.length > 1 ? 's' : ''} ${missing.join(', ')} need${missing.length === 1 ? 's' : ''} text or an image.`)
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await updateQuestion(editing.id, form)
      } else {
        await createQuestion(examId, form)
      }
      onSave()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Preview: student view ─────────────────────────────────────────────
  const StudentPreview = () => (
    <div className="bg-white rounded-xl border border-gray-200 shadow-inner p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SUBJECT_COLORS[form.subject] || 'bg-gray-100 text-gray-700'}`}>
          {form.subject}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[form.question_type] || ''}`}>
          {QUESTION_TYPES.find(t => t.value === form.question_type)?.label}
        </span>
        <span className="ml-auto text-xs text-gray-500">
          +{form.marks} / −{form.negative_marks}
        </span>
      </div>

      {/* Question number */}
      <p className="text-xs font-bold text-gray-400 mb-2">
        Q. {form.sequence_number}
      </p>

      {/* Question text */}
      <div className="text-gray-900 text-base leading-relaxed mb-4 font-serif">
        {form.text
          ? <MathRenderer text={form.text} />
          : <span className="text-gray-300 italic">Question text will appear here…</span>
        }
      </div>

      {/* Question image */}
      {(localPreviews.question || imgPreview) && (
        <div className="mb-4">
          <img
            src={localPreviews.question || imgPreview}
            alt="Question diagram"
            className="max-w-full max-h-48 rounded-lg border border-gray-200"
          />
        </div>
      )}

      {/* Options */}
      {form.question_type !== 'numerical' && (() => {
        // Use localPreviews first (blob URL), fall back to form URL (S3 presigned)
        const getOptImg = (label) => localPreviews[`opt_${label}`] || form[OPTION_IMG_FIELDS[OPTION_LABELS.indexOf(label)]]
        // Check if ANY option has an image → use grid layout like the PDF example
        const anyOptHasImage = OPTION_LABELS.some(lbl => getOptImg(lbl))

        if (anyOptHasImage) {
          // ── Grid layout (2×2) when options are images — matches the PDF style ──
          return (
            <div className="grid grid-cols-2 gap-3 mt-4">
              {OPTION_LABELS.map((label, i) => {
                const text      = form[OPTION_FIELDS[i]]
                const imgUrl    = getOptImg(label)
                const isCorrect = form.correct_answer === label
                return (
                  <div
                    key={label}
                    className={`flex flex-col rounded-xl border-2 overflow-hidden transition-colors ${
                      isCorrect ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    {/* Label row */}
                    <div className={`flex items-center gap-2 px-3 py-2 border-b ${
                      isCorrect ? 'border-green-200 bg-green-100' : 'border-gray-100 bg-gray-50'
                    }`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                        isCorrect ? 'border-green-500 text-green-700 bg-white' : 'border-gray-300 text-gray-600'
                      }`}>
                        {label}
                      </span>
                      {isCorrect && <span className="text-green-600 text-xs font-semibold">✓ Correct</span>}
                    </div>
                    {/* Image */}
                    {imgUrl ? (
                      <div className="flex items-center justify-center p-3 min-h-[100px] bg-white">
                        <img
                          src={imgUrl}
                          alt={`Option ${label}`}
                          className="max-h-28 max-w-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center p-3 min-h-[60px] text-gray-300 italic text-xs">
                        No image
                      </div>
                    )}
                    {/* Caption (if any) */}
                    {text && (
                      <div className="px-3 pb-2 text-xs text-gray-600 text-center font-serif">
                        <MathRenderer text={text} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        }

        // ── Standard list layout when options are text ─────────────────────
        return (
          <div className="space-y-2 mt-4">
            {OPTION_LABELS.map((label, i) => {
              const text = form[OPTION_FIELDS[i]]
              const isCorrect = form.correct_answer === label
              return (
                <div
                  key={label}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                    isCorrect
                      ? 'border-green-400 bg-green-50'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
                    isCorrect ? 'border-green-500 text-green-700 bg-green-100' : 'border-gray-300 text-gray-600'
                  }`}>
                    {label}
                  </span>
                  <span className="text-gray-800 text-sm leading-relaxed pt-0.5 font-serif">
                    {text
                      ? <MathRenderer text={text} />
                      : <span className="text-gray-300 italic">Option {label}…</span>
                    }
                  </span>
                  {isCorrect && (
                    <span className="ml-auto text-green-600 text-xs font-semibold flex-shrink-0">✓ Correct</span>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Numerical answer */}
      {form.question_type === 'numerical' && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-xs text-blue-600 font-semibold mb-1">NUMERICAL ANSWER</p>
          <p className="text-sm text-gray-700">
            Correct answer: <span className="font-bold text-blue-800">{form.correct_answer || '—'}</span>
          </p>
        </div>
      )}

      {/* Solution (admin only) */}
      {form.solution && (
        <div className="mt-5 pt-4 border-t border-dashed border-gray-200">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Solution</p>
          <div className="text-sm text-gray-700 font-serif leading-relaxed">
            <MathRenderer text={form.solution} />
          </div>
        </div>
      )}

      {/* Hint */}
      <p className="mt-6 text-xs text-center text-gray-300 italic">
        ↑ This is exactly how students will see this question
      </p>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/80 backdrop-blur-sm">
      {/* Modal shell */}
      <div className="flex flex-col flex-1 m-4 bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[calc(100vh-2rem)]">

        {/* ── Top bar ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xl">📝</span>
            <h2 className="font-bold text-gray-800 text-lg">
              {editing ? `Edit Q.${editing.sequence_number}` : 'New Question'}
            </h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
              Use $…$ for inline math · $$…$$ for block math
            </span>
          </div>
          <div className="flex items-center gap-3">
            {error && (
              <span className="text-red-600 text-sm bg-red-50 border border-red-200 px-3 py-1 rounded-lg">
                {error}
              </span>
            )}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none px-2"
            >×</button>
          </div>
        </div>

        {/* ── Body: editor left / preview right ────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ════════ LEFT: EDITOR ════════ */}
          <div className="w-1/2 flex flex-col border-r border-gray-200 overflow-y-auto bg-white">

            {/* Math toolbar */}
            <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500 font-semibold mb-2 uppercase tracking-wide">
                Math toolbar — click to insert at cursor
              </p>
              <div className="flex flex-wrap gap-1">
                {MATH_SYMBOLS.map(({ label, insert, tip }) => (
                  <button
                    key={label}
                    title={tip}
                    onClick={() => insertSymbol(insert)}
                    className="px-2 py-1 text-xs font-mono bg-white border border-gray-300 rounded hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Form */}
            <div className="flex-1 p-4 space-y-4">

              {/* Row: seq# / subject / type */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label-sm">Q. Number</label>
                  <input
                    type="number" min="1" max="200"
                    value={form.sequence_number}
                    onChange={e => set('sequence_number', parseInt(e.target.value) || 1)}
                    className="input-sm"
                  />
                </div>
                <div>
                  <label className="label-sm">Subject</label>
                  <select value={form.subject} onChange={e => set('subject', e.target.value)} className="input-sm">
                    {SUBJECTS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-sm">Type</label>
                  <select value={form.question_type} onChange={e => set('question_type', e.target.value)} className="input-sm">
                    {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Row: marks */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-sm">Correct marks (+)</label>
                  <input type="number" min="0" step="0.5" value={form.marks}
                    onChange={e => set('marks', parseFloat(e.target.value) || 0)}
                    className="input-sm" />
                </div>
                <div>
                  <label className="label-sm">Negative marks (−)</label>
                  <input type="number" min="0" step="0.25" value={form.negative_marks}
                    onChange={e => set('negative_marks', parseFloat(e.target.value) || 0)}
                    className="input-sm" />
                </div>
              </div>

              {/* Question text */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label-sm">Question Text</label>
                  <button
                    onClick={() => wrapInMath(textRef, () => form.text, v => set('text', v))}
                    className="text-xs text-indigo-600 hover:underline"
                    title="Wrap selected text in $...$"
                  >
                    Wrap $ math $
                  </button>
                </div>
                <textarea
                  ref={textRef}
                  value={form.text}
                  onChange={e => set('text', e.target.value)}
                  onFocus={() => setActiveField('text')}
                  rows={5}
                  placeholder="Type question here. Use $...$ for inline math, $$...$$ for block math."
                  className="input-textarea"
                />
              </div>

              {/* Question-level image upload */}
              <div>
                <label className="label-sm">Question Image (optional — diagram/figure in the question)</label>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className={`cursor-pointer flex items-center gap-2 px-3 py-2 bg-white border border-dashed border-gray-300 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-sm text-gray-600 ${!!uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <span>📷</span>
                    <span>{uploading === 'question' ? 'Uploading…' : localPreviews.question ? 'Change image' : 'Upload question image'}</span>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => handleImageUpload(e, 'question')}
                      disabled={!!uploading} />
                  </label>
                  {localPreviews.question && (
                    <div className="flex items-center gap-2">
                      <img src={localPreviews.question} alt="Question image" className="h-12 w-auto max-w-[120px] object-contain rounded border border-gray-200 bg-white" />
                      <button onClick={removeQuestionImage} className="text-red-500 text-xs hover:underline">Remove</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Options A-D (MCQ) — each option can have text, math AND/OR an image */}
              {form.question_type !== 'numerical' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label-sm">Options</label>
                    <span className="text-xs text-gray-400">Each option can have text, math, or an image (or all three)</span>
                  </div>
                  <div className="space-y-3">
                    {OPTION_LABELS.map((label, i) => {
                      const field      = OPTION_FIELDS[i]
                      const isCorrect  = form.correct_answer === label
                      // Use local blob URL for display (always works); form stores the server URL (for DB save)
                      const optImgUrl  = localPreviews[`opt_${label}`] || form[OPTION_IMG_FIELDS[i]]
                      const isUploading = uploading === `opt_${label}`

                      return (
                        <div key={label} className={`rounded-xl border-2 transition-colors ${
                          isCorrect ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
                        }`}>
                          {/* Option header */}
                          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                            <button
                              onClick={() => set('correct_answer', label)}
                              title={`Mark ${label} as correct answer`}
                              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                                isCorrect
                                  ? 'border-green-500 bg-green-500 text-white shadow-sm'
                                  : 'border-gray-300 text-gray-600 hover:border-green-400 hover:bg-green-50'
                              }`}
                            >
                              {label}
                            </button>
                            {isCorrect && (
                              <span className="text-xs text-green-600 font-semibold">✓ Correct answer</span>
                            )}
                            <div className="ml-auto flex items-center gap-2">
                              {/* Option image upload button */}
                              <label className={`cursor-pointer flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs transition-colors ${
                                optImgUrl
                                  ? 'border-blue-300 bg-blue-50 text-blue-600'
                                  : 'border-dashed border-gray-300 text-gray-500 hover:border-indigo-400 hover:bg-indigo-50'
                              } ${!!uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                <span>📷</span>
                                <span>{isUploading ? 'Uploading…' : optImgUrl ? 'Change image' : 'Add image'}</span>
                                <input
                                  type="file" accept="image/*" className="hidden"
                                  onChange={e => handleImageUpload(e, `opt_${label}`)}
                                  disabled={!!uploading}
                                />
                              </label>
                              {optImgUrl && (
                                <button
                                  onClick={() => removeOptionImage(label)}
                                  className="text-red-400 hover:text-red-600 text-xs px-1"
                                  title="Remove option image"
                                >✕</button>
                              )}
                            </div>
                          </div>

                          {/* Option text textarea */}
                          <div className="px-3 pb-1">
                            <textarea
                              ref={optRefs[label]}
                              value={form[field]}
                              onChange={e => set(field, e.target.value)}
                              onFocus={() => setActiveField(`opt_${label}`)}
                              rows={2}
                              placeholder={optImgUrl
                                ? `Caption or label for option ${label} (optional)`
                                : `Option ${label} text — supports $math$ notation`
                              }
                              className="w-full text-sm border-0 bg-transparent resize-none focus:outline-none focus:ring-0 font-mono text-gray-700 placeholder-gray-300"
                            />
                          </div>

                          {/* Option image preview */}
                          {optImgUrl && (
                            <div className="px-3 pb-3">
                              <img
                                src={optImgUrl}
                                alt={`Option ${label}`}
                                className="max-h-32 max-w-full rounded-lg border border-gray-200 object-contain bg-white"
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    💡 Click the circle button (A/B/C/D) to mark the correct answer.
                    Use the 📷 button to add a diagram as an option (like Venn diagrams, graphs, etc.)
                  </p>
                </div>
              )}

              {/* Numerical answer */}
              {form.question_type === 'numerical' && (
                <div>
                  <label className="label-sm">Correct Numerical Answer</label>
                  <input
                    type="text"
                    value={form.correct_answer}
                    onChange={e => set('correct_answer', e.target.value)}
                    placeholder="e.g. 42 or 3.14"
                    className="input-sm"
                  />
                </div>
              )}

              {/* Solution */}
              <div>
                <label className="label-sm">Solution / Explanation (optional)</label>
                <textarea
                  ref={solRef}
                  value={form.solution}
                  onChange={e => set('solution', e.target.value)}
                  onFocus={() => setActiveField('solution')}
                  rows={3}
                  placeholder="Step-by-step solution. Supports $...$ math."
                  className="input-textarea"
                />
              </div>

            </div>

            {/* Save bar */}
            <div className="flex-shrink-0 flex items-center justify-end gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow disabled:opacity-60 transition-colors"
              >
                {saving ? 'Saving…' : editing ? 'Update Question' : 'Save Question'}
              </button>
            </div>
          </div>

          {/* ════════ RIGHT: LIVE PREVIEW ════════ */}
          <div className="w-1/2 flex flex-col bg-slate-50 overflow-hidden">
            <div className="flex-shrink-0 flex items-center gap-2 px-5 py-3 bg-slate-100 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-600">👁 Student Preview</span>
              <span className="text-xs text-slate-400">(live • updates as you type)</span>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <StudentPreview />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
//  CREATE EXAM MODAL
// ═══════════════════════════════════════════════════════════════════════════
function CreateExamModal({ onCreated, onClose }) {
  const [form, setForm] = useState({
    title: '', description: '', total_questions: 90,
    duration_minutes: 180, positive_marks: 4, negative_marks: 1,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreate() {
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError(null)
    try {
      const { data } = await createExam(form)
      onCreated(data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg">
        <h2 className="text-xl font-bold text-gray-800 mb-6">Create New Exam</h2>
        <div className="space-y-4">
          <div>
            <label className="label-sm">Exam Title *</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. DAT 2026 — Physics" className="input-sm" />
          </div>
          <div>
            <label className="label-sm">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2} className="input-textarea" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-sm">Total Questions</label>
              <input type="number" value={form.total_questions}
                onChange={e => setForm(f => ({ ...f, total_questions: parseInt(e.target.value) || 90 }))}
                className="input-sm" />
            </div>
            <div>
              <label className="label-sm">Duration (minutes)</label>
              <input type="number" value={form.duration_minutes}
                onChange={e => setForm(f => ({ ...f, duration_minutes: parseInt(e.target.value) || 180 }))}
                className="input-sm" />
            </div>
            <div>
              <label className="label-sm">Marks (+)</label>
              <input type="number" step="0.5" value={form.positive_marks}
                onChange={e => setForm(f => ({ ...f, positive_marks: parseFloat(e.target.value) || 4 }))}
                className="input-sm" />
            </div>
            <div>
              <label className="label-sm">Negative marks (−)</label>
              <input type="number" step="0.25" value={form.negative_marks}
                onChange={e => setForm(f => ({ ...f, negative_marks: parseFloat(e.target.value) || 1 }))}
                className="input-sm" />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button onClick={handleCreate} disabled={saving}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow disabled:opacity-60">
            {saving ? 'Creating…' : 'Create Exam'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
//  UPLOAD EXAM PDF MODAL — AI question extraction
// ═══════════════════════════════════════════════════════════════════════════
function UploadPdfModal({ onClose, onFinishedExtraction }) {
  const [file, setFile]               = useState(null)
  const [title, setTitle]             = useState('')
  const [expected, setExpected]       = useState(100)
  const [uploading, setUploading]     = useState(false)
  const [uploadPercent, setUploadPct] = useState(0)
  const [extractionId, setExtractionId] = useState(null)
  const [progress, setProgress]       = useState(null)   // {status, progress_percent, ...}
  const [error, setError]             = useState(null)
  const pollRef = useRef(null)

  function handleFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setError('File must be a .pdf')
      return
    }
    if (f.size > 50 * 1024 * 1024) {
      setError('PDF exceeds 50MB limit')
      return
    }
    setFile(f)
    setError(null)
    if (!title.trim()) setTitle(f.name.replace(/\.pdf$/i, ''))
  }

  async function startUpload() {
    if (!file)         { setError('Choose a PDF first'); return }
    if (!title.trim()) { setError('Title is required');  return }
    setUploading(true)
    setError(null)
    setUploadPct(0)
    console.log('[UploadPdfModal] Starting upload:', { file: file.name, size: file.size, title: title.trim(), expected })
    try {
      const { data } = await uploadExamPdf(file, title.trim(), expected, (e) => {
        if (e.total) setUploadPct(Math.round((e.loaded / e.total) * 100))
      })
      console.log('[UploadPdfModal] Upload response from backend:', data)
      setExtractionId(data.extraction_id)
      setProgress({
        status: data.status,
        progress_percent: 0,
        progress_message: data.message || 'Queued',
        extracted_count: 0,
        flagged_count: 0,
        expected_questions: expected,
      })
    } catch (err) {
      console.error('[UploadPdfModal] Upload FAILED:', err.response?.data || err.message, err)
      setError(err.response?.data?.detail || err.message || 'Upload failed')
      setUploading(false)
    }
  }

  // Poll progress every 3s once we have an extraction_id
  useEffect(() => {
    if (!extractionId) return
    console.log('[UploadPdfModal] Starting progress polling — extraction_id:', extractionId)
    let stop = false
    let pollCount = 0
    async function tick() {
      pollCount++
      try {
        const { data } = await getExtractionProgress(extractionId)
        if (stop) return
        console.log(`[UploadPdfModal] Poll #${pollCount} — extraction_id=${extractionId}`, {
          status: data.status,
          progress_percent: data.progress_percent,
          progress_message: data.progress_message,
          extracted_count: data.extracted_count,
          flagged_count: data.flagged_count,
          error_message: data.error_message,
        })
        setProgress(data)
        if (data.status === 'pending_review' || data.status === 'finalized') {
          console.log('[UploadPdfModal] Extraction COMPLETE — stopping poll. Status:', data.status)
          if (pollRef.current) clearInterval(pollRef.current)
          onFinishedExtraction?.(extractionId)
        } else if (data.status === 'failed') {
          console.error('[UploadPdfModal] Extraction FAILED — stopping poll. Error:', data.error_message)
          if (pollRef.current) clearInterval(pollRef.current)
          setError(data.error_message || 'Extraction failed')
        } else if (data.progress_message?.includes('No Celery worker')) {
          console.warn('[UploadPdfModal] WARNING: No Celery worker running!', data.progress_message)
        }
      } catch (err) {
        console.error(`[UploadPdfModal] Poll #${pollCount} HTTP error:`, err.message, err)
        if (!stop) setError(err.message)
      }
    }
    tick()
    pollRef.current = setInterval(tick, 3000)
    return () => { stop = true; if (pollRef.current) clearInterval(pollRef.current) }
  }, [extractionId])  // eslint-disable-line

  const isDone       = progress?.status === 'pending_review' || progress?.status === 'finalized'
  const isFailed     = progress?.status === 'failed' || !!error
  const isRunning    = !!extractionId && !isDone && !isFailed
  const noWorker     = false  // ping() removed — worker always auto-starts with container
  // "stuck" = queued or uploaded with 0% after upload finished
  const isStuck      = isRunning && (progress?.status === 'uploaded') && !uploading
  const [retrying, setRetrying] = useState(false)

  async function handleRetry() {
    if (!extractionId) return
    setRetrying(true)
    setError(null)
    try {
      const { data } = await retryExtraction(extractionId)
      setProgress(data)
      // Restart polling
      if (pollRef.current) clearInterval(pollRef.current)
    } catch (e) {
      setError(e.response?.data?.detail || 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span>📄</span> Upload Exam PDF — AI Extraction
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {!extractionId && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Upload a question paper PDF. The system will use AWS Textract + Gemini Vision
              to extract questions, options and the answer key, then send them to the review queue.
            </p>

            <div>
              <label className="label-sm">PDF File *</label>
              <label className={`flex items-center justify-center gap-2 px-4 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                file ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
              }`}>
                <span className="text-2xl">{file ? '✅' : '⬆️'}</span>
                <span className="text-sm">
                  {file
                    ? <><span className="font-semibold text-green-700">{file.name}</span> <span className="text-gray-500">({(file.size / 1024 / 1024).toFixed(1)} MB)</span></>
                    : <>Click to choose a PDF (max 50 MB)</>
                  }
                </span>
                <input type="file" accept="application/pdf" className="hidden" onChange={handleFile} />
              </label>
            </div>

            <div>
              <label className="label-sm">Exam Title *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. DAT 2026 — Mock 1"
                className="input-sm"
              />
            </div>

            <div>
              <label className="label-sm">Expected Question Count</label>
              <input
                type="number" min="1" max="500"
                value={expected}
                onChange={e => setExpected(parseInt(e.target.value) || 100)}
                className="input-sm"
              />
            </div>

            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button
                onClick={startUpload}
                disabled={uploading || !file}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow disabled:opacity-60"
              >
                {uploading ? `Uploading ${uploadPercent}%…` : 'Upload & Extract'}
              </button>
            </div>
          </div>
        )}

        {extractionId && (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                  Extraction #{extractionId}
                </p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  isFailed ? 'bg-red-100 text-red-700' :
                  isDone   ? 'bg-green-100 text-green-700' :
                             'bg-blue-100 text-blue-700'
                }`}>
                  {(progress?.status || 'processing').toUpperCase()}
                </span>
              </div>

              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-3 transition-all duration-500 ${
                    isFailed ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${progress?.progress_percent || 0}%` }}
                />
              </div>

              <p className="text-sm text-gray-700 mt-3">
                {progress?.progress_message || 'Waiting for worker…'}
              </p>

              {/* No-worker warning */}
              {noWorker && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  <p className="font-bold mb-1">⚠ Celery worker not detected</p>
                  <p className="mt-1 text-amber-600">Task is queued. The worker auto-starts with the container — if extraction does not begin within 30 seconds, check server logs and click Retry below.</p>
                </div>
              )}

              {/* Retry button — shown when stuck at 0% */}
              {isStuck && (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={handleRetry}
                    disabled={retrying}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {retrying ? (
                      <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> Retrying…</>
                    ) : (
                      <>↺ Retry Extraction</>
                    )}
                  </button>
                  <span className="text-xs text-gray-400">Task may be stuck — retry re-queues it</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                <div className="bg-white rounded-lg p-2 border border-gray-100">
                  <p className="text-xs text-gray-500">Extracted</p>
                  <p className="text-lg font-bold text-gray-800">{progress?.extracted_count ?? 0}</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-gray-100">
                  <p className="text-xs text-gray-500">Flagged</p>
                  <p className="text-lg font-bold text-amber-600">{progress?.flagged_count ?? 0}</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-gray-100">
                  <p className="text-xs text-gray-500">Expected</p>
                  <p className="text-lg font-bold text-gray-400">{progress?.expected_questions ?? expected}</p>
                </div>
              </div>
            </div>

            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{error}</p>}

            {isRunning && (
              <p className="text-xs text-gray-400 italic text-center">
                Extraction usually takes 2–5 minutes. You can close this dialog —
                progress is saved server-side and visible in the extractions list.
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose}
                className="px-5 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                {isDone ? 'Done' : 'Close (keep running)'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
//  GO LIVE MODAL
// ═══════════════════════════════════════════════════════════════════════════
function GoLiveModal({ extraction, exams, onClose, onSuccess }) {
  const [targetExamId,    setTargetExamId]    = useState(exams[0]?.id ?? '')
  const [replaceExisting, setReplaceExisting] = useState(true)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [success,         setSuccess]         = useState(null)

  const noExams = exams.length === 0

  async function handleGoLive() {
    if (!targetExamId) { setError('Select an exam first'); return }
    setLoading(true)
    setError(null)
    try {
      const { data } = await goLiveQuestions(targetExamId, extraction.id, replaceExisting)
      const count = data.questions_published ?? data.published ?? '?'
      setSuccess(`${count} questions published successfully!`)
      setTimeout(() => onSuccess(), 1800)
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Go Live failed')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🚀</span>
              <div>
                <h2 className="text-xl font-bold text-white">Publish to Exam</h2>
                <p className="text-emerald-100 text-sm">Make this paper live for candidates</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none">×</button>
          </div>
        </div>

        <div className="p-8">
          {/* Extraction info */}
          <div className="bg-gray-50 rounded-2xl p-4 mb-6 border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-lg">📄</div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">#{extraction.id} — {extraction.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className="text-emerald-600 font-medium">{extraction.extracted_count} questions</span> ready to publish
                  {extraction.flagged_count > 0 && (
                    <span className="text-amber-500 ml-2">· {extraction.flagged_count} flagged for review</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {noExams ? (
            <div className="text-center py-6">
              <p className="text-4xl mb-3">🏫</p>
              <p className="text-gray-700 font-semibold text-base mb-2">No exams exist yet</p>
              <p className="text-gray-500 text-sm mb-5">
                You need to create an exam before you can publish questions to it.
                Close this dialog and click <strong>+ New Exam</strong> in the toolbar above.
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl"
              >
                Go Create an Exam First
              </button>
            </div>
          ) : success ? (
            <div className="text-center py-8">
              <p className="text-5xl mb-3">✅</p>
              <p className="text-emerald-700 font-bold text-lg">{success}</p>
              <p className="text-gray-400 text-sm mt-1">Closing…</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Target Exam *</label>
                <select
                  value={targetExamId}
                  onChange={e => setTargetExamId(Number(e.target.value))}
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-800 focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none bg-white"
                >
                  {exams.map(ex => (
                    <option key={ex.id} value={ex.id}>
                      #{ex.id} — {ex.title}  ({ex.status?.toUpperCase()})
                    </option>
                  ))}
                </select>
                {exams.find(e => e.id === targetExamId) && (
                  <p className="text-xs text-gray-400 mt-1.5 pl-1">
                    Currently has {exams.find(e => e.id === targetExamId)?.question_count ?? 0} questions
                    · status: <span className="font-medium">{exams.find(e => e.id === targetExamId)?.status}</span>
                  </p>
                )}
              </div>

              <label className="flex items-start gap-3 cursor-pointer bg-amber-50 border border-amber-200 rounded-xl p-4">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={e => setReplaceExisting(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-emerald-600"
                />
                <span className="text-sm text-gray-700">
                  <span className="font-semibold">Replace existing questions</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {replaceExisting
                      ? '⚠️ All current questions in the target exam will be removed and replaced.'
                      : '➕ Extracted questions will be appended without removing existing ones.'}
                  </span>
                </span>
              </label>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                  ⚠️ {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGoLive}
                  disabled={loading}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 transition-all"
                >
                  {loading ? <span className="animate-spin text-lg">⏳</span> : <span>🚀</span>}
                  {loading ? 'Publishing…' : `Publish ${extraction.extracted_count} Questions`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  DELETE EXTRACTION MODAL
// ═══════════════════════════════════════════════════════════════════════════
function DeleteExtractionModal({ extraction, onClose, onDeleted }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)
    try {
      await deleteExtraction(extraction.id)
      onDeleted()
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Delete failed')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-r from-red-500 to-rose-600 px-8 py-6 text-center">
          <p className="text-5xl mb-2">🗑️</p>
          <h2 className="text-xl font-bold text-white">Delete Extraction?</h2>
          <p className="text-red-100 text-sm mt-1">This action is permanent and cannot be undone</p>
        </div>
        <div className="p-8 text-center">
          <div className="bg-slate-50 rounded-2xl p-4 mb-6 border border-slate-100">
            <p className="font-semibold text-slate-800">#{extraction.id} — {extraction.title}</p>
            <p className="text-sm text-slate-500 mt-1">
              {extraction.extracted_count || 0} extracted questions will be permanently removed
            </p>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">
              ⚠️ {error}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 border-2 border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={loading}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 transition-all"
            >
              {loading ? 'Deleting…' : 'Yes, Delete Forever'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════
export default function QuestionsPage() {
  const router = useRouter()

  // Auth guard (question_manager only)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('rgipt-admin-token')
    const role  = getAdminRole()
    if (!token) {
      router.replace('/admin/login')
      return
    }
    // exam_controller should be on /admin (monitoring), not here
    if (role && role !== 'question_manager') {
      router.replace('/admin')
    }
  }, [router])

  const [exams,        setExams]        = useState([])
  const [selectedExam, setSelectedExam] = useState(null)
  const [questions,    setQuestions]    = useState([])
  const [loading,      setLoading]      = useState(false)
  const [editing,      setEditing]      = useState(null)       // question object or null
  const [showEditor,   setShowEditor]   = useState(false)
  const [showNewExam,  setShowNewExam]  = useState(false)
  const [showUpload,   setShowUpload]   = useState(false)
  const [extractions,  setExtractions]  = useState([])
  const [deleteConfirm, setDeleteConfirm] = useState(null)     // question id to confirm
  const [goLiveEx,     setGoLiveEx]     = useState(null)       // extraction to go-live
  const [delExConfirm, setDelExConfirm] = useState(null)       // extraction to delete
  const [search,       setSearch]       = useState('')
  const [filterSubj,   setFilterSubj]   = useState('All')

  // Load exams on mount
  useEffect(() => {
    listExams()
      .then(({ data }) => {
        setExams(data)
        if (data.length > 0) setSelectedExam(data[0])
      })
      .catch(console.error)
    // Also load any in-flight or recent extractions so admin can see status
    listExtractions().then(({ data }) => setExtractions(data || [])).catch(() => {})
  }, [])

  function refreshExtractions() {
    listExtractions().then(({ data }) => setExtractions(data || [])).catch(() => {})
  }

  // Load questions when exam changes
  useEffect(() => {
    if (!selectedExam) return
    setLoading(true)
    listQuestions(selectedExam.id)
      .then(({ data }) => setQuestions(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedExam])

  // Refresh question list
  const refresh = useCallback(() => {
    if (!selectedExam) return
    listQuestions(selectedExam.id).then(({ data }) => setQuestions(data))
  }, [selectedExam])

  // Navigate to exam controller (admin) to start the exam
  function handleGoToController() {
    router.push('/admin')
  }

  // Delete
  async function handleDelete(id) {
    await deleteQuestion(id)
    setDeleteConfirm(null)
    refresh()
  }

  // Filtered questions
  const filtered = questions.filter(q => {
    const matchSearch = !search || q.text.toLowerCase().includes(search.toLowerCase())
    const matchSubj   = filterSubj === 'All' || q.subject === filterSubj
    return matchSearch && matchSubj
  })

  // Subject list for filter
  const usedSubjects = ['All', ...new Set(questions.map(q => q.subject))]

  // Next sequence number
  const nextSeq = questions.length > 0
    ? Math.max(...questions.map(q => q.sequence_number)) + 1
    : 1

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-8 py-5 flex items-center gap-5">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm font-medium transition-colors group"
          >
            <span className="text-lg group-hover:-translate-x-0.5 transition-transform">←</span>
            Dashboard
          </button>
          <div className="w-px h-6 bg-slate-200" />
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-lg">📚</div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">Question Bank</h1>
              <p className="text-xs text-slate-400">Manage exam questions &amp; papers</p>
            </div>
          </div>

          <div className="ml-auto" style={{display:'flex', alignItems:'center', gap:'12px'}}>
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              style={{display:'inline-flex', alignItems:'center', gap:'8px', padding:'10px 20px', background:'#4f46e5', color:'#fff', fontSize:'14px', fontWeight:600, borderRadius:'12px', border:'none', cursor:'pointer', whiteSpace:'nowrap'}}
            >
              📄 Upload PDF &amp; Extract
            </button>
            <button
              type="button"
              onClick={() => setShowNewExam(true)}
              style={{display:'inline-flex', alignItems:'center', gap:'8px', padding:'10px 20px', background:'#eef2ff', color:'#4338ca', fontSize:'14px', fontWeight:600, borderRadius:'12px', border:'2px solid #c7d2fe', cursor:'pointer', whiteSpace:'nowrap'}}
            >
              + New Exam
            </button>
            <div style={{width:'1px', height:'24px', background:'#e2e8f0'}} />
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem('rgipt-admin-token')
                localStorage.removeItem('rgipt-admin-email')
                localStorage.removeItem('rgipt-admin-role')
                router.push('/admin/login')
              }}
              style={{display:'inline-flex', alignItems:'center', gap:'6px', padding:'8px 16px', background:'#fff', color:'#64748b', fontSize:'13px', fontWeight:600, borderRadius:'10px', border:'1px solid #e2e8f0', cursor:'pointer', whiteSpace:'nowrap'}}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-8 py-8 space-y-8">

        {/* ── Exam selector card ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Active Exam</label>
              <select
                value={selectedExam?.id || ''}
                onChange={e => {
                  const exam = exams.find(ex => ex.id === parseInt(e.target.value))
                  setSelectedExam(exam || null)
                }}
                className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base font-medium text-slate-800 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none bg-white"
              >
                {exams.map(ex => (
                  <option key={ex.id} value={ex.id}>
                    #{ex.id} — {ex.title}  ({ex.question_count ?? 0}/{ex.total_questions ?? '?'} Q) · {ex.status}
                  </option>
                ))}
                {exams.length === 0 && <option value="">No exams yet — create one</option>}
              </select>
            </div>

            {selectedExam && (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="bg-slate-100 rounded-xl px-4 py-3 text-center min-w-[80px]">
                  <p className="text-xs text-slate-500 font-medium">Duration</p>
                  <p className="text-base font-bold text-slate-800">⏱ {selectedExam.duration_minutes}m</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center min-w-[90px]">
                  <p className="text-xs text-green-600 font-medium">Marks</p>
                  <p className="text-base font-bold text-green-700">+{selectedExam.positive_marks} / −{selectedExam.negative_marks}</p>
                </div>
                <div className={`rounded-xl px-4 py-3 text-center min-w-[80px] ${
                  selectedExam.status === 'active'    ? 'bg-green-100 border border-green-200' :
                  selectedExam.status === 'draft'     ? 'bg-yellow-50 border border-yellow-200' :
                  selectedExam.status === 'completed' ? 'bg-slate-100 border border-slate-200' :
                  'bg-blue-50 border border-blue-200'
                }`}>
                  <p className="text-xs text-slate-500 font-medium">Status</p>
                  <p className={`text-sm font-bold ${
                    selectedExam.status === 'active'    ? 'text-green-700' :
                    selectedExam.status === 'draft'     ? 'text-yellow-700' :
                    selectedExam.status === 'completed' ? 'text-slate-600' :
                    'text-blue-700'
                  }`}>{selectedExam.status?.toUpperCase()}</p>
                </div>

                {/* Go to Exam Controller — visible when exam has questions and isn't already active/completed */}
                {(selectedExam.status === 'draft' || selectedExam.status === 'scheduled') &&
                  (selectedExam.question_count ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={handleGoToController}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '8px',
                      padding: '10px 22px',
                      background: '#16a34a',
                      color: '#fff',
                      fontSize: '14px', fontWeight: 700,
                      borderRadius: '12px',
                      border: 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 2px 8px rgba(22,163,74,0.3)',
                    }}
                  >
                    🚀 Start Exam
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── PDF Extractions section ── */}
        {extractions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-700 flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center text-sm">📄</span>
                PDF Extractions
              </h2>
              <span className="text-xs text-slate-400">{extractions.length} total</span>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {extractions.slice(0, 6).map(ex => {
                const isStuck  = (ex.status === 'uploaded' || ex.status === 'failed')
                const isActive = ex.status === 'processing'
                const isDone   = ex.status === 'pending_review' || ex.status === 'finalized'
                const pct      = ex.progress_percent || 0

                const borderColor =
                  ex.status === 'failed'         ? 'border-l-red-500' :
                  ex.status === 'pending_review' ? 'border-l-emerald-500' :
                  ex.status === 'finalized'      ? 'border-l-slate-400' :
                  ex.status === 'processing'     ? 'border-l-blue-500' :
                                                    'border-l-yellow-400'
                const badgeClass =
                  ex.status === 'failed'         ? 'bg-red-100 text-red-700' :
                  ex.status === 'pending_review' ? 'bg-emerald-100 text-emerald-700' :
                  ex.status === 'finalized'      ? 'bg-slate-100 text-slate-600' :
                  ex.status === 'processing'     ? 'bg-blue-100 text-blue-700' :
                                                    'bg-yellow-100 text-yellow-700'

                // left-border accent color (inline style to avoid Tailwind purge conflict with border-l-4)
                const accentColor =
                  ex.status === 'failed'         ? '#ef4444' :
                  ex.status === 'pending_review' ? '#10b981' :
                  ex.status === 'finalized'      ? '#94a3b8' :
                  ex.status === 'processing'     ? '#3b82f6' :
                                                    '#f59e0b'

                return (
                  <div key={ex.id}
                    style={{borderLeft: `4px solid ${accentColor}`}}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-4">
                      {/* Left: info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">#{ex.id}</span>
                          <span className="font-semibold text-slate-800 text-base truncate">{ex.title}</span>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeClass}`}>
                            {ex.status === 'uploaded' ? 'QUEUED' : ex.status.replace('_', ' ').toUpperCase()}
                          </span>
                          {isActive && (
                            <span className="text-xs text-blue-500 font-semibold animate-pulse">{pct}%</span>
                          )}
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-slate-100 rounded-full h-2 mb-3 overflow-hidden">
                          <div
                            className="h-2 rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, background: accentColor }}
                          />
                        </div>

                        <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
                          <span>
                            <span className="font-bold text-slate-700">{ex.extracted_count}</span>
                            /{ex.expected_questions} questions extracted
                          </span>
                          {ex.flagged_count > 0 && (
                            <span className="text-amber-600 font-medium">⚑ {ex.flagged_count} flagged</span>
                          )}
                          {(isStuck || isActive) && ex.progress_message && (
                            <span className={`text-xs italic truncate max-w-xs ${ex.status === 'failed' ? 'text-red-500' : 'text-slate-400'}`}
                              title={ex.progress_message}>
                              {ex.progress_message}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: actions — NO flex-wrap (caused click-zone offset) */}
                      <div style={{display:'flex', alignItems:'center', gap:'8px', flexShrink:0}}>
                        {isDone && (
                          <Link
                            href={`/admin/extractions/${ex.id}/review`}
                            style={{display:'inline-flex', alignItems:'center', padding:'8px 14px', background:'#eef2ff', color:'#4338ca', fontSize:'13px', fontWeight:600, borderRadius:'10px', border:'1px solid #c7d2fe', textDecoration:'none', whiteSpace:'nowrap'}}
                          >
                            Review →
                          </Link>
                        )}
                        {isDone && (
                          <button
                            type="button"
                            onClick={() => setGoLiveEx(ex)}
                            style={{display:'inline-flex', alignItems:'center', padding:'8px 14px', background:'#ecfdf5', color:'#065f46', fontSize:'13px', fontWeight:600, borderRadius:'10px', border:'1px solid #6ee7b7', cursor:'pointer', whiteSpace:'nowrap'}}
                          >
                            🚀 Go Live
                          </button>
                        )}
                        {isStuck && (
                          <button
                            type="button"
                            onClick={async () => {
                              try { await retryExtraction(ex.id); refreshExtractions() }
                              catch (e) { alert(e.response?.data?.detail || 'Retry failed') }
                            }}
                            style={{display:'inline-flex', alignItems:'center', padding:'8px 14px', background:'#fff7ed', color:'#9a3412', fontSize:'13px', fontWeight:600, borderRadius:'10px', border:'1px solid #fed7aa', cursor:'pointer', whiteSpace:'nowrap'}}
                          >
                            ↺ Retry
                          </button>
                        )}
                        {ex.status !== 'processing' && (
                          <button
                            type="button"
                            onClick={() => setDelExConfirm(ex)}
                            title="Delete extraction"
                            style={{display:'inline-flex', alignItems:'center', padding:'8px 12px', background:'#fef2f2', color:'#dc2626', fontSize:'16px', borderRadius:'10px', border:'1px solid #fecaca', cursor:'pointer'}}
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Question list section ── */}
        {selectedExam && (
          <div>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h2 className="text-base font-bold text-slate-700 mr-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-indigo-100 flex items-center justify-center text-sm">❓</span>
                Questions
              </h2>
              <button
                type="button"
                onClick={() => { setEditing({ ...BLANK_FORM, sequence_number: nextSeq }); setShowEditor(true) }}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow-md shadow-indigo-200 transition-all"
              >
                + Add Question
              </button>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search questions…"
                className="border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm w-64 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none bg-white"
              />
              <select
                value={filterSubj}
                onChange={e => setFilterSubj(e.target.value)}
                className="border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none bg-white"
              >
                {usedSubjects.map(s => <option key={s}>{s}</option>)}
              </select>
              <span className="ml-auto text-sm text-slate-500 font-medium">
                {filtered.length} of {questions.length} questions
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-24 text-slate-400">
                  <span className="animate-spin mr-3 text-3xl">⟳</span>
                  <span className="text-base">Loading questions…</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-24">
                  <p className="text-6xl mb-4">📝</p>
                  <p className="text-slate-500 text-xl font-semibold mb-1">
                    {questions.length === 0 ? 'No questions yet' : 'No questions match your filter'}
                  </p>
                  <p className="text-slate-400 text-sm mb-6">
                    {questions.length === 0
                      ? 'Add questions manually or upload a PDF to extract them automatically.'
                      : 'Try clearing the search or changing the subject filter.'}
                  </p>
                  {questions.length === 0 && (
                    <button
                      onClick={() => { setEditing({ ...BLANK_FORM, sequence_number: 1 }); setShowEditor(true) }}
                      className="px-6 py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-md"
                    >
                      Add First Question
                    </button>
                  )}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                      <th className="px-5 py-4 w-14">#</th>
                      <th className="px-5 py-4 w-28">Subject</th>
                      <th className="px-5 py-4 w-24">Type</th>
                      <th className="px-5 py-4">Question</th>
                      <th className="px-5 py-4 w-24 text-center">Marks</th>
                      <th className="px-5 py-4 w-20 text-center">Answer</th>
                      <th className="px-5 py-4 w-28 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map(q => (
                      <tr key={q.id} className="hover:bg-indigo-50/30 transition-colors group">
                        <td className="px-5 py-4 font-bold text-slate-400 text-base">{q.sequence_number}</td>
                        <td className="px-5 py-4">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${SUBJECT_COLORS[q.subject] || 'bg-slate-100 text-slate-700'}`}>
                            {q.subject}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${TYPE_COLORS[q.question_type] || ''}`}>
                            {q.question_type === 'single_mcq' ? 'MCQ' :
                             q.question_type === 'multi_mcq'  ? 'Multi' : 'Numerical'}
                          </span>
                        </td>
                        <td className="px-5 py-4 max-w-0">
                          <div className="truncate text-slate-800 font-medium text-base leading-snug">
                            <MathRenderer text={q.text?.slice(0, 120) + (q.text?.length > 120 ? '…' : '')} />
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {q.image_url && (
                              <span className="inline-flex items-center gap-1 text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                                📷 question image
                              </span>
                            )}
                            {q.option_images && Object.values(q.option_images).some(Boolean) && (
                              <span className="inline-flex items-center gap-1 text-xs text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
                                🖼 option diagrams
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-green-700 font-bold text-sm">+{q.marks}</span>
                            <span className="text-red-500 text-xs">−{q.negative_marks}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="inline-flex w-8 h-8 rounded-full bg-green-100 text-green-800 text-sm font-bold items-center justify-center border border-green-200">
                            {q.correct_answer}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => { setEditing(q); setShowEditor(true) }}
                              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-200 transition-colors"
                            >Edit</button>
                            <button
                              onClick={() => setDeleteConfirm(q.id)}
                              className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-lg border border-red-200 transition-colors"
                            >Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Empty state — no exam selected */}
        {!selectedExam && !loading && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm text-center py-28">
            <p className="text-7xl mb-5">📋</p>
            <p className="text-slate-700 text-2xl font-bold mb-2">No exam selected</p>
            <p className="text-slate-400 text-base mb-8">Create an exam first, then add or upload questions.</p>
            <button
              onClick={() => setShowNewExam(true)}
              className="px-8 py-4 bg-indigo-600 text-white font-bold text-base rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all"
            >
              + Create First Exam
            </button>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showEditor && (
        <QuestionEditorModal
          examId={selectedExam?.id}
          editing={editing?.id ? editing : null}
          onSave={() => { setShowEditor(false); refresh() }}
          onClose={() => setShowEditor(false)}
        />
      )}

      {showUpload && (
        <UploadPdfModal
          onClose={() => { setShowUpload(false); refreshExtractions() }}
          onFinishedExtraction={() => refreshExtractions()}
        />
      )}

      {showNewExam && (
        <CreateExamModal
          onCreated={(exam) => {
            setExams(prev => [exam, ...prev])
            setSelectedExam(exam)
            setShowNewExam(false)
          }}
          onClose={() => setShowNewExam(false)}
        />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-rose-600 px-8 py-5 text-center">
              <p className="text-4xl mb-1">🗑️</p>
              <h2 className="text-lg font-bold text-white">Delete Question?</h2>
            </div>
            <div className="p-7 text-center">
              <p className="text-slate-500 text-sm mb-6">This question will be permanently removed from the exam. This cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-3 border-2 border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={() => handleDelete(deleteConfirm)}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md">
                  Yes, Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Go Live modal ── */}
      {goLiveEx && (
        <GoLiveModal
          extraction={goLiveEx}
          exams={exams}
          onClose={() => setGoLiveEx(null)}
          onSuccess={() => { setGoLiveEx(null); refreshExtractions() }}
        />
      )}

      {/* ── Delete extraction confirmation ── */}
      {delExConfirm && (
        <DeleteExtractionModal
          extraction={delExConfirm}
          onClose={() => setDelExConfirm(null)}
          onDeleted={() => {
            setDelExConfirm(null)
            refreshExtractions()
          }}
        />
      )}

    </div>
  )
}
