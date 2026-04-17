/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,jsx}",
    "./src/components/**/*.{js,jsx}",
    "./src/app/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        exam: {
          bg: '#F5F4F0',
          card: '#FFFFFF',
          border: '#DDE2E8',
          text: '#1A2332',
          muted: '#5A6B7B',
          navy: '#1A2332',
          blue: '#3A6FA8',
          'blue-light': '#EBF4FF',
          green: '#2D8653',
          'green-light': '#E6F4ED',
          amber: '#B45309',
          'amber-light': '#FEF3C7',
          red: '#C0392B',
          'red-light': '#FEE2E2',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
