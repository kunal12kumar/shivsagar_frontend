/**
 * GazeTracker — uses MediaPipe FaceMesh (WASM, runs entirely in the browser).
 * Detects look-away events: if candidate's gaze deviates for > 3 seconds → violation.
 * Runs at 10fps. After firing a violation, enters a 15-second cooldown to prevent flooding.
 */
export class GazeTracker {
  constructor() {
    this.faceMesh = null
    this.camera = null
    this.lookAwayStart = null
    this.examActive = false
    this.onViolation = null
    this.videoEl = null

    this.LOOK_AWAY_THRESHOLD_MS = 3000
    this.VIOLATION_COOLDOWN_MS = 15000
    this.GAZE_X_THRESHOLD = 0.15
    this.GAZE_Y_THRESHOLD = 0.12
    this.lastViolationTime = 0
  }

  async start(videoElement, onViolation) {
    this.videoEl = videoElement
    this.onViolation = onViolation
    this.examActive = true

    try {
      const { FaceMesh } = await import('@mediapipe/face_mesh')
      const { Camera } = await import('@mediapipe/camera_utils')

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

      this.camera = new Camera(videoElement, {
        onFrame: async () => {
          if (this.examActive && this.faceMesh) {
            await this.faceMesh.send({ image: videoElement })
          }
        },
        width: 320,
        height: 240,
      })

      await this.camera.start()
    } catch (err) {
      onViolation({ type: 'gaze_tracker_unavailable', severity: 1, message: err.message })
    }
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
    try { this.camera?.stop() } catch (_) {}
  }
}
