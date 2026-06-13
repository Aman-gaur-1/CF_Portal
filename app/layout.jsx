import './globals.css'
import { DM_Mono, Inter, Sora } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
  display: 'swap',
})

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700', '800'],
  display: 'swap',
})

export const metadata = {
  title: 'ConsoleFlare Assignment Portal',
  description: 'Submit assignments, get feedback, track progress',
  icons: { icon: 'https://img.icons8.com/color/96/python--v1.png' },
}

// Runs before React hydrates → no flash on load
const themeScript = `
  (function() {
    try {
      var t = localStorage.getItem('cf_theme') || 'auto';
      if (t !== 'auto') {
        document.documentElement.setAttribute('data-theme', t);
      }
    } catch(e) {}
  })();
`

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} ${dmMono.variable} ${sora.variable}`}>{children}</body>
    </html>
  )
}
