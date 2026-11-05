"use client"
import { useCallback, useRef, useState } from "react"

export function useToast() {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)
  const activeMessages = useRef(new Set())

  const show = useCallback((message, type = "success") => {
    const normalizedMessage = String(message || "").trim()
    if (!normalizedMessage) return

    const messageKey = `${type}:${normalizedMessage}`
    if (activeMessages.current.has(messageKey)) return
    activeMessages.current.add(messageKey)

    const id = `${Date.now()}-${nextId.current++}`
    setToasts(prev => [...prev, { id, message: normalizedMessage, type }])
    setTimeout(() => {
      activeMessages.current.delete(messageKey)
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }, [])

  const success = useCallback(message => show(message, "success"), [show])
  const error = useCallback(message => show(message, "error"), [show])

  return { toasts, success, error }
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
