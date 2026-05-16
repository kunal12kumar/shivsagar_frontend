'use client'
import dynamic from 'next/dynamic'

// Load the full exam UI only on the client.
// ssr: false prevents Next.js from rendering this on the server, which would
// fail with a TDZ error caused by the circular wsClient import chain
// (exam page ↔ AntiCheatWrapper both import wsClient at module level).
const ExamContent = dynamic(
  () => import('@/components/exam/ExamContent'),
  { ssr: false }
)

export default function ExamPage() {
  return <ExamContent />
}
