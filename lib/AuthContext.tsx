'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
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

  useEffect(() => {
    let active = true

    const loadProfile = async (session: Session | null) => {
      if (!session) {
        if (active) {
          setProfile(null)
          setLoading(false)
        }
        return
      }

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

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      loadProfile(session)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
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
