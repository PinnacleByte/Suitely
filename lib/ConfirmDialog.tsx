'use client'

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// Dark-themed replacement for the browser's native window.confirm/alert,
// exposed as a promise-returning hook so call sites read almost the same as
// before:  if (!(await confirm({ ... }))) return
//
// Mounted once at the dashboard layout so any page can call useConfirm().

type ConfirmOptions = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type AlertOptions = {
  title: string
  message?: string
  okLabel?: string
}

type DialogState =
  | ({ mode: 'confirm' } & ConfirmOptions)
  | ({ mode: 'alert' } & AlertOptions)

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  alert: (options: AlertOptions) => Promise<void>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  // Resolves the promise handed back to the caller when the dialog closes.
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const close = useCallback((result: boolean) => {
    setDialog(null)
    resolver.current?.(result)
    resolver.current = null
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    setDialog({ mode: 'confirm', ...options })
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const alert = useCallback((options: AlertOptions) => {
    setDialog({ mode: 'alert', ...options })
    return new Promise<void>((resolve) => {
      resolver.current = () => resolve()
    })
  }, [])

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}
      <AnimatePresence>
        {dialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
            onClick={() => close(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-lg shadow-xl shadow-black/50 p-6"
            >
              <h2 className="text-lg font-bold text-gray-100">{dialog.title}</h2>
              {dialog.message && (
                <p className="text-sm text-gray-400 mt-2">{dialog.message}</p>
              )}
              <div className="flex justify-end gap-3 mt-6">
                {dialog.mode === 'confirm' && (
                  <button
                    onClick={() => close(false)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 bg-gray-800 hover:bg-gray-700 transition"
                  >
                    {dialog.cancelLabel || 'Cancel'}
                  </button>
                )}
                <button
                  autoFocus
                  onClick={() => close(true)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition ${
                    dialog.mode === 'confirm' && dialog.danger
                      ? 'bg-red-600 hover:bg-red-500'
                      : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {dialog.mode === 'confirm'
                    ? dialog.confirmLabel || 'Confirm'
                    : dialog.okLabel || 'OK'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx
}
