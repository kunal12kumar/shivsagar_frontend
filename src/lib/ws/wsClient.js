/**
 * WebSocket client wrapper with auto-reconnect.
 * Uses exponential backoff: 1s → 2s → 4s → 8s (max).
 * On reconnect, triggers BULK_SYNC to recover answers from server.
 * This is a singleton — one connection per exam session.
 */

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'

// After this many consecutive failures the client is considered "offline".
// Reconnect attempts continue in the background — if the server comes back
// the status will flip to 'connected' automatically.
const OFFLINE_AFTER_ATTEMPTS = 3

class ExamWebSocket {
  constructor() {
    this.ws = null
    this.handlers = {}
    this.reconnectDelay = 1000
    this.maxDelay = 8000
    this.examActive = false
    this.jwt = null
    this.examId = null
    this.pendingMessages = [] // buffer messages while reconnecting
    this.reconnectAttempts = 0
    this.isOffline = false    // true once OFFLINE_AFTER_ATTEMPTS threshold crossed
  }

  connect(jwt, examId, candidateId) {
    this.jwt = jwt
    this.examId = examId
    this.candidateId = candidateId
    this.examActive = true
    this.reconnectAttempts = 0
    this.isOffline = false
    this._connect()
  }

  _connect() {
    const url = `${WS_BASE}/ws?token=${this.jwt}&examId=${this.examId}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log('[WS] Connected')
      this.reconnectDelay = 1000 // reset backoff
      this.reconnectAttempts = 0
      if (this.isOffline) {
        // Was offline — notify that we recovered
        this.isOffline = false
        this.emit('recovered')
      }
      this.emit('connected')

      // Flush any buffered messages
      while (this.pendingMessages.length > 0) {
        this.ws.send(this.pendingMessages.shift())
      }

      // Request bulk sync to recover server state
      this.send({ type: 'RESUME_REQUEST', candidateId: this.candidateId })
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        this.emit(msg.type, msg)
        this.emit('message', msg) // catch-all
      } catch (_) {}
    }

    this.ws.onclose = () => {
      if (!this.examActive) return
      this.reconnectAttempts += 1
      console.log(
        '[WS] Disconnected — attempt', this.reconnectAttempts,
        '— reconnecting in', this.reconnectDelay, 'ms'
      )
      this.emit('disconnected')

      // Flip to offline mode once threshold is crossed (first time only)
      if (!this.isOffline && this.reconnectAttempts >= OFFLINE_AFTER_ATTEMPTS) {
        this.isOffline = true
        this.emit('unavailable')
        console.warn('[WS] Server unreachable — switching to offline/REST mode')
      }

      setTimeout(() => this._connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay)
    }

    this.ws.onerror = () => {
      this.ws.close()
    }
  }

  send(data) {
    const msg = JSON.stringify(data)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg)
    } else {
      this.pendingMessages.push(msg) // buffer for reconnect
    }
  }

  sendAnswer(questionId, answer, examId) {
    this.send({ type: 'ANSWER_SUBMIT', questionId, answer, examId })
  }

  sendViolation(violation) {
    this.send({ type: 'VIOLATION', ...violation })
  }

  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = []
    this.handlers[event].push(handler)
    return () => this.off(event, handler)
  }

  off(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter((h) => h !== handler)
    }
  }

  emit(event, data) {
    this.handlers[event]?.forEach((h) => h(data))
  }

  disconnect() {
    this.examActive = false
    this.ws?.close()
  }
}

// Export singleton
const wsClient = new ExamWebSocket()
export default wsClient
