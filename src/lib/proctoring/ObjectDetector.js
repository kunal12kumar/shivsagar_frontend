/**
 * ObjectDetector — COCO-SSD based detection for phones and books during exam.
 *
 * Loads TensorFlow.js + COCO-SSD model from CDN on first use (~6MB, cached).
 * Runs detection every INTERVAL_MS (default 5s) to keep CPU usage low.
 *
 * Flagged objects:
 *   cell phone  → phone_detected    (severity 8)
 *   book        → book_detected     (severity 6)
 *
 * Per-class cooldowns prevent alert spam:
 *   phone_detected  → 20s cooldown
 *   book_detected   → 30s cooldown
 *
 * CONFIDENCE threshold: 0.60 — avoids false positives on ambiguous frames.
 */

const TFJS_CDN    = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js'
const COCOSSD_CDN = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'

const FLAGGED_CLASSES = {
  'cell phone': { type: 'phone_detected', severity: 8 },
  'book':       { type: 'book_detected',  severity: 6 },
}

const COOLDOWNS = {
  phone_detected: 20_000,
  book_detected:  30_000,
}

const CONFIDENCE_THRESHOLD = 0.60
const INTERVAL_MS          = 5_000   // run detection every 5 seconds

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const el = document.createElement('script')
    el.src    = src
    el.onload  = resolve
    el.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(el)
  })
}

export class ObjectDetector {
  constructor() {
    this.model          = null
    this.videoEl        = null
    this.onViolation    = null
    this.examActive     = false
    this.intervalId     = null
    this.lastViolation  = {}  // { violationType: timestampMs }
  }

  async start(videoElement, onViolation) {
    this.videoEl     = videoElement
    this.onViolation = onViolation
    this.examActive  = true

    try {
      // Load TF.js then COCO-SSD sequentially (COCO-SSD depends on window.tf)
      await _loadScript(TFJS_CDN)
      await _loadScript(COCOSSD_CDN)

      if (!window.cocoSsd) throw new Error('COCO-SSD did not attach to window')

      this.model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' })
      console.log('[ObjectDetector] COCO-SSD model loaded')

      // Run immediately, then on interval
      if (this.examActive) {
        this._detect()
        this.intervalId = setInterval(() => this._detect(), INTERVAL_MS)
      }
    } catch (err) {
      console.warn('[ObjectDetector] Failed to initialize:', err.message)
      // Non-fatal — exam continues without object detection
    }
  }

  async _detect() {
    if (!this.examActive || !this.model) return
    if (!this.videoEl || this.videoEl.readyState < 2) return

    try {
      const predictions = await this.model.detect(this.videoEl)

      for (const pred of predictions) {
        const cls    = pred.class.toLowerCase()
        const score  = pred.score
        const config = FLAGGED_CLASSES[cls]

        if (!config || score < CONFIDENCE_THRESHOLD) continue

        const cooldown = COOLDOWNS[config.type] || 20_000
        const last     = this.lastViolation[config.type] || 0
        if (Date.now() - last < cooldown) continue

        this.lastViolation[config.type] = Date.now()
        this.onViolation?.({
          type:       config.type,
          severity:   config.severity,
          object:     pred.class,
          confidence: Math.round(score * 100),
          timestamp:  new Date().toISOString(),
        })
      }
    } catch (err) {
      console.warn('[ObjectDetector] Detection error:', err.message)
    }
  }

  stop() {
    this.examActive = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.model = null
  }
}
