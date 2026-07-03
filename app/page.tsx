'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export default function Home() {
  const [showSetupMessage, setShowSetupMessage] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-4xl mx-auto px-4 py-16"
      >
        <div className="bg-gray-900/80 border border-gray-800 rounded-lg shadow-lg shadow-black/40 p-8 backdrop-blur">
          <h1 className="text-4xl font-bold text-white mb-4 flex items-center gap-3">
            <span>🛎️</span> Suitely
          </h1>
          <p className="text-xl text-gray-400 mb-8">
            Manage reservations, staff, and operations with ease.
          </p>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="bg-blue-500/10 border border-blue-500/20 p-6 rounded-lg">
              <h3 className="text-lg font-semibold text-blue-300 mb-2">
                📅 Reservations
              </h3>
              <p className="text-blue-200/70">
                Manage guest bookings, check-ins, and check-outs
              </p>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 p-6 rounded-lg">
              <h3 className="text-lg font-semibold text-green-300 mb-2">
                👥 Staff Management
              </h3>
              <p className="text-green-200/70">
                Schedule shifts and manage your team
              </p>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 p-6 rounded-lg">
              <h3 className="text-lg font-semibold text-purple-300 mb-2">
                🏠 Room Management
              </h3>
              <p className="text-purple-200/70">
                Track room availability and maintenance
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <motion.a
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              href="/login"
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
            >
              Sign In
            </motion.a>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowSetupMessage(true)}
              className="px-6 py-3 bg-gray-800 text-gray-200 rounded-lg font-semibold hover:bg-gray-700 transition"
            >
              First Time Setup
            </motion.button>
          </div>

          <AnimatePresence>
            {showSetupMessage && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 text-yellow-200/80">
                  Whoa there, early bird. This suite doesn&apos;t check itself in — self-service setup is checked out until further notice. Reach out to support and we&apos;ll have your room key ready.
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
