import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type ToastVariant = 'success' | 'error' | 'info' | 'warning'

export type Toast = {
  id: string
  title?: string
  message: string
  variant?: ToastVariant
  durationMs?: number
}

type ToastContextValue = {
  toasts: Toast[]
  showToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    const duration = toast.durationMs ?? 4000
    const newToast: Toast = { id, ...toast }
    setToasts((prev) => [...prev, newToast])
    if (duration > 0) {
      window.setTimeout(() => dismissToast(id), duration)
    }
  }, [dismissToast])

  const value = useMemo(() => ({ toasts, showToast, dismissToast }), [toasts, showToast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  )
}

const variantClasses: Record<ToastVariant, string> = {
  success: 'bg-emerald-900 text-white border-border-muted',
  error: 'bg-red-900 text-white border-border-muted',
  info: 'bg-slate-800 text-white border-border-muted',
  warning: 'bg-yellow-900 text-white border-border-muted',
}

const variantIcons: Record<ToastVariant, string> = {
  success: 'fa-solid fa-check-circle',
  error: 'fa-solid fa-exclamation-circle',
  info: 'fa-solid fa-info-circle',
  warning: 'fa-solid fa-triangle-exclamation',
}

export const Toaster: React.FC = () => {
  const { toasts, dismissToast } = useToast()
  return (
    <div className="fixed inset-0 pointer-events-none z-[999]">
      <div className="absolute right-4 bottom-4 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-sm border px-8 py-4 shadow-lg ${variantClasses[t.variant ?? 'info']}`}
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 mt-0.5">
                <i className={`${variantIcons[t.variant ?? 'info']} text-lg`}></i>
              </div>
              <div className="flex-1">
                {t.title ? <div className="text-md text-left font-bold text-foreground">{t.title}</div> : null}
                <div className="text-md text-left text-foreground leading-snug">{t.message}</div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="text-foreground/80 hover:text-foreground"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


