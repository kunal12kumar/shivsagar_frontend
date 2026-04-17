/**
 * Reusable Button component with exam-themed variants.
 * Variants: primary (blue), success (green), danger (red), ghost (outline)
 */
import { clsx } from 'clsx'

const variants = {
  primary: 'bg-exam-blue text-white hover:bg-blue-700 active:bg-blue-800',
  success: 'bg-exam-green text-white hover:bg-green-700 active:bg-green-800',
  danger: 'bg-exam-red text-white hover:bg-red-700 active:bg-red-800',
  ghost: 'bg-transparent border border-exam-border text-exam-text hover:bg-gray-100',
  outline: 'bg-white border border-exam-blue text-exam-blue hover:bg-exam-blue-light',
}

export default function Button({ children, variant = 'primary', className, disabled, loading, ...props }) {
  return (
    <button
      className={clsx(
        'px-4 py-2 rounded-lg font-medium text-sm transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-exam-blue focus:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
          </svg>
          {children}
        </span>
      ) : children}
    </button>
  )
}
