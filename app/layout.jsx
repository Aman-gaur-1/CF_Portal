import './globals.css'

export const metadata = {
  title: 'ConsoleFlare Assignment Portal',
  description: 'Submit assignments, get feedback, track progress',
  icons: { icon: 'https://img.icons8.com/color/96/python--v1.png' },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
