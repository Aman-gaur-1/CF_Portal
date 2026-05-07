import './globals.css'

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
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
