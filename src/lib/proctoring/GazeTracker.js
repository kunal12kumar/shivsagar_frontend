/**
 * GazeTracker — MediaPipe FaceMesh (WASM, runs entirely in the browser).
 *
 * Detects three types of gaze deviation:
 *   1. Horizontal look-away (left/right) — avgXOffset > X_THRESHOLD
 *   2. Upward look-away                  — iris well above nose line
 *   3. Downward look (phone-in-lap)      — iris drops toward/below nose line
 *
 * Violation escalation:
 *   First 2 violations  → severity 3  (warning)
 *   3rd–5th violations  → severity 5  (medium flag)
 *   6th+ violations     → severity 7  (high flag)
 *
 * Thresholds (tighter than original to catch subtle cheating):
 *   X deviation threshold : 0.12  (was 0.15)
 *   Look-away trigger     : 2 000 ms (was 3 000 ms)
 *   Cooldown between flags: 10 000 ms (was 15 000 ms)
 *
 * Downward gaze detection:
 *   In MediaPipe normalized coords, Y increases top→bottom.
 *   Iris is normally ABOVE the nose tip (iris.y < noseTip.y).
 *   When looking DOWN, iris drops toward nose → (noseTip.y - avgIrisY) shrinks.
 *   We flag when this gap < DOWN_THRESHOLD (eyes near or below nose level).
 */
export class GazeTracker {
  constructor() {
    this.faceMesh         = null
    this.lookAwayStart    = null
    this.examActive       = false
    this.onViolation      = null
    this.videoEl          = null
    this.animFrameId      = null
    this.processing       = false
    this.violationCount   = 0        // escalating severity tracker

    // ── Thresholds ────────────────────────────────────────────────────────
    this.LOOK_AWAY_THRESHOLD_MS  = 2000   // trigger after 2 s (was 3 s)
    this.VIOLATION_COOLDOWN_MS   = 10000  // 10 s between violations (was 15 s)
    this.FRAME_INTERVAL_MS       = 100    // ~10 fps

    // Horizontal deviation: average iris X offset from nose tip
    this.GAZE_X_THRESHOLD        = 0.12  // (was 0.15)

    // Vertical — upward: iris rises well above nose (large positive gap)
    this.GAZE_Y_UP_THRESHOLD     = 0.14  // (noseTip.y - iris.y) > 0.14 → looking up

    // Vertical — downward: iris drops close to or below nose line
    // In a normal forward gaze the gap is ~0.07–0.11.
    // < 0.03 means the iris is very close to or below the nose → looking down.
    this.GAZE_Y_DOWN_THRESHOLD   = 0.03

    this.lastViolationTime = 0
    this.lastFrameTime     = 0
  }

  // ── Severity escalation ───────────────────────────────────────────────────
  _nextSeverity() {
    if (this.violationCount < 2)  return 3   // first two: warning
    if (this.violationCount < 5)  return 5   // next three: medium
    return 7                                  // persistent: high
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(videoElement, onViolation) {
    this.videoEl     = videoElement
    this.onViolation = onViolation
    this.examActive  = true

    try {
      const { FaceMesh } = await import('@mediapipe/face_mesh')

      this.faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      })

      this.faceMesh.setOptions({
        maxNumFaces:           2,     // detect up to 2 so we can flag multiple faces
        refineLandmarks:       true,  // enables iris landmarks (468, 473)
        minDetectionConfidence: 0.5,
        minTrackingConfidence:  0.5,
      })

      this.faceMesh.onResults((results) => this._processResults(results))

      if (videoElement.readyState >= 2) {
        this._startFrameLoop()
      } else {
        videoElement.addEventListener('loadeddata', () => this._startFrameLoop(), { once: true })
        setTimeout(() => {
          if (!this.animFrameId && this.examActive) this._startFrameLoop()
        }, 3000)
      }
    } catch (err) {
      console.error('[GazeTracker] Failed to initialize:', err)
      onViolation({
        type: 'gaze_tracker_unavailable',
        severity: 1,
        message: err.message,
        timestamp: new Date().toISOString(),
      })
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

  stop() {
    this.examActive = false
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }
  }

  // ── Violation helpers ─────────────────────────────────────────────────────

  _isInCooldown() {
    return (Date.now() - this.lastViolationTime) < this.VIOLATION_COOLDOWN_MS
  }

  _fireViolation(duration, reason) {
    this.violationCount++
    this.lastViolationTime = Date.now()
    this.lookAwayStart = null
    this.onViolation?.({
      type:        'gaze_deviation',
      severity:    this._nextSeverity(),
      duration_ms: duration,
      reason,                           // 'horizontal' | 'upward' | 'downward' | 'no_face'
      count:       this.violationCount,
      timestamp:   new Date().toISOString(),
    })
  }

  // ── Frame processing ──────────────────────────────────────────────────────

  _processResults(results) {
    if (!this.examActive) return
    if (this._isInCooldown()) {
      this.lookAwayStart = null
      return
    }

    // ── No face detected ────────────────────────────────────────────────────
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (!this.lookAwayStart) this.lookAwayStart = Date.now()
      const duration = Date.now() - this.lookAwayStart
      if (duration > this.LOOK_AWAY_THRESHOLD_MS) {
        this._fireViolation(duration, 'no_face')
      }
      return
    }

    // ── Analyse primary face only ────────────────────────────────────────────
    const landmarks = results.multiFaceLandmarks[0]

    // MediaPipe iris landmarks (only available with refineLandmarks: true)
    const leftIris  = landmarks[473]
    const rightIris = landmarks[468]
    const noseTip   = landmarks[1]

    if (!leftIris || !rightIris || !noseTip) {
      this.lookAwayStart = null
      return
    }

    // ── Horizontal deviation ─────────────────────────────────────────────────
    const xOffsetL    = Math.abs(leftIris.x - noseTip.x)
    const xOffsetR    = Math.abs(rightIris.x - noseTip.x)
    const avgXOffset  = (xOffsetL + xOffsetR) / 2

    // ── Vertical deviation (direction-aware) ──────────────────────────────────
    // gapY = noseTip.y - avgIrisY
    //   large positive → iris high above nose → looking UP
    //   small / negative → iris near/below nose  → looking DOWN
    const avgIrisY    = (leftIris.y + rightIris.y) / 2
    const gapY        = noseTip.y - avgIrisY

    const lookingAway = (
      avgXOffset > this.GAZE_X_THRESHOLD          ||   // left/right
      gapY       > this.GAZE_Y_UP_THRESHOLD       ||   // looking up
      gapY       < this.GAZE_Y_DOWN_THRESHOLD          // looking down (phone in lap)
    )

    // Determine human-readable reason for logging
    const reason = !lookingAway ? 'forward'
      : avgXOffset > this.GAZE_X_THRESHOLD ? 'horizontal'
      : gapY > this.GAZE_Y_UP_THRESHOLD    ? 'upward'
      : 'downward'

    if (lookingAway) {
      if (!this.lookAwayStart) this.lookAwayStart = Date.now()
      const duration = Date.now() - this.lookAwayStart
      if (duration > this.LOOK_AWAY_THRESHOLD_MS) {
        this._fireViolation(duration, reason)
      }
    } else {
      this.lookAwayStart = null
    }
  }
}
