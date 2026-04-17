/**
 * GazeTracker — uses MediaPipe FaceMesh (WASM, runs entirely in the browser).
 * Loads MediaPipe from CDN. Zero server cost.
 * Detects look-away events: if candidate's gaze deviates for > 3 seconds → violation.
 * Runs at 10fps (sufficient for exam proctoring, low CPU impact).
 *
 * NOTE: MediaPipe WASM is loaded dynamically. Internet required on first load.
 * After first load it's cached by the browser.
 */
export class GazeTracker {
  constructor() {
    this.faceMesh = null
    this.camera = null
    this.lookAwayStart = null
    this.examActive = false
    this.LOOK_AWAY_THRESHOLD_MS = 3000 // 3 seconds off-screen = violation
    this.onViolation = null
    this.videoEl = null
  }

  async start(videoElement, onViolation) {
    this.videoEl = videoElement
    this.onViolation = onViolation
    this.examActive = true

    try {
      // Dynamic import of MediaPipe — loaded from CDN
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

  _processResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      // No face detected
      if (!this.lookAwayStart) this.lookAwayStart = Date.now()
      const duration = Date.now() - this.lookAwayStart
      if (duration > this.LOOK_AWAY_THRESHOLD_MS) {
        this.onViolation?.({
          type: 'gaze_deviation',
          severity: 3,
          duration_ms: duration,
          timestamp: new Date().toISOString(),
        })
        this.lookAwayStart = null
      }
      return
    }

    // Face detected — check iris position for gaze direction
    const landmarks = results.multiFaceLandmarks[0]
    // Iris landmarks: 474-477 (left), 469-472 (right)
    const leftIris = landmarks[473] // left iris center
    const rightIris = landmarks[468] // right iris center
    const noseTip = landmarks[1]

    // Simple heuristic: if iris x is far from nose center, candidate is looking away
    const leftOffset = Math.abs(leftIris.x - noseTip.x)
    const rightOffset = Math.abs(rightIris.x - noseTip.x)
    const avgOffset = (leftOffset + rightOffset) / 2

    if (avgOffset > 0.15) {
      // Looking significantly to the side
      if (!this.lookAwayStart) this.lookAwayStart = Date.now()
      const duration = Date.now() - this.lookAwayStart
      if (duration > this.LOOK_AWAY_THRESHOLD_MS) {
        this.onViolation?.({
          type: 'gaze_deviation',
          severity: 3,
          duration_ms: duration,
          timestamp: new Date().toISOString(),
        })
        this.lookAwayStart = null
      }
    } else {
      // Looking at screen — reset timer
      this.lookAwayStart = null
    }
  }

  stop() {
    this.examActive = false
    try { this.camera?.stop() } catch (_) {}
  }
}
