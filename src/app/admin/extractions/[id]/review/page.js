'use client'
/**
 * /admin/extractions/[id]/review — Phase 2 split-screen reviewer.
 *
 * Layout  (three columns):
 *   LEFT    Question list sidebar   (w-56, scrollable)
 *   CENTER  PDF page viewer         (flex-1, page images from S3)
 *   RIGHT   Question editor         (w-[480px], scrollable)
 *
 * Visual questions get an image-upload dropzone per option.
 * The question manager can also switch any option to plain-text mode.
 * Approve is blocked until every originally-visual option has either
 * an uploaded image or a non-empty text description.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  listExtractedQuestions,
  getReviewStats,
  updateExtractedQuestion,
  approveQuestion,
  rejectQuestion,
  skipQuestion,
  uploadOptionImage,
  uploadExtractedQuestionImage,
  getExtractionPageUrls,
} from '@/lib/api/adminClient'

// ── Tiny helpers ──────────────────────────────────────────────────────────────
const STATUS_BADGE = {
  PENDING_REVIEW: { label: 'Pending',  cls: 'bg-yellow-100 text-yellow-800' },
  APPROVED:       { label: 'Approved', cls: 'bg-green-100  text-green-800'  },
  REJECTED:       { label: 'Rejected', cls: 'bg-red-100    text-red-800'    },
  SKIPPED:        { label: 'Skipped',  cls: 'bg-gray-100   text-gray-600'   },
}

function StatusBadge({ status }) {
  const s = STATUS_BADGE[status] || STATUS_BADGE.PENDING_REVIEW
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>
      {s.label}
    </span>
  )
}

const CONF_COLOR = (c) =>
  c >= 0.95 ? 'text-green-600' : c >= 0.80 ? 'text-yellow-600' : 'text-red-600'

// ── Build initial local option state from a question ─────────────────────────
function initOpts(question) {
  const result = {}
  for (const l of ['A', 'B', 'C', 'D']) {
    const o = question.options?.[l] || {}
    result[l] = {
      text:           o.text           || '',
      has_image:      o.has_image      || false,
      image_url:      o.image_url      || null,
      image_uploaded: o.image_uploaded || false,
      image_s3_key:   o.image_s3_key   || null,
      // "image" mode = dropzone/preview; "text" mode = textarea
      // Default: image mode if flagged, text mode otherwise
      mode: o.has_image ? 'image' : 'text',
    }
  }
  return result
}

// ── PDF Viewer (center panel) ─────────────────────────────────────────────────
function PdfViewer({ pageUrls, currentPage, onPageChange }) {
  const total    = pageUrls.length
  const pageData = pageUrls.find(p => p.page === currentPage) || pageUrls[0]

  if (!total) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 select-none">
        <span className="text-4xl">📄</span>
        <p className="text-sm">PDF pages not available</p>
        <p className="text-xs text-gray-300">Check S3 configuration</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Nav bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 bg-gray-100 border-b border-gray-200">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="text-xs text-gray-600 font-medium">
          Page {currentPage} / {total}
        </span>
        <button
          onClick={() => onPageChange(Math.min(total, currentPage + 1))}
          disabled={currentPage >= total}
          className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
        >
          Next →
        </button>
      </div>

      {/* Page image */}
      <div className="flex-1 overflow-auto bg-gray-200 flex items-start justify-center p-2">
        {pageData?.url ? (
          <img
            src={pageData.url}
            alt={`PDF page ${currentPage}`}
            className="max-w-full shadow-md rounded"
            style={{ maxHeight: '100%' }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Loading page…
          </div>
        )}
      </div>
    </div>
  )
}

// ── Question image upload (stem image — the diagram inside the question body) ──
function QuestionImageUpload({ imageUrl, onUpload, onRemove }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  async function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file (PNG, JPG, WebP)')
      return
    }
    setUploading(true)
    setUploadError('')
    try {
      await onUpload(file)
    } catch (err) {
      setUploadError(err.response?.data?.detail || 'Upload failed — try again')
    } finally {
      setUploading(false)
    }
  }

  if (imageUrl) {
    return (
      <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-3">
        <p className="text-xs font-semibold text-indigo-700 mb-2">Question Image</p>
        <img
          src={imageUrl}
          alt="Question diagram"
          className="max-h-48 max-w-full rounded-lg border border-indigo-200 shadow-sm object-contain bg-white"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="text-xs px-2 py-1 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            🔄 Replace
          </button>
          <button
            onClick={onRemove}
            className="text-xs px-2 py-1 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
          >
            ✕ Remove
          </button>
        </div>
        {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50 p-3">
      <p className="text-xs font-semibold text-indigo-700 mb-2">
        Question Image <span className="font-normal text-indigo-500">(diagram / figure in the question body)</span>
      </p>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="w-full flex flex-col items-center justify-center gap-1 py-4 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-60"
      >
        {uploading ? (
          <>
            <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-medium">Uploading…</span>
          </>
        ) : (
          <>
            <span className="text-2xl">🖼️</span>
            <span className="text-xs font-semibold">Click to upload question image</span>
            <span className="text-xs text-indigo-400">PNG, JPG, WebP · max 10 MB</span>
          </>
        )}
      </button>
      {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
    </div>
  )
}

// ── Option row — supports image upload and text fallback ──────────────────────
function OptionRow({ letter, opt, originalHasImage, isCorrect, onChange, onMarkCorrect, onUploadImage }) {
  const fileRef        = useRef(null)
  const [uploading, setUploading]     = useState(false)
  const [uploadError, setUploadError] = useState('')

  const mode = opt.mode || 'text'

  // ── Handlers ──
  function switchToText() {
    setUploadError('')
    onChange({ ...opt, mode: 'text', has_image: false })
  }

  function switchToImage() {
    onChange({ ...opt, mode: 'image', has_image: true })
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''   // allow re-selecting same file
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file (PNG, JPG, WebP)')
      return
    }
    setUploading(true)
    setUploadError('')
    try {
      const res = await onUploadImage(letter, file)
      onChange({
        ...opt,
        image_url:      res.image_url,
        image_s3_key:   res.s3_key,
        image_uploaded: true,
        mode:           'image',
        has_image:      true,
      })
    } catch (err) {
      setUploadError(err.response?.data?.detail || 'Upload failed — try again')
    } finally {
      setUploading(false)
    }
  }

  // ── Shared letter button ──
  const LetterBtn = (
    <button
      onClick={onMarkCorrect}
      title={`Mark ${letter} as correct`}
      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
        isCorrect
          ? 'border-green-500 bg-green-500 text-white'
          : 'border-gray-300 text-gray-600 hover:border-green-400 hover:bg-green-50'
      }`}
    >
      {letter}
    </button>
  )

  // ── Text mode ──
  if (mode === 'text') {
    return (
      <div className={`flex items-start gap-2 rounded-xl border-2 p-3 transition-colors ${
        isCorrect ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
      }`}>
        {LetterBtn}
        <div className="flex-1">
          <textarea
            rows={2}
            value={opt.text}
            onChange={e => onChange({ ...opt, text: e.target.value })}
            placeholder={`Type option ${letter} text`}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          {originalHasImage && (
            <button
              onClick={switchToImage}
              className="mt-1 text-xs text-indigo-600 hover:text-indigo-800 underline"
            >
              ↩ Switch back to image upload
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Image mode — preview ──
  if (opt.image_url) {
    return (
      <div className={`flex items-start gap-2 rounded-xl border-2 p-3 transition-colors ${
        isCorrect ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
      }`}>
        {LetterBtn}
        <div className="flex-1">
          <div className="relative inline-block">
            <img
              src={opt.image_url}
              alt={`Option ${letter}`}
              className="max-h-28 max-w-full rounded-lg border border-gray-200 shadow-sm object-contain bg-white"
            />
            <span className="absolute top-1 right-1 bg-green-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">
              ✓
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="text-xs px-2 py-1 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              🔄 Replace Image
            </button>
            <button
              onClick={() => onChange({ ...opt, image_url: null, image_uploaded: false, image_s3_key: null })}
              className="text-xs px-2 py-1 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
            >
              ✕ Remove
            </button>
            <button
              onClick={switchToText}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Use text instead
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
        </div>
      </div>
    )
  }

  // ── Image mode — dropzone (no image yet) ──
  return (
    <div className={`flex items-start gap-2 rounded-xl border-2 p-3 transition-colors ${
      isCorrect ? 'border-green-400 bg-green-50' : 'border-orange-300 bg-orange-50'
    }`}>
      {LetterBtn}
      <div className="flex-1">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full flex flex-col items-center justify-center gap-1 border-2 border-dashed border-orange-300 rounded-xl py-4 text-orange-700 hover:bg-orange-100 transition-colors disabled:opacity-60"
        >
          {uploading ? (
            <>
              <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-medium">Uploading…</span>
            </>
          ) : (
            <>
              <span className="text-2xl">📷</span>
              <span className="text-xs font-semibold">Click to upload option {letter} image</span>
              <span className="text-xs text-orange-500">PNG, JPG, WebP · max 10 MB</span>
            </>
          )}
        </button>
        {uploadError && (
          <p className="text-xs text-red-600 mt-1">{uploadError}</p>
        )}
        <button
          onClick={switchToText}
          className="mt-1.5 text-xs text-gray-500 hover:text-gray-700 underline"
        >
          Use text description instead
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
      </div>
    </div>
  )
}

// ── Question editor (right panel) ────────────────────────────────────────────
function QuestionEditor({ question, onAction, onUploadImage, onUploadQuestionImage }) {
  const [text, setText]               = useState(question.question_text || '')
  const [questionImgUrl, setQImgUrl]  = useState(question.question_image_url || null)
  const [opts, setOpts]               = useState(() => initOpts(question))
  const [correct, setCorrect]         = useState(question.correct_answer || '')
  const [marks, setMarks]             = useState(question.marks ?? 1)
  const [negMarks, setNegMarks]       = useState(question.negative_marks ?? 0.25)
  const [saving, setSaving]           = useState(false)
  const [actioning, setActioning]     = useState(false)
  const [saved, setSaved]             = useState(false)
  const [error, setError]             = useState(null)

  // Reset when switching questions
  useEffect(() => {
    setText(question.question_text || '')
    setQImgUrl(question.question_image_url || null)
    setOpts(initOpts(question))
    setCorrect(question.correct_answer || '')
    setMarks(question.marks ?? 1)
    setNegMarks(question.negative_marks ?? 0.25)
    setSaved(false)
    setError(null)
  }, [question.id])

  // Options that were originally flagged as visual AND haven't been completed yet
  function getMissingImages() {
    return ['A', 'B', 'C', 'D'].filter(l => {
      const orig = question.options?.[l]
      if (!orig?.has_image) return false          // wasn't flagged — skip
      const cur = opts[l]
      if (cur.mode === 'image' && !cur.image_url) return true   // flagged, no image yet
      if (cur.mode === 'text'  && !cur.text.trim()) return true // switched to text but empty
      return false
    })
  }

  // Build API-ready options payload from local state
  function buildOptsPayload() {
    const result = {}
    for (const [l, o] of Object.entries(opts)) {
      result[l] = {
        text:           o.text           || '',
        has_image:      o.mode === 'image',
        image_url:      o.mode === 'image' ? (o.image_url || null) : null,
        image_uploaded: o.image_uploaded || false,
        image_s3_key:   o.image_s3_key   || null,
      }
    }
    return result
  }

  async function doSave() {
    await updateExtractedQuestion(question.id, {
      question_text:      text,
      question_image_url: questionImgUrl || null,
      options:            buildOptsPayload(),
      correct_answer:     correct || null,
      marks:              parseFloat(marks),
      negative_marks:     parseFloat(negMarks),
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await doSave()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAction(actionFn, actionName) {
    // Block approve if any visual option is incomplete
    if (actionName === 'approve') {
      const missing = getMissingImages()
      if (missing.length > 0) {
        setError(
          `Option${missing.length > 1 ? 's' : ''} ${missing.join(', ')}: ` +
          `upload an image or click "Use text instead" before approving.`
        )
        return
      }
    }
    setActioning(true)
    setError(null)
    try {
      await doSave()
      await actionFn(question.id)
      onAction()
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setActioning(false)
    }
  }

  const status       = question.status
  const missingImgs  = getMissingImages()
  const isVisual     = question.has_visual_component
  // Question image is not blocking (manager decides if stem needs one),
  // but we show a hint when visual and no image is set yet.
  const needsQImg    = isVisual && !questionImgUrl

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-gray-800">Q.{question.question_number}</span>
          <StatusBadge status={status} />
          <span className={`text-xs font-mono ${CONF_COLOR(question.extraction_confidence)}`}>
            {(question.extraction_confidence * 100).toFixed(0)}%
          </span>
          {isVisual && (
            <span className="text-xs bg-purple-100 text-purple-700 font-semibold px-2 py-0.5 rounded-full">
              📷 visual
            </span>
          )}
          {question.source_page && (
            <span className="text-xs text-gray-400">p.{question.source_page}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-green-600 text-xs font-medium">Saved ✓</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

        {/* AI suggestions */}
        {question.ai_suggestions?.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="text-xs font-semibold text-amber-800 mb-1">AI suggestions</p>
            {question.ai_suggestions.map((s, i) => (
              <p key={i} className="text-xs text-amber-700">• {s}</p>
            ))}
          </div>
        )}

        {/* Visual question banner */}
        {isVisual && (
          <div className={`rounded-xl border-2 px-4 py-3 ${
            missingImgs.length > 0
              ? 'border-orange-400 bg-orange-50'
              : 'border-green-300 bg-green-50'
          }`}>
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none">{missingImgs.length > 0 ? '📷' : '✅'}</span>
              <div>
                {missingImgs.length > 0 ? (
                  <>
                    <p className="text-sm font-bold text-orange-800">
                      {missingImgs.length} image{missingImgs.length > 1 ? 's' : ''} still needed
                      (option{missingImgs.length > 1 ? 's' : ''} {missingImgs.join(', ')})
                    </p>
                    <p className="text-xs text-orange-700 mt-0.5">
                      Open the PDF on the left and screenshot each diagram.
                      You can also click <strong>"Use text instead"</strong> to type a description.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-green-800">All option images uploaded ✅</p>
                    {needsQImg && (
                      <p className="text-xs text-green-700 mt-0.5">
                        If the question body also has a diagram, upload it below under <strong>Question Image</strong>.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Question image — shown for any visual question so the manager can
            upload a stem diagram (e.g. the clock in Q13, the dice in Q14).
            Not blocking approval — the manager decides if one is needed. */}
        {isVisual && (
          <QuestionImageUpload
            imageUrl={questionImgUrl}
            onUpload={async (file) => {
              const res = await onUploadQuestionImage(file)
              setQImgUrl(res.image_url)
            }}
            onRemove={() => setQImgUrl(null)}
          />
        )}

        {/* Question text */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">
            Question Text
          </label>
          <textarea
            rows={3}
            value={text}
            onChange={e => setText(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>

        {/* Options */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
            Options — click letter to mark correct
          </label>
          <div className="space-y-2">
            {['A', 'B', 'C', 'D'].map(l => (
              <OptionRow
                key={l}
                letter={l}
                opt={opts[l]}
                originalHasImage={question.options?.[l]?.has_image || false}
                isCorrect={correct === l}
                onChange={v => setOpts(o => ({ ...o, [l]: v }))}
                onMarkCorrect={() => setCorrect(l)}
                onUploadImage={onUploadImage}
              />
            ))}
          </div>
          {!correct && (
            <p className="text-xs text-amber-600 mt-1">No correct answer selected — click a letter to set it</p>
          )}
        </div>

        {/* Marks */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">
              Correct marks (+)
            </label>
            <input
              type="number" min="0" step="0.5" value={marks}
              onChange={e => setMarks(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">
              Negative marks (−)
            </label>
            <input
              type="number" min="0" step="0.25" value={negMarks}
              onChange={e => setNegMarks(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

      </div>

      {/* ── Action bar ── */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAction(approveQuestion, 'approve')}
            disabled={actioning || status === 'APPROVED'}
            className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl text-sm disabled:opacity-40 transition-colors"
          >
            {actioning ? '…' : '✓ Approve'}
          </button>
          <button
            onClick={() => handleAction(skipQuestion, 'skip')}
            disabled={actioning || status === 'SKIPPED'}
            className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm disabled:opacity-40 transition-colors"
          >
            → Skip
          </button>
          <button
            onClick={() => handleAction(rejectQuestion, 'reject')}
            disabled={actioning || status === 'REJECTED'}
            className="flex-1 py-2.5 bg-red-100 hover:bg-red-200 text-red-700 font-semibold rounded-xl text-sm disabled:opacity-40 transition-colors"
          >
            ✕ Reject
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ExtractionReviewPage() {
  const { id }   = useParams()
  const router   = useRouter()

  const [questions, setQuestions]   = useState([])
  const [stats, setStats]           = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('ALL')
  const [search, setSearch]         = useState('')

  // PDF viewer state
  const [pageUrls, setPageUrls]   = useState([])    // [{page, url}, ...]
  const [pdfPage, setPdfPage]     = useState(1)

  // Load questions + stats
  const loadAll = useCallback(async () => {
    try {
      const [qRes, sRes] = await Promise.all([
        listExtractedQuestions(id),
        getReviewStats(id),
      ])
      setQuestions(qRes.data)
      setStats(sRes.data)
      if (!selectedId && qRes.data.length > 0) {
        setSelectedId(qRes.data[0].id)
      }
    } catch (e) {
      console.error('Failed to load questions', e)
    } finally {
      setLoading(false)
    }
  }, [id])  // eslint-disable-line

  useEffect(() => { loadAll() }, [loadAll])

  // Load PDF page URLs once
  useEffect(() => {
    getExtractionPageUrls(id)
      .then(res => setPageUrls(res.data.pages || []))
      .catch(err => console.warn('PDF pages not available:', err.message))
  }, [id])

  // Sync PDF viewer to selected question's source page
  const selected = questions.find(q => q.id === selectedId) || null
  useEffect(() => {
    if (selected?.source_page) setPdfPage(selected.source_page)
  }, [selected?.id])  // eslint-disable-line

  async function handleAction() {
    const [qRes, sRes] = await Promise.all([
      listExtractedQuestions(id),
      getReviewStats(id),
    ])
    setQuestions(qRes.data)
    setStats(sRes.data)
    // Auto-advance to next pending question
    const current = qRes.data.find(q => q.id === selectedId)
    const pending  = qRes.data.filter(q => q.status === 'PENDING_REVIEW')
    if (pending.length > 0) {
      const afterCurrent = pending.find(q => q.question_number > (current?.question_number ?? 0))
      setSelectedId(afterCurrent ? afterCurrent.id : pending[0].id)
    }
  }

  // Upload handlers passed down to editor
  async function handleUploadOptionImage(letter, file) {
    if (!selected) throw new Error('No question selected')
    const res = await uploadOptionImage(selected.id, letter, file)
    const qRes = await listExtractedQuestions(id)
    setQuestions(qRes.data)
    return res.data  // { option, image_url, s3_key }
  }

  async function handleUploadQuestionImage(file) {
    if (!selected) throw new Error('No question selected')
    const res = await uploadExtractedQuestionImage(selected.id, file)
    // Refresh so sidebar reflects the updated question_image_url
    const qRes = await listExtractedQuestions(id)
    setQuestions(qRes.data)
    return res.data  // { image_url, s3_key }
  }

  const filtered = questions.filter(q => {
    const matchFilter = filter === 'ALL' || q.status === filter
    const matchSearch = !search || q.question_text.toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  })

  const pct = stats ? Math.round(((stats.approved + stats.rejected) / Math.max(stats.total, 1)) * 100) : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading questions…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
        <button
          onClick={() => router.push('/admin/questions')}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-gray-800 text-sm leading-tight truncate">
            Extraction #{id} — Review
          </h1>
          {stats && (
            <p className="text-xs text-gray-500">
              {stats.approved} approved · {stats.rejected} rejected · {stats.skipped} skipped · {stats.pending} pending
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-40 flex-shrink-0">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-0.5">
            <span>Progress</span>
            <span className="font-semibold text-gray-700">{pct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Three-column body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ════ LEFT: Question list ════ */}
        <div className="w-52 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">

          {/* Search + filter */}
          <div className="p-2 border-b border-gray-100 space-y-1.5">
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <div className="flex gap-1 flex-wrap">
              {['ALL', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-1.5 py-0.5 rounded font-medium transition-colors ${
                    filter === f
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f === 'ALL'          ? `All (${stats?.total || 0})`      :
                   f === 'PENDING_REVIEW'? `Pending (${stats?.pending || 0})`:
                   f === 'APPROVED'     ? `OK (${stats?.approved || 0})`    :
                                          `Rej (${stats?.rejected || 0})`  }
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-xs text-gray-400 text-center mt-8">No questions match</p>
            )}
            {filtered.map(q => (
              <button
                key={q.id}
                onClick={() => setSelectedId(q.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selectedId === q.id ? 'bg-indigo-50 border-l-4 border-l-indigo-500' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-bold text-gray-800">Q.{q.question_number}</span>
                  <StatusBadge status={q.status} />
                </div>
                <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                  {q.question_text || '(no text)'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-xs font-mono ${CONF_COLOR(q.extraction_confidence)}`}>
                    {(q.extraction_confidence * 100).toFixed(0)}%
                  </span>
                  {q.has_visual_component && (
                    <span className="text-xs text-purple-500" title="Visual question">📷</span>
                  )}
                  {!q.correct_answer && (
                    <span className="text-xs text-amber-500" title="No answer set">⚠</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ════ CENTER: PDF viewer ════ */}
        <div className="flex-1 min-w-0 border-r border-gray-200 overflow-hidden flex flex-col bg-gray-100">
          <div className="flex-shrink-0 bg-gray-50 border-b border-gray-200 px-3 py-1.5">
            <p className="text-xs font-semibold text-gray-600">
              📄 Original PDF
              {selected?.source_page && (
                <span className="ml-1 text-indigo-600">— auto-scrolled to Q.{selected.question_number}</span>
              )}
            </p>
          </div>
          <div className="flex-1 overflow-hidden">
            <PdfViewer
              pageUrls={pageUrls}
              currentPage={pdfPage}
              onPageChange={setPdfPage}
            />
          </div>
        </div>

        {/* ════ RIGHT: Editor ════ */}
        <div className="w-[460px] flex-shrink-0 overflow-hidden flex flex-col">
          {selected ? (
            <QuestionEditor
              key={selected.id}
              question={selected}
              onAction={handleAction}
              onUploadImage={handleUploadOptionImage}
              onUploadQuestionImage={handleUploadQuestionImage}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Select a question from the list
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
