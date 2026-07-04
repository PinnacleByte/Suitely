'use client'

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

type AuthContextValue = {
  session: Session | null
  profile: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  loading: true,
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  // Tracks the last user we actually loaded a profile for, and whether we've
  // handled the first auth event yet. Supabase re-emits auth events on tab
  // focus / token refresh; without this guard those re-emits would flip
  // `loading` back on, unmounting the dashboard (see the layout guard) and
  // wiping any in-progress form state — e.g. a half-entered reservation the
  // user stepped away from to fetch an ID number out of their email.
  const lastUserId = useRef<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    let active = true

    const loadProfile = async (session: Session | null) => {
      if (!session) {
        lastUserId.current = null
        if (active) {
          setProfile(null)
          setLoading(false)
        }
        return
      }

      lastUserId.current = session.user.id

      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (!active) return

      const userProfile = (data as User) || null
      setProfile(userProfile)
      if (userProfile) {
        localStorage.setItem('orgId', userProfile.org_id)

        // Mirror the org's currency into localStorage so money can be
        // formatted anywhere without threading the org through props
        // (see lib/currency.ts) — same pattern as orgId.
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('currency')
          .eq('id', userProfile.org_id)
          .single()

        if (active && orgRow?.currency) {
          localStorage.setItem('currency', orgRow.currency)
        }
      }
      setLoading(false)
    }

    // onAuthStateChange fires an initial event on subscribe (so no separate
    // getSession() call is needed) and again on every later auth change.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUserId = session?.user?.id ?? null
      setSession(session)

      // Skip the expensive reload (and the loading flip that unmounts the app)
      // when the user identity is unchanged — i.e. a token refresh or a
      // tab-focus re-emit. Only react to a real sign-in / sign-out / switch.
      if (initialized.current && newUserId === lastUserId.current) return

      initialized.current = true
      setLoading(true)
      loadProfile(session)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem('orgId')
    localStorage.removeItem('currency')
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
