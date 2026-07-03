'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

const SETTINGS_LINKS = [
  {
    href: '/dashboard/items',
    icon: '🧴',
    title: 'Items',
    description: "Manage the priced catalog (minibar, amenities, kits) staff can add to a guest's folio.",
  },
  {
    href: '/dashboard/reservations/activity',
    icon: '📜',
    title: 'Activity Log',
    description: 'Browse every reservation and folio change — who did what, and when.',
  },
  {
    href: '/dashboard/staff',
    icon: '👥',
    title: 'Staff',
    description: 'Manage staff accounts and shift schedules.',
  },
]

export default function SettingsPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold text-gray-100 mb-2">Settings</h1>
      <p className="text-gray-400 mb-8">Less frequently used management and admin tools.</p>

      <div className="grid md:grid-cols-3 gap-6">
        {SETTINGS_LINKS.map((link, i) => (
          <motion.div
            key={link.href}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
          >
            <Link
              href={link.href}
              className="block h-full bg-gray-900 border border-gray-800 rounded-lg shadow p-6 hover:border-gray-700 hover:shadow-lg transition"
            >
              <div className="text-3xl mb-3">{link.icon}</div>
              <h2 className="text-lg font-bold text-gray-100 mb-1">{link.title}</h2>
              <p className="text-sm text-gray-400">{link.description}</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </main>
  )
}
