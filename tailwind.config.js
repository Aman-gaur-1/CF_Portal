/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      colors: {
        gold: { DEFAULT: '#f5a623', light: '#ffc966', dark: '#d4891a' },
        purple: { DEFAULT: '#6c5ce7', light: '#a29bfe' },
        teal: { DEFAULT: '#00cec9', dark: '#00b894' },
        navy: { 900: '#0a0a1a', 800: '#0d0d24', 700: '#12122a', 600: '#1a1a3e' },
        slate: { text: '#e8e8f0', muted: '#aaaacc', dim: '#666688' },
        danger: '#ff6b6b',
      },
      animation: { pulse: 'pulse 2s ease-in-out infinite' },
    },
  },
  plugins: [],
}
