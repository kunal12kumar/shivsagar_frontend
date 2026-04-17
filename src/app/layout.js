import './globals.css'

export const metadata = {
  title: 'RGIPT Exam Portal',
  description: 'AI-Proctored Online Examination System',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
