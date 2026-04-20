/**
 * VoiceMonitor — uses the browser's Web Speech API (built into Chrome/Edge).
 * Zero server cost. Detects:
 *   1. Sustained speech > 5 seconds → 'sustained_speech' violation
 *   2. Voice assistant keywords (Hey Siri, OK Google, Alexa) → 'voice_assistant_keyword' violation
 *
 * IMPORTANT: Only works on Chrome and Edge. Safari/Firefox will get 'speech_api_unavailable' flag.
 * The exam instructions must state: "Use Google Chrome or Microsoft Edge only."
 */
export class VoiceMonitor {
  constructor() {
    this.recognition = null
    this.speechStartTime = null
    this.examActive = false
    this.SPEECH_THRESHOLD_MS = 5000 // 5 seconds of continuous talking = violation
    this.KEYWORDS = [
      // Voice assistants
      'hey siri', 'ok google', 'alexa', 'hey google', 'cortana', 'hey cortana',
      'siri', 'google', 'alexa',
      // AI / LLM tools
      'chatgpt', 'chat gpt', 'gpt', 'claude', 'gemini', 'copilot', 'perplexity',
      'open ai', 'openai', 'bard', 'llm', 'ai answer', 'solve this',
    ]
  }

  start(onViolation) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      onViolation({ type: 'speech_api_unavailable', severity: 1, message: 'Browser does not support speech recognition' })
      return
    }

    this.examActive = true
    this.recognition = new SR()
    this.recognition.continuous = true
    this.recognition.interimResults = true
    this.recognition.lang = 'en-IN' // Indian English for better accuracy

    this.recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript.toLowerCase())
        .join(' ')

      // Check for voice assistant keywords — high severity
      const keyword = this.KEYWORDS.find((k) => transcript.includes(k))
      if (keyword) {
        onViolation({
          type: 'voice_assistant_keyword',
          severity: 8,
          keyword,
          transcript,
          timestamp: new Date().toISOString(),
        })
        return
      }

      // Speech presence detected — start or continue sustained speech timer
      if (!this.speechStartTime) this.speechStartTime = Date.now()
      const duration = Date.now() - this.speechStartTime
      if (duration > this.SPEECH_THRESHOLD_MS) {
        onViolation({
          type: 'sustained_speech',
          severity: 4,
          duration_ms: duration,
          timestamp: new Date().toISOString(),
        })
        this.speechStartTime = null // reset after reporting
      }
    }

    this.recognition.onspeechend = () => {
      this.speechStartTime = null // candidate stopped speaking
    }

    this.recognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        onViolation({ type: 'mic_permission_denied', severity: 5, timestamp: new Date().toISOString() })
      }
      // Restart on all errors (network, aborted, etc.)
      if (this.examActive) setTimeout(() => this.recognition?.start(), 1000)
    }

    // Speech API stops after silence — restart to keep it continuous
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
    try { this.recognition?.stop() } catch (_) {}
  }
}
