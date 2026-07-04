'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { User } from '@/lib/types'

// Stage 4 — shared-terminal identity confirmation.
// Promise-based, mounted once in the dashboard layout (like ConfirmProvider).
// A call site does:
//   const actor = await confirmIdentity({ action: 'check_out', entityId })
//   if (!actor) return   // cancelled or wrong password
// The staffer picks their name + enters their password; the server verifies it
// and records who authorized the action (see app/api/confirm-identity).

export type ConfirmAction = 'book' | 'check_in' | 'check_out' | 'payment' | 'invoice'

const ACTION_LABEL: Record<ConfirmAction, string> = {
  book: 'create this booking',
  check_in: 'check this guest in',
  check_out: 'check this guest out',
  payment: 'record this payment',
  invoice: 'issue this invoice',
}

type ConfirmedActor = { userId: string; name: string }

type ConfirmRequest = { action: ConfirmAction; entityId?: string | null }

type IdentityContextValue = {
  confirmIdentity: (req: ConfirmRequest) => Promise<ConfirmedActor | null>
}

const IdentityContext = createContext<IdentityContextValue | null>(null)

export function IdentityConfirmProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [staff, setStaff] = useState<User[]>([])
  const [selectedEmail, setSelectedEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const resolver = useRef<((value: ConfirmedActor | null) => void) | null>(null)

  // Staff list for the "who are you" dropdown. Loaded once; the list changes
  // rarely and a stale entry just means re-opening Staff, not a correctness bug.
  useEffect(() => {
    const load = async () => {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('org_id', orgId)
        .order('name')
      setStaff((data as User[]) || [])
    }
    load()
  }, [])

  const close = useCallback((value: ConfirmedActor | null) => {
    setRequest(null)
    setPassword('')
    setError('')
    setSubmitting(false)
    resolver.current?.(value)
    resolver.current = null
  }, [])

  const confirmIdentity = useCallback((req: ConfirmRequest) => {
    setRequest(req)
    setPassword('')
    setError('')
    return new Promise<ConfirmedActor | null>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!request) return
    setError('')

    if (!selectedEmail) {
      setError('Select your name.')
      return
    }
    if (!session) {
      setError('Session expired — sign in again.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/confirm-identity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: selectedEmail,
          password,
          action: request.action,
          entityId: request.entityId ?? null,
        }),
      })
      const result = await res.json()

      if (!res.ok) {
        setError(result.error || 'Could not confirm identity.')
        setSubmitting(false)
        return
      }

      close({ userId: result.userId, name: result.name })
    } catch {
      setError('Could not reach the server. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <IdentityContext.Provider value={{ confirmIdentity }}>
      {children}
      <AnimatePresence>
        {request && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
            onClick={() => close(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-lg shadow-xl shadow-black/50 p-6"
            >
              <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-400" /> Confirm your identity
              </h2>
              <p className="text-sm text-gray-400 mt-2">
                Enter your password to {ACTION_LABEL[request.action]}. This records who is
                responsible for the action.
              </p>

              {error && (
                <div className="mt-4 px-3 py-2 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                <div>
                  <label className="block text-gray-400 text-xs font-semibold mb-1">
                    Your name
                  </label>
                  <select
                    value={selectedEmail}
                    onChange={(e) => setSelectedEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                  >
                    <option value="">Select…</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.email}>
                        {s.name} ({s.role})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs font-semibold mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => close(null)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 bg-gray-800 hover:bg-gray-700 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition disabled:opacity-50"
                  >
                    {submitting ? 'Confirming…' : 'Confirm'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </IdentityContext.Provider>
  )
}

export function useIdentityConfirm() {
  const ctx = useContext(IdentityContext)
  if (!ctx) throw new Error('useIdentityConfirm must be used within an IdentityConfirmProvider')
  return ctx
}
