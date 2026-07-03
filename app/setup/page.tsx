'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConciergeBell, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { CURRENCIES, CurrencyCode, DEFAULT_CURRENCY } from '@/lib/currency'

const SETUP_ENABLED = process.env.NEXT_PUBLIC_SETUP_ENABLED === 'true'

export default function SetupPage() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [orgCurrency, setOrgCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY)
  const [managerName, setManagerName] = useState('')
  const [managerEmail, setManagerEmail] = useState('')
  const [managerPassword, setManagerPassword] = useState('')
  const [adminUserId, setAdminUserId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]/g, '')
  }

  // Step 1: create the hotel admin's real login. This must happen before
  // the organization is created, since RLS requires an authenticated user
  // to insert into `organizations`.
  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: managerEmail,
        password: managerPassword,
      })

      if (signUpError) throw signUpError
      if (!data.session) {
        throw new Error(
          'Account created, but no session was returned. Make sure "Confirm email" is disabled in the Supabase Auth settings.'
        )
      }

      setAdminUserId(data.session.user.id)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: create the hotel (organization) and link the admin's profile row.
  const handleOrgSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data, error: orgError } = await supabase
        .from('organizations')
        .insert([{ name: orgName, slug: orgSlug, currency: orgCurrency }])
        .select()

      if (orgError) throw orgError
      if (!data || data.length === 0) throw new Error('Failed to create organization')

      const orgId = data[0].id
      localStorage.setItem('orgId', orgId)
      localStorage.setItem('currency', orgCurrency)

      const { error: userError } = await supabase.from('users').insert([
        {
          id: adminUserId,
          org_id: orgId,
          email: managerEmail,
          name: managerName,
          role: 'admin',
        },
      ])

      if (userError) throw userError
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (!SETUP_ENABLED) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 py-12 px-4 flex items-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="max-w-md mx-auto w-full bg-gray-900 border border-gray-800 rounded-lg shadow-lg shadow-black/40 p-8 text-center"
        >
          <h1 className="text-2xl font-bold text-white mb-4 flex items-center justify-center gap-2">
            <ConciergeBell className="w-6 h-6 text-indigo-400" /> Suitely Setup
          </h1>
          <p className="text-gray-400 mb-6">
            Self-service setup is currently unavailable. If you&apos;re interested in Suitely for your hotel, please contact us to get your account provisioned.
          </p>
          <a
            href="/login"
            className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
          >
            Back to Sign In
          </a>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 py-12 px-4 flex items-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-md mx-auto w-full bg-gray-900 border border-gray-800 rounded-lg shadow-lg shadow-black/40 p-8"
      >
        <h1 className="text-2xl font-bold text-white mb-8 flex items-center gap-2">
          <ConciergeBell className="w-6 h-6 text-indigo-400" /> Suitely Setup
        </h1>

        {success ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6"
          >
            <h2 className="text-lg font-semibold text-green-300 mb-2 flex items-center gap-2">
              <Check className="w-5 h-5" /> Setup Complete!
            </h2>
            <p className="text-green-200/80 mb-4">
              Your hotel management system is ready to use.
            </p>
            <a
              href="/dashboard"
              className="block text-center px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-500 transition"
            >
              Go to Dashboard
            </a>
          </motion.div>
        ) : (
          <>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6 text-red-300"
              >
                {error}
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.form
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  onSubmit={handleAdminSubmit}
                >
                  <p className="text-gray-400 mb-6">
                    First, create your own admin login for the hotel.
                  </p>
                  <div className="mb-4">
                    <label className="block text-gray-300 font-semibold mb-2">
                      Your Name
                    </label>
                    <input
                      type="text"
                      value={managerName}
                      onChange={(e) => setManagerName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-100 placeholder-gray-500"
                      required
                    />
                  </div>
                  <div className="mb-4">
                    <label className="block text-gray-300 font-semibold mb-2">
                      Your Email
                    </label>
                    <input
                      type="email"
                      value={managerEmail}
                      onChange={(e) => setManagerEmail(e.target.value)}
                      placeholder="john@example.com"
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-100 placeholder-gray-500"
                      required
                    />
                  </div>
                  <div className="mb-6">
                    <label className="block text-gray-300 font-semibold mb-2">
                      Password
                    </label>
                    <input
                      type="password"
                      value={managerPassword}
                      onChange={(e) => setManagerPassword(e.target.value)}
                      minLength={6}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-100 placeholder-gray-500"
                      required
                    />
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition disabled:bg-gray-700 disabled:text-gray-400"
                  >
                    {loading ? 'Creating...' : 'Next Step'}
                  </motion.button>
                </motion.form>
              ) : (
                <motion.form
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  onSubmit={handleOrgSubmit}
                >
                  <p className="text-gray-400 mb-6">
                    Now, tell us about your hotel.
                  </p>
                  <div className="mb-4">
                    <label className="block text-gray-300 font-semibold mb-2">
                      Hotel Name
                    </label>
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => {
                        setOrgName(e.target.value)
                        setOrgSlug(generateSlug(e.target.value))
                      }}
                      placeholder="e.g., Grand Hotel"
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-100 placeholder-gray-500"
                      required
                    />
                  </div>
                  <div className="mb-6">
                    <label className="block text-gray-300 font-semibold mb-2">
                      URL Slug
                    </label>
                    <input
                      type="text"
                      value={orgSlug}
                      onChange={(e) => setOrgSlug(e.target.value)}
                      placeholder="grand-hotel"
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-100 placeholder-gray-500"
                      required
                    />
                    <p className="text-sm text-gray-500 mt-1">
                      URL-friendly name (auto-generated from hotel name). Example: grand-hotel
                    </p>
                  </div>
                  <div className="mb-6">
                    <label className="block text-gray-300 font-semibold mb-2">
                      Currency
                    </label>
                    <select
                      value={orgCurrency}
                      onChange={(e) => setOrgCurrency(e.target.value as CurrencyCode)}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-100"
                    >
                      {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => (
                        <option key={code} value={code}>
                          {CURRENCIES[code].label}
                        </option>
                      ))}
                    </select>
                    <p className="text-sm text-gray-500 mt-1">
                      The currency all your prices will display in. You can change this later in Settings.
                    </p>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition disabled:bg-gray-700 disabled:text-gray-400"
                  >
                    {loading ? 'Creating...' : 'Complete Setup'}
                  </motion.button>
                </motion.form>
              )}
            </AnimatePresence>
          </>
        )}
      </motion.div>
    </div>
  )
}
