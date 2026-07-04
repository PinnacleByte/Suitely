'use client'

import { useEffect, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '@/lib/AuthContext'
import { ConfirmProvider } from '@/lib/ConfirmDialog'
import { IdentityConfirmProvider } from '@/lib/IdentityConfirm'
import DashboardNav from '@/components/DashboardNav'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/login')
    }
  }, [loading, session, router])

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-400">
        Loading...
      </div>
    )
  }

  return (
    <ConfirmProvider>
      <IdentityConfirmProvider>
        <div className="min-h-screen bg-gray-950">
          <DashboardNav />
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </IdentityConfirmProvider>
    </ConfirmProvider>
  )
}
