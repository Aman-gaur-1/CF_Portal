/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      colors: {
        blue: { DEFAULT: '#3B82F6', light: '#60A5FA', dark: '#2563EB' },
        cyan: { DEFAULT: '#38BDF8', light: '#7DD3FC', dark: '#0284C7' },
        navy: { 950: '#070B14', 900: '#0B1120', 800: '#111827', 700: '#131C2E' },
        slate: { text: '#F8FAFC', muted: '#94A3B8', dim: '#64748B' },
        danger: '#ff6b6b',
      },
      animation: { pulse: 'pulse 2s ease-in-out infinite' },
    },
  },
  plugins: [],
}
