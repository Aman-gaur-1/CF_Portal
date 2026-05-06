"use client"
import { useState } from "react"

export function useToast() {
  const [toasts, setToasts] = useState([])
  const show = (message, type = "success") => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }
  return { toasts, success: (m) => show(m, "success"), error: (m) => show(m, "error") }
}

export function ToastContainer({ toasts }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className={"toast toast-" + t.type}>{t.message}</div>
      ))}
    </div>
  )
}