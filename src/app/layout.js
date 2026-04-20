import './globals.css'
import Providers from './providers'

export const metadata = {
  title: 'RGIPT Exam Portal',
  description: 'AI-Proctored Online Examination System',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
