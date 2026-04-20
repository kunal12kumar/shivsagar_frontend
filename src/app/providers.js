'use client'
import { Toaster } from 'react-hot-toast'

export default function Providers({ children }) {
  return (
    <>
      {children}
      <Toaster
        position="bottom-right"
        reverseOrder={false}
        gutter={10}
        toastOptions={{
          duration: 3500,
          style: {
            borderRadius: '12px',
            padding: '12px 16px',
            fontSize: '14px',
            fontWeight: '500',
            maxWidth: '380px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          },
          success: {
            duration: 3000,
            iconTheme: { primary: '#16a34a', secondary: '#fff' },
            style: {
              background: '#f0fdf4',
              color: '#15803d',
              border: '1px solid #bbf7d0',
            },
          },
          error: {
            duration: 4000,
            iconTheme: { primary: '#dc2626', secondary: '#fff' },
            style: {
              background: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
            },
          },
          loading: {
            style: {
              background: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
            },
          },
        }}
      />
    </>
  )
}
