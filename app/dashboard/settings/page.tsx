'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ShoppingBag, History, Users, FileText, Wallet, Calculator } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { CURRENCIES, CurrencyCode, DEFAULT_CURRENCY, getCurrencyCode } from '@/lib/currency'

// `managerOnly` links only render for admin/manager (RLS also blocks the
// page's reads for staff — the gate here is UX, hiding a card that would 403).
type SettingsLink = {
  href: string
  icon: LucideIcon
  title: string
  description: string
  managerOnly?: boolean
}

const SETTINGS_LINKS: SettingsLink[] = [
  {
    href: '/dashboard/accounts',
    icon: Calculator,
    title: 'Accounts',
    description: 'Revenue, expenses, and profit & loss — weekly/monthly stats and printable statements. Managers only.',
    managerOnly: true,
  },
  {
    href: '/dashboard/items',
    icon: ShoppingBag,
    title: 'Items',
    description: "Manage the priced catalog (minibar, amenities, kits) staff can add to a guest's folio.",
  },
  {
    href: '/dashboard/invoices',
    icon: FileText,
    title: 'Invoices',
    description: 'Browse issued invoices — number, guest, total, and paid/outstanding status.',
  },
  {
    href: '/dashboard/reservations/activity',
    icon: History,
    title: 'Activity Log',
    description: 'Browse every reservation and folio change — who did what, and when.',
  },
  {
    href: '/dashboard/staff',
    icon: Users,
    title: 'Staff',
    description: 'Manage staff accounts, shift schedules, attendance, and leave requests.',
  },
  {
    href: '/dashboard/payroll',
    icon: Wallet,
    title: 'Payroll',
    description: 'Set pay rates and run payroll — everyone sees only their own, managers see all.',
  },
]

// Lets an admin pick the currency all prices display in. Persists to
// organizations.currency and mirrors the choice into localStorage so the
// rest of the app (lib/currency.ts) picks it up without a re-login.
function CurrencySetting() {
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) {
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('organizations')
        .select('currency')
        .eq('id', orgId)
        .single()

      // Fall back to whatever's already mirrored locally, then USD.
      const code = (data?.currency as CurrencyCode) || getCurrencyCode()
      if (code in CURRENCIES) setCurrency(code)
      setLoading(false)
    }
    load()
  }, [])

  const handleChange = async (next: CurrencyCode) => {
    const orgId = localStorage.getItem('orgId')
    if (!orgId) return

    setCurrency(next)
    setSaving(true)
    setSaved(false)
    setError('')

    const { error: updateError } = await supabase
      .from('organizations')
      .update({ currency: next })
      .eq('id', orgId)

    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }

    localStorage.setItem('currency', next)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6 mb-8">
      <h2 className="text-lg font-bold text-gray-100 mb-1">Display Currency</h2>
      <p className="text-sm text-gray-400 mb-4">
        The currency all prices are shown in across the app. Changing it only affects
        how amounts are displayed — stored values are unchanged.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={currency}
          disabled={loading || saving}
          onChange={(e) => handleChange(e.target.value as CurrencyCode)}
          className="w-full sm:w-72 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
        >
          {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => (
            <option key={code} value={code}>
              {CURRENCIES[code].label}
            </option>
          ))}
        </select>
        {saving && <span className="text-sm text-gray-400">Saving…</span>}
        {saved && <span className="text-sm text-green-400">✓ Saved</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { profile } = useAuth()
  // Org settings (currency) are admin-only (RLS-enforced). Non-admins still
  // reach this hub for the links below, just without the currency control.
  const isAdmin = profile?.role === 'admin'
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const links = SETTINGS_LINKS.filter((l) => !l.managerOnly || canManage)

  return (
    <main className="max-w-5xl mx-auto px-4 py-12">
      <h1 className="text-3xl sm:text-4xl font-bold text-gray-100 mb-2">Settings</h1>
      <p className="text-gray-400 mb-8">Less frequently used management and admin tools.</p>

      {isAdmin && <CurrencySetting />}

      <div className="grid md:grid-cols-3 gap-6">
        {links.map((link, i) => (
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
              <link.icon className="w-8 h-8 mb-3 text-indigo-400" />
              <h2 className="text-lg font-bold text-gray-100 mb-1">{link.title}</h2>
              <p className="text-sm text-gray-400">{link.description}</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </main>
  )
}
