'use client'
/**
 * MathRenderer.js
 * Renders text containing LaTeX math delimiters using KaTeX.
 *
 * Supported syntax:
 *   $$...$$  — block / display math (centered, large)
 *   $...$    — inline math
 *   Plain text is rendered as-is (newlines become <br />)
 *
 * Usage:
 *   <MathRenderer text="The value of $\int_0^\pi \sin x\,dx$ is $$2$$" />
 */

import { useMemo } from 'react'
import katex from 'katex'

// ── KaTeX renderer ─────────────────────────────────────────────────────────
function renderPart(content, type, key) {
  if (type === 'text') {
    return content.split('\n').map((line, i, arr) => (
      <span key={`${key}-${i}`}>
        {line}
        {i < arr.length - 1 && <br />}
      </span>
    ))
  }

  try {
    const html = katex.renderToString(content, {
      displayMode: type === 'block',
      throwOnError: false,
      errorColor: '#e53e3e',
      strict: false,
    })
    return (
      <span
        key={key}
        className={type === 'block' ? 'block my-2 text-center overflow-x-auto' : 'inline'}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  } catch {
    return (
      <span key={key} className="text-red-500 font-mono text-sm">
        [{content}]
      </span>
    )
  }
}

// ── Parser: splits text into text / inline-math / block-math parts ──────────
function parseMath(text) {
  if (!text) return []
  const parts = []
  // Match $$...$$ (block) first, then $...$ (inline)
  const regex = /\$\$([\s\S]*?)\$\$|\$([\s\S]*?)\$/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    if (match[1] !== undefined) {
      parts.push({ type: 'block', content: match[1] })
    } else {
      parts.push({ type: 'inline', content: match[2] })
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
  }

  return parts
}

// ── Main component ───────────────────────────────────────────────────────────
export default function MathRenderer({ text = '', className = '' }) {
  const parts = useMemo(() => parseMath(text), [text])

  if (!text) return null

  return (
    <span className={className}>
      {parts.map((part, i) => renderPart(part.content, part.type, i))}
    </span>
  )
}
