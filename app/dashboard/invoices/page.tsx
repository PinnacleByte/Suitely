'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { Invoice } from '@/lib/types'
import { formatIST } from '@/lib/formatDate'
import { formatMoney, CurrencyCode } from '@/lib/currency'
import { printInvoice } from '@/lib/printInvoice'

const STATUS_OPTIONS: Invoice['status'][] = ['issued', 'paid', 'void']
const STATUS_FILTERS: Array<'all' | Invoice['status']> = ['all', ...STATUS_OPTIONS]

const STATUS_BADGE: Record<Invoice['status'], string> = {
  issued: 'bg-blue-500/20 text-blue-300',
  paid: 'bg-emerald-500/20 text-emerald-300',
  void: 'bg-gray-600/30 text-gray-400',
}

// Each invoice's amounts are frozen in its own currency at issue time.
const money = (amount: number, currency: string) =>
  formatMoney(amount, { currency: currency as CurrencyCode })

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Invoice['status']>('all')

  useEffect(() => {
    loadInvoices()
  }, [])

  useRealtimeRefresh(['invoices'], () => loadInvoices())

  const loadInvoices = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const { data } = await supabase
        .from('invoices')
        .select('*')
        .eq('org_id', orgId)
        .order('issued_at', { ascending: false })

      setInvoices((data as Invoice[]) || [])
    } catch (err) {
      console.error('Failed to load invoices:', err)
    } finally {
      setLoading(false)
    }
  }

  const query = searchQuery.trim().toLowerCase()
  const filtered = invoices.filter((inv) => {
    if (statusFilter !== 'all' && inv.status !== statusFilter) return false
    if (!query) return true
    return (
      inv.invoice_number.toLowerCase().includes(query) ||
      inv.snapshot.guest_name.toLowerCase().includes(query)
    )
  })

  return (
    <main className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex flex-col gap-3 mb-8 sm:flex-row sm:justify-between sm:items-start">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-100">Invoices</h1>
          <p className="text-gray-400 mt-2">
            Every issued invoice, frozen at the moment it was created. Voided invoices are kept
            (never deleted) so numbering stays intact.
          </p>
        </div>
        <Link
          href="/dashboard/settings"
          className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
        >
          ← Back to Settings
        </Link>
      </div>

      {!loading && invoices.length > 0 && (
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by invoice # or guest…"
            className="w-full sm:max-w-xs px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => {
              const count =
                filter === 'all'
                  ? invoices.length
                  : invoices.filter((inv) => inv.status === filter).length
              const active = statusFilter === filter
              return (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold capitalize transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {filter === 'all' ? 'All' : filter} ({count})
                </button>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
          Loading...
        </div>
      ) : invoices.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
          No invoices issued yet. Issue one from a reservation&apos;s Folio panel.
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
          No invoices match your search or filter.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg shadow overflow-x-auto">
          <table className="w-full min-w-200">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left text-gray-300 font-semibold">Invoice #</th>
                <th className="px-6 py-3 text-left text-gray-300 font-semibold">Guest</th>
                <th className="px-6 py-3 text-left text-gray-300 font-semibold">Stay</th>
                <th className="px-6 py-3 text-left text-gray-300 font-semibold">Issued</th>
                <th className="px-6 py-3 text-right text-gray-300 font-semibold">Total</th>
                <th className="px-6 py-3 text-right text-gray-300 font-semibold">Balance</th>
                <th className="px-6 py-3 text-left text-gray-300 font-semibold">Status</th>
                <th className="px-6 py-3 text-left text-gray-300 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv, i) => (
                <motion.tr
                  key={inv.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  className="border-t border-gray-800 hover:bg-gray-800"
                >
                  <td className="px-6 py-3 font-semibold text-gray-100 whitespace-nowrap">
                    {inv.invoice_number}
                  </td>
                  <td className="px-6 py-3 text-gray-100">{inv.snapshot.guest_name}</td>
                  <td className="px-6 py-3 text-gray-400 text-sm whitespace-nowrap">
                    Room {inv.snapshot.room_number}
                    <br />
                    {inv.snapshot.check_in_date} → {inv.snapshot.check_out_date}
                  </td>
                  <td className="px-6 py-3 text-gray-400 text-sm whitespace-nowrap">
                    {formatIST(inv.issued_at)}
                  </td>
                  <td className="px-6 py-3 text-right text-gray-100 whitespace-nowrap">
                    {money(Number(inv.total), inv.snapshot.currency)}
                  </td>
                  <td
                    className={`px-6 py-3 text-right whitespace-nowrap ${
                      inv.snapshot.balance_due > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {money(inv.snapshot.balance_due, inv.snapshot.currency)}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-semibold capitalize ${STATUS_BADGE[inv.status]}`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <button
                      onClick={() => printInvoice(inv)}
                      className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
                    >
                      Print
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
