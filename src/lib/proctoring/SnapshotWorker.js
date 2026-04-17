/**
 * SnapshotWorker — captures webcam snapshots every 2 minutes.
 * Compresses to JPEG quality 60%, max 320×240px, ~15KB each.
 * Uploads to S3 via the FastAPI /snapshots endpoint (async, non-blocking).
 * If upload fails, retries once after 30s. Exam continues regardless.
 *
 * Bandwidth: 15KB × 90 snapshots = ~1.35MB over 3 hours (negligible).
 */
import apiClient from '../api/client'

export class SnapshotWorker {
  constructor() {
    this.intervalId = null
    this.videoEl = null
    this.examId = null
    this.candidateId = null
    this.INTERVAL_MS = 2 * 60 * 1000 // every 2 minutes
    this.canvas = null
  }

  start(videoElement, examId, candidateId) {
    this.videoEl = videoElement
    this.examId = examId
    this.candidateId = candidateId

    // Create offscreen canvas for image capture
    this.canvas = document.createElement('canvas')
    this.canvas.width = 320
    this.canvas.height = 240

    // Take first snapshot immediately, then every 2 minutes
    this._capture()
    this.intervalId = setInterval(() => this._capture(), this.INTERVAL_MS)
  }

  async _capture() {
    if (!this.videoEl || this.videoEl.readyState < 2) return
    try {
      const ctx = this.canvas.getContext('2d')
      ctx.drawImage(this.videoEl, 0, 0, 320, 240)

      // Convert to Blob (JPEG quality 0.6 = ~15KB)
      const blob = await new Promise((resolve) =>
        this.canvas.toBlob(resolve, 'image/jpeg', 0.6)
      )
      if (!blob) return

      // Upload asynchronously — exam is not affected if this fails
      await this._upload(blob)
    } catch (_) {
      // Silent failure — exam must never stop for a snapshot error
    }
  }

  async _upload(blob, retry = true) {
    try {
      const form = new FormData()
      form.append('snapshot', blob, `snapshot_${Date.now()}.jpg`)
      form.append('candidateId', this.candidateId)
      await apiClient.post(`/exams/${this.examId}/snapshots`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      })
    } catch (_) {
      if (retry) {
        // Retry once after 30 seconds
        setTimeout(() => this._upload(blob, false), 30000)
      }
    }
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId)
  }
}
