// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { subscribeToast, type Toast } from '../toast'

const DURATION = 3800

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    return subscribeToast(toast => {
      setToasts(prev => [...prev, toast])
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id))
      }, DURATION)
    })
  }, [])

  if (!toasts.length) return null

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id))

  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-msg">{t.message}</span>
          {t.action && (
            <button className="toast-action" onClick={() => { t.action!.fn(); dismiss(t.id) }}>
              {t.action.label}
            </button>
          )}
          <button className="toast-close" onClick={() => dismiss(t.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
