/**
 * VoiceMonitor — browser Web Speech API (Chrome/Edge only).
 *
 * Detects two categories of suspicious audio:
 *   1. Prohibited keywords → 'voice_assistant_keyword' (severity 8)
 *   2. Sustained speech > 3 s  → 'sustained_speech' (severity 4)
 *
 * Keyword categories (checked in priority order):
 *   A. Voice assistant commands     — highest risk, instant flag
 *   B. AI/LLM tool names            — high risk
 *   C. Explicit answer phrases      — "correct answer", "option a hai", etc.
 *   D. Alphabet answer calls        — spoken MCQ options ("a hai", "go with b")
 *   E. Hindi cheating phrases       — "bata", "batao", "kya hai", etc.
 *   F. Question reading aloud       — "which of the following", etc.
 *   G. Number dictation             — "ek", "do", "teen" (Hindi 1-4)
 *
 * Per-category cooldowns prevent spam while staying sensitive:
 *   voice_assistant_keyword  → 20 s cooldown
 *   sustained_speech         → 30 s cooldown
 *
 * BROWSER NOTE: Only Chrome/Edge support SpeechRecognition.
 *   Safari/Firefox → reports 'speech_api_unavailable' (severity 1).
 */
export class VoiceMonitor {
  constructor() {
    this.recognition = null
    this.speechStartTime = null
    this.examActive = false
    this.lastViolationTime = {}    // { violationType: timestampMs }
    this.SPEECH_THRESHOLD_MS = 3000   // 3 s of continuous speech = violation (was 5 s)
    this.COOLDOWN_MS = {
      voice_assistant_keyword: 20_000,
      sustained_speech:        30_000,
    }

    // ── Keyword tiers ───────────────────────────────────────────────────────
    // Each entry is a search string matched against the lowercase transcript.
    // Ordered longest-first within each tier so more specific phrases match before
    // shorter substrings (e.g. "option a hai" before "a hai").

    // Tier A — voice assistants (hardcoded devices/services)
    this.ASSISTANT_KEYWORDS = [
      'hey siri', 'ok google', 'okay google', 'hey google',
      'hey cortana', 'cortana', 'alexa', 'bixby', 'hey bixby',
      'google assistant',
    ]

    // Tier B — AI / LLM tool names
    this.AI_KEYWORDS = [
      'chatgpt', 'chat gpt', 'openai', 'open ai',
      'claude', 'gemini', 'copilot', 'perplexity', 'bard', 'llm',
    ]

    // Tier C — explicit answer/cheating phrases (English + Hinglish)
    this.ANSWER_PHRASES = [
      'what is the answer', 'tell me the answer', 'correct answer',
      'right answer', 'wrong answer', 'answer is',
      'the answer', 'solve this for me', 'solve this question',
      'option a is', 'option b is', 'option c is', 'option d is',
      'choice a', 'choice b', 'choice c', 'choice d',
      'answer a', 'answer b', 'answer c', 'answer d',
      'answer kya hai', 'sahi answer', 'galat answer',
      'kya answer hai', 'answer bata', 'answer batao',
    ]

    // Tier D — alphabet answer calls (short spoken MCQ options)
    this.ALPHABET_PHRASES = [
      'option a hai', 'option b hai', 'option c hai', 'option d hai',
      'a hai na', 'b hai na', 'c hai na', 'd hai na',
      'go with a', 'go with b', 'go with c', 'go with d',
      'mark a', 'mark b', 'mark c', 'mark d',
      'select a', 'select b', 'select c', 'select d',
      'choose a', 'choose b', 'choose c', 'choose d',
      'it is a', 'it is b', 'it is c', 'it is d',
      "it's a", "it's b", "it's c", "it's d",
      'a hai', 'b hai', 'c hai', 'd hai',
    ]

    // Tier E — Hindi communication / cheating phrases
    this.HINDI_PHRASES = [
      'bata do', 'bata de', 'batao', 'bata',
      'kya hai', 'kya hoga', 'kya hota hai',
      'suno', 'sunao', 'yaar', 'bhai', 'dost',
      'ek baar bata', 'jaldi bata', 'answer bol',
      'padh ke bata', 'dekh ke bata',
    ]

    // Tier F — question reading aloud
    this.QUESTION_PHRASES = [
      'which of the following', 'which one of the following',
      'according to', 'with respect to', 'in the context of',
      'find the value', 'calculate the', 'what will be the',
      'determine the', 'find out',
    ]

    // Tier G — number dictation (Hindi 1-4 most common for MCQ)
    this.NUMBER_DICTATION = [
      'ek do teen', 'ek hai', 'do hai', 'teen hai', 'char hai',
    ]
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _isCoolingDown(type) {
    const cooldown = this.COOLDOWN_MS[type] || 15_000
    return (Date.now() - (this.lastViolationTime[type] || 0)) < cooldown
  }

  _markViolationTime(type) {
    this.lastViolationTime[type] = Date.now()
  }

  /**
   * Return the first matching keyword across all tiers (priority order A→G).
   * Returns null if no match.
   */
  _findKeyword(transcript) {
    const tiers = [
      this.ASSISTANT_KEYWORDS,
      this.AI_KEYWORDS,
      this.ANSWER_PHRASES,
      this.ALPHABET_PHRASES,
      this.HINDI_PHRASES,
      this.QUESTION_PHRASES,
      this.NUMBER_DICTATION,
    ]
    for (const tier of tiers) {
      for (const kw of tier) {
        if (transcript.includes(kw)) return kw
      }
    }
    return null
  }

  // ── Public API ────────────────────────────────────────────────────────────

  start(onViolation) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      onViolation({
        type: 'speech_api_unavailable',
        severity: 1,
        message: 'Browser does not support speech recognition — use Chrome or Edge',
        timestamp: new Date().toISOString(),
      })
      return
    }

    this.examActive = true
    this.recognition = new SR()
    this.recognition.continuous = true
    this.recognition.interimResults = true
    this.recognition.lang = 'hi-IN'  // Hindi-Indian; catches both Hindi and Indian English

    this.recognition.onresult = (event) => {
      // Build running transcript from all result segments (interim + final)
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript.toLowerCase().trim())
        .join(' ')

      // ── Priority 1: keyword detection ──────────────────────────────────
      const keyword = this._findKeyword(transcript)
      if (keyword && !this._isCoolingDown('voice_assistant_keyword')) {
        this._markViolationTime('voice_assistant_keyword')
        this.speechStartTime = null   // reset sustained speech timer
        onViolation({
          type: 'voice_assistant_keyword',
          severity: 8,
          keyword,
          transcript: transcript.slice(0, 200),  // cap length for DB
          timestamp: new Date().toISOString(),
        })
        return
      }

      // ── Priority 2: sustained speech timer ─────────────────────────────
      if (!this.speechStartTime) this.speechStartTime = Date.now()
      const duration = Date.now() - this.speechStartTime

      if (duration > this.SPEECH_THRESHOLD_MS && !this._isCoolingDown('sustained_speech')) {
        this._markViolationTime('sustained_speech')
        this.speechStartTime = null
        onViolation({
          type: 'sustained_speech',
          severity: 4,
          duration_ms: duration,
          timestamp: new Date().toISOString(),
        })
      }
    }

    this.recognition.onspeechend = () => {
      this.speechStartTime = null   // candidate stopped speaking
    }

    this.recognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        onViolation({
          type: 'mic_permission_denied',
          severity: 5,
          timestamp: new Date().toISOString(),
        })
        return
      }
      // All other errors (network, aborted, no-speech): restart after 1 s
      if (this.examActive) setTimeout(() => { try { this.recognition?.start() } catch (_) {} }, 1000)
    }

    // SpeechRecognition stops on silence — restart to keep monitoring
    this.recognition.onend = () => {
      if (this.examActive) {
        try { this.recognition?.start() } catch (_) {}
      }
    }

    try { this.recognition.start() } catch (_) {}
  }

  stop() {
    this.examActive = false
    this.speechStartTime = null
    this.lastViolationTime = {}
    try { this.recognition?.stop() } catch (_) {}
  }
}
