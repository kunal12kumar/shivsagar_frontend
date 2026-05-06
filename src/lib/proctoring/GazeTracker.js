/**
 * GazeTracker — uses MediaPipe FaceMesh (WASM, runs entirely in the browser).
 * Detects look-away events: if candidate's gaze deviates for > 3 seconds → violation.
 * Uses requestAnimationFrame loop at ~10fps instead of MediaPipe Camera utility
 * for more reliable frame feeding.
 */
export class GazeTracker {
  constructor() {
    this.faceMesh = null
    this.lookAwayStart = null
    this.examActive = false
    this.onViolation = null
    this.videoEl = null
    this.animFrameId = null
    this.processing = false

    this.LOOK_AWAY_THRESHOLD_MS = 3000
    this.VIOLATION_COOLDOWN_MS = 15000
    this.GAZE_X_THRESHOLD = 0.15
    this.GAZE_Y_THRESHOLD = 0.12
    this.FRAME_INTERVAL_MS = 100  // ~10fps
    this.lastViolationTime = 0
    this.lastFrameTime = 0
  }

  async start(videoElement, onViolation) {
    this.videoEl = videoElement
    this.onViolation = onViolation
    this.examActive = true

    try {
      const { FaceMesh } = await import('@mediapipe/face_mesh')

      this.faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      })

      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })

      this.faceMesh.onResults((results) => this._processResults(results))

      // Wait for video to be ready before starting frame loop
      if (videoElement.readyState >= 2) {
        this._startFrameLoop()
      } else {
        videoElement.addEventListener('loadeddata', () => this._startFrameLoop(), { once: true })
        // Fallback: start after 3s even if loadeddata doesn't fire
        setTimeout(() => {
          if (!this.animFrameId && this.examActive) this._startFrameLoop()
        }, 3000)
      }
    } catch (err) {
      console.error('[GazeTracker] Failed to initialize:', err)
      onViolation({ type: 'gaze_tracker_unavailable', severity: 1, message: err.message })
    }
  }

  _startFrameLoop() {
    if (this.animFrameId) return
    console.log('[GazeTracker] Frame loop started')
    this._tick()
  }

  _tick() {
    if (!this.examActive) return
    this.animFrameId = requestAnimationFrame(() => this._tick())

    const now = Date.now()
    if (now - this.lastFrameTime < this.FRAME_INTERVAL_MS) return
    this.lastFrameTime = now

    if (this.processing) return
    if (!this.videoEl || this.videoEl.readyState < 2) return

    this.processing = true
    this.faceMesh.send({ image: this.videoEl })
      .then(() => { this.processing = false })
      .catch(() => { this.processing = false })
  }

  _isInCooldown() {
    return (Date.now() - this.lastViolationTime) < this.VIOLATION_COOLDOWN_MS
  }

  _fireViolation(duration) {
    this.lastViolationTime = Date.now()
    this.lookAwayStart = null
    this.onViolation?.({
      type: 'gaze_deviation',
      severity: 3,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    })
  }

  _processResults(results) {
    if (!this.examActive) return
    if (this._isInCooldown()) {
      this.lookAwayStart = null
      return
    }

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (!this.lookAwayStart) this.lookAwayStart = Date.now()
      const duration = Date.now() - this.lookAwayStart
      if (duration > this.LOOK_AWAY_THRESHOLD_MS) {
        this._fireViolation(duration)
      }
      return
    }

    const landmarks = results.multiFaceLandmarks[0]
    const leftIris  = landmarks[473]
    const rightIris = landmarks[468]
    const noseTip   = landmarks[1]

    const xOffsetL = Math.abs(leftIris.x - noseTip.x)
    const xOffsetR = Math.abs(rightIris.x - noseTip.x)
    const avgXOffset = (xOffsetL + xOffsetR) / 2

    const yOffsetL = Math.abs(leftIris.y - noseTip.y)
    const yOffsetR = Math.abs(rightIris.y - noseTip.y)
    const avgYOffset = (yOffsetL + yOffsetR) / 2

    const isLookingAway = avgXOffset > this.GAZE_X_THRESHOLD || avgYOffset > this.GAZE_Y_THRESHOLD

    if (isLookingAway) {
      if (!this.lookAwayStart) this.lookAwayStart = Date.now()
      const duration = Date.now() - this.lookAwayStart
      if (duration > this.LOOK_AWAY_THRESHOLD_MS) {
        this._fireViolation(duration)
      }
    } else {
      this.lookAwayStart = null
    }
  }

  stop() {
    this.examActive = false
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }
  }
}
