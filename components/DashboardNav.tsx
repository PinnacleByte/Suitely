'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { useAuth } from '@/lib/AuthContext'
import QuickCheckInOut from '@/components/QuickCheckInOut'

export default function DashboardNav() {
  const router = useRouter()
  const { profile, signOut } = useAuth()

  const handleLogout = async () => {
    await signOut()
    router.push('/login')
  }

  return (
    <motion.nav
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="bg-gray-900 border-b border-gray-800 text-gray-200 sticky top-0 z-10"
    >
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link
          href="/dashboard"
          className="text-xl font-bold text-white flex items-center gap-2 hover:text-indigo-400 transition"
        >
          <span>🛎️</span> Suitely
        </Link>
        <div className="flex gap-1 items-center">
          <Link
            href="/dashboard"
            className="hover:bg-gray-800 hover:text-white px-3 py-2 rounded-lg transition"
          >
            Dashboard
          </Link>
          <Link
            href="/dashboard/reservations"
            className="hover:bg-gray-800 hover:text-white px-3 py-2 rounded-lg transition"
          >
            Reservations
          </Link>
          <Link
            href="/dashboard/rooms"
            className="hover:bg-gray-800 hover:text-white px-3 py-2 rounded-lg transition"
          >
            Rooms
          </Link>
          <Link
            href="/dashboard/housekeeping"
            className="hover:bg-gray-800 hover:text-white px-3 py-2 rounded-lg transition"
          >
            Housekeeping
          </Link>
          <Link
            href="/dashboard/settings"
            className="hover:bg-gray-800 hover:text-white px-3 py-2 rounded-lg transition"
          >
            Settings
          </Link>
          <div className="pl-2 ml-1 border-l border-gray-700">
            <QuickCheckInOut />
          </div>
          {profile && (
            <div className="flex items-center gap-3 pl-4 ml-2 border-l border-gray-700">
              <span className="text-sm text-gray-300">
                {profile.name}{' '}
                <span className="text-indigo-400 capitalize">({profile.role})</span>
              </span>
              <button
                onClick={handleLogout}
                className="text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-white px-3 py-2 rounded-lg transition"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.nav>
  )
}
