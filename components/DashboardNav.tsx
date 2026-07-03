'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ConciergeBell } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import QuickCheckInOut from '@/components/QuickCheckInOut'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/reservations', label: 'Reservations' },
  { href: '/dashboard/rooms', label: 'Rooms' },
  { href: '/dashboard/housekeeping', label: 'Housekeeping' },
  { href: '/dashboard/settings', label: 'Settings' },
]

export default function DashboardNav() {
  const router = useRouter()
  const { profile, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = async () => {
    setMenuOpen(false)
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
          <ConciergeBell className="w-5 h-5 text-indigo-400" /> Suitely
        </Link>

        <div className="flex gap-1 items-center">
          {/* Inline nav links — desktop only */}
          <div className="hidden md:flex gap-1 items-center">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:bg-gray-800 hover:text-white px-3 py-2 rounded-lg transition"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Quick check-in/out — always visible (highest-frequency actions) */}
          <div className="pl-2 md:ml-1 md:border-l md:border-gray-700">
            <QuickCheckInOut />
          </div>

          {/* User + logout — desktop only */}
          {profile && (
            <div className="hidden md:flex items-center gap-3 pl-4 ml-2 border-l border-gray-700">
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

          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            className="md:hidden ml-1 p-2 rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white transition"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {menuOpen ? (
                <>
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </>
              ) : (
                <>
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden overflow-hidden border-t border-gray-800"
          >
            <div className="px-4 py-2 flex flex-col">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="px-3 py-3 rounded-lg hover:bg-gray-800 hover:text-white transition"
                >
                  {link.label}
                </Link>
              ))}
              {profile && (
                <div className="mt-2 pt-3 border-t border-gray-800 flex items-center justify-between">
                  <span className="text-sm text-gray-300 px-3">
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
