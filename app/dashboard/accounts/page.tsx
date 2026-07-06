'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  Printer,
  Loader2,
  Lock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { useConfirm } from '@/lib/ConfirmDialog'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { todayIST } from '@/lib/formatDate'
import { formatMoney } from '@/lib/currency'
import { printStatement } from '@/lib/printStatement'
import {
  Reservation,
  ReservationCharge,
  Payment,
  Expense,
  PayrollRun,
  Room,
  Organization,
} from '@/lib/types'
import {
  Granularity,
  StatementInput,
  computeStatement,
  buildTrend,
  periodBounds,
  shiftAnchor,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_META,
  REVENUE_COLOR,
  EXPENSE_COLOR,
  CategoryTotal,
  TrendPoint,
} from '@/lib/accounts'

const money0 = (n: number) => formatMoney(n, { decimals: 0 })

const PAYMENT_METHODS = ['cash', 'card', 'upi', 'bank_transfer', 'other'] as const

type ExpenseForm = {
  category: Expense['category']
  description: string
  amount: string
  vendor: string
  expense_date: string
  payment_method: '' | (typeof PAYMENT_METHODS)[number]
  notes: string
}

const emptyExpenseForm = (): ExpenseForm => ({
  category: 'utilities',
  description: '',
  amount: '',
  vendor: '',
  expense_date: todayIST(),
  payment_method: '',
  notes: '',
})

// ---------------------------------------------------------------------------
// Revenue vs Expenses trend — grouped thin bars, one pair per period.
// Two categorical series (validated blue↔orange, dataviz skill): legend
// present, 2px surface gap between the paired bars, per-bar hover tooltip,
// muted axis labels. Net is the gap between the pair + shown in the tooltip
// and the summary cards, so no number-on-every-bar clutter.
// ---------------------------------------------------------------------------
function RevExpTrend({ points }: { points: TrendPoint[] }) {
  const H = 150 // plot height in px
  const max = Math.max(1, ...points.map((p) => Math.max(p.revenue, p.expenses)))
  const barH = (v: number) => (v <= 0 ? 0 : Math.max(3, Math.round((v / max) * H)))

  return (
    <div>
      <div className="flex items-end gap-2 sm:gap-4" style={{ height: H }}>
        {points.map((p) => (
          <div key={p.from} className="flex-1 flex items-end justify-center gap-0.5 h-full">
            <div
              role="img"
              tabIndex={0}
              aria-label={`${p.label}: revenue ${money0(p.revenue)}`}
              title={`${p.label} — Revenue ${money0(p.revenue)} · Expenses ${money0(p.expenses)} · Net ${money0(p.net)}`}
              className="w-full max-w-6 rounded-t-sm transition-opacity hover:opacity-80 cursor-default"
              style={{ height: barH(p.revenue), backgroundColor: REVENUE_COLOR }}
            />
            <div
              role="img"
              tabIndex={0}
              aria-label={`${p.label}: expenses ${money0(p.expenses)}`}
              title={`${p.label} — Revenue ${money0(p.revenue)} · Expenses ${money0(p.expenses)} · Net ${money0(p.net)}`}
              className="w-full max-w-6 rounded-t-sm transition-opacity hover:opacity-80 cursor-default"
              style={{ height: barH(p.expenses), backgroundColor: EXPENSE_COLOR }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2 sm:gap-4 mt-2 border-t border-gray-800 pt-2">
        {points.map((p) => (
          <div key={p.from} className="flex-1 text-center text-xs text-gray-500 truncate">
            {p.label}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        <LegendDot color={REVENUE_COLOR} label="Revenue" />
        <LegendDot color={EXPENSE_COLOR} label="Expenses" />
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-400">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

// Ranked horizontal composition bars — magnitude by length in a single hue
// (mirrors the AttendanceBar approach on the dashboard). Used for both the
// revenue-by-category and expense-by-category breakdowns.
function CompositionBars({
  rows,
  color,
  emptyLabel,
}: {
  rows: CategoryTotal[]
  color: string
  emptyLabel: string
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.amount)))
  if (rows.length === 0) {
    return <p className="text-gray-500 text-sm">{emptyLabel}</p>
  }
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-300">{r.label}</span>
            <span className="text-gray-100 font-semibold tabular-nums">{formatMoney(r.amount)}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${(Math.abs(r.amount) / max) * 100}%`, backgroundColor: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function AccountsPage() {
  const { profile } = useAuth()
  const { confirm } = useConfirm()

  // Whole section is a manager/owner concern — RLS blocks a staff user's
  // expense reads outright, so gate the page rather than render empty.
  const canView = profile?.role === 'admin' || profile?.role === 'manager'

  const [granularity, setGranularity] = useState<Granularity>('month')
  const [anchor, setAnchor] = useState<string>(todayIST())

  const [org, setOrg] = useState<Organization | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [charges, setCharges] = useState<ReservationCharge[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ExpenseForm>(emptyExpenseForm())

  useEffect(() => {
    loadData()
  }, [])

  useRealtimeRefresh(
    ['reservations', 'reservation_charges', 'payments', 'expenses', 'payroll_runs'],
    () => loadData()
  )

  const loadData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) {
        setError('No organization found. Please run setup first.')
        return
      }
      const [orgRes, resRes, chgRes, payRes, roomRes, expRes, prRes] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', orgId).single(),
        supabase.from('reservations').select('*').eq('org_id', orgId),
        supabase.from('reservation_charges').select('*').eq('org_id', orgId),
        supabase.from('payments').select('*').eq('org_id', orgId),
        supabase.from('rooms').select('*').eq('org_id', orgId),
        supabase.from('expenses').select('*').eq('org_id', orgId),
        supabase.from('payroll_runs').select('*').eq('org_id', orgId),
      ])
      if (orgRes.data) setOrg(orgRes.data as Organization)
      setReservations((resRes.data as Reservation[]) || [])
      setCharges((chgRes.data as ReservationCharge[]) || [])
      setPayments((payRes.data as Payment[]) || [])
      setRooms((roomRes.data as Room[]) || [])
      setExpenses((expRes.data as Expense[]) || [])
      setPayrollRuns((prRes.data as PayrollRun[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts data')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm(emptyExpenseForm())
    setEditingId(null)
    setShowForm(false)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const orgId = localStorage.getItem('orgId')
    if (!orgId) return

    const amount = parseFloat(form.amount)
    if (isNaN(amount) || amount < 0) {
      setError('Enter a valid amount.')
      return
    }

    const payload = {
      org_id: orgId,
      category: form.category,
      description: form.description.trim(),
      amount,
      vendor: form.vendor.trim() || null,
      expense_date: form.expense_date,
      payment_method: form.payment_method || null,
      notes: form.notes.trim() || null,
      recorded_by: profile?.id ?? null,
    }

    const { error: submitError } = editingId
      ? await supabase.from('expenses').update(payload).eq('id', editingId)
      : await supabase.from('expenses').insert([payload])

    if (submitError) {
      setError(submitError.message)
      return
    }
    resetForm()
    loadData()
  }

  const handleEdit = (exp: Expense) => {
    setForm({
      category: exp.category,
      description: exp.description,
      amount: String(exp.amount),
      vendor: exp.vendor ?? '',
      expense_date: exp.expense_date,
      payment_method: (exp.payment_method as ExpenseForm['payment_method']) ?? '',
      notes: exp.notes ?? '',
    })
    setEditingId(exp.id)
    setShowForm(true)
    setError('')
  }

  const handleDelete = async (exp: Expense) => {
    const ok = await confirm({
      title: 'Delete this expense?',
      message: `${EXPENSE_CATEGORY_META[exp.category]?.label} — ${exp.description} (${formatMoney(Number(exp.amount))})`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    const { error: delError } = await supabase.from('expenses').delete().eq('id', exp.id)
    if (delError) {
      setError(delError.message)
      return
    }
    loadData()
  }

  // --- Access gate ---------------------------------------------------------
  // Guard on `profile` being loaded first (the layout only waits for the auth
  // session, not the users-row fetch) so an admin never flashes this panel.
  if (profile && !canView) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Lock className="w-10 h-10 mx-auto text-gray-600 mb-4" />
        <h1 className="text-2xl font-bold text-gray-100 mb-2">Accounts is restricted</h1>
        <p className="text-gray-400">
          Financial reports are available to managers and admins only. Ask an admin if you need access.
        </p>
        <a href="/dashboard/settings" className="inline-block mt-6 text-sm font-semibold text-indigo-400 hover:text-indigo-300">
          ← Back to Settings
        </a>
      </main>
    )
  }

  const input: StatementInput = { reservations, charges, payments, rooms, expenses, payrollRuns }
  const statement = computeStatement(input, anchor, granularity)
  const trendCount = granularity === 'month' ? 6 : 8
  const trend = buildTrend(input, anchor, granularity, trendCount)

  const { to: periodTo } = periodBounds(anchor, granularity)
  const nextDisabled = periodTo >= todayIST()

  const setGran = (g: Granularity) => {
    setGranularity(g)
    setAnchor(todayIST()) // snap back to the current week/month on switch
  }

  const netPositive = statement.net >= 0

  return (
    <main className="max-w-6xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-8">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-100">Accounts</h1>
          <p className="text-gray-400 mt-2">
            Revenue, expenses, and profit &amp; loss — {statement.label}.
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <a href="/dashboard/settings" className="text-sm font-semibold text-indigo-400 hover:text-indigo-300">
            ← Back to Settings
          </a>
          <button
            onClick={() => org && printStatement(statement, org.name)}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
          >
            <Printer className="w-4 h-4" /> Statement
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-500" />
          <p className="text-gray-400 mt-2">Loading…</p>
        </div>
      ) : (
        <>
          {/* Period controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-6">
            <div className="inline-flex rounded-lg border border-gray-800 overflow-hidden self-start">
              {(['week', 'month'] as Granularity[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGran(g)}
                  className={`px-4 py-1.5 text-sm font-semibold capitalize transition ${
                    granularity === g ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  {g === 'week' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                onClick={() => setAnchor(shiftAnchor(anchor, granularity, -1))}
                aria-label="Previous period"
                className="p-2 rounded-lg border border-gray-800 text-gray-300 hover:bg-gray-800 transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="min-w-40 text-center text-sm font-semibold text-gray-200">
                {statement.label}
              </span>
              <button
                onClick={() => !nextDisabled && setAnchor(shiftAnchor(anchor, granularity, 1))}
                disabled={nextDisabled}
                aria-label="Next period"
                className="p-2 rounded-lg border border-gray-800 text-gray-300 hover:bg-gray-800 transition disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* P&L summary */}
          <div className="grid sm:grid-cols-3 gap-4 mb-10">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-gray-400 font-semibold text-sm">Revenue (earned)</h3>
                <TrendingUp className="w-4 h-4" style={{ color: REVENUE_COLOR }} />
              </div>
              <p className="text-3xl font-bold mt-2" style={{ color: REVENUE_COLOR }}>
                {money0(statement.revenue.total)}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Received {formatMoney(statement.revenue.received, { decimals: 0 })} · Outstanding{' '}
                {formatMoney(statement.revenue.outstanding, { decimals: 0 })}
              </p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-gray-400 font-semibold text-sm">Expenses</h3>
                <TrendingDown className="w-4 h-4" style={{ color: EXPENSE_COLOR }} />
              </div>
              <p className="text-3xl font-bold mt-2" style={{ color: EXPENSE_COLOR }}>
                {money0(statement.expenses.total)}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Operating {money0(statement.expenses.total - (statement.expenses.byCategory.find((c) => c.key === 'payroll')?.amount || 0))} · Payroll{' '}
                {money0(statement.expenses.byCategory.find((c) => c.key === 'payroll')?.amount || 0)}
              </p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-gray-400 font-semibold text-sm">
                  {netPositive ? 'Net Profit' : 'Net Loss'}
                </h3>
                <Wallet className={`w-4 h-4 ${netPositive ? 'text-emerald-400' : 'text-red-400'}`} />
              </div>
              <p className={`text-3xl font-bold mt-2 ${netPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {money0(statement.net)}
              </p>
              <p className="text-xs text-gray-500 mt-2">Revenue − expenses this period</p>
            </div>
          </div>

          {/* Trend chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6 mb-10">
            <h2 className="text-xl font-bold text-white mb-1">Revenue vs Expenses</h2>
            <p className="text-sm text-gray-500 mb-5">
              Last {trendCount} {granularity === 'month' ? 'months' : 'weeks'}
            </p>
            <RevExpTrend points={trend} />
          </div>

          {/* Composition */}
          <div className="grid lg:grid-cols-2 gap-6 mb-10">
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
              <h2 className="text-lg font-bold text-white mb-4">Revenue breakdown</h2>
              <CompositionBars
                rows={statement.revenue.byCategory}
                color={REVENUE_COLOR}
                emptyLabel="No revenue in this period."
              />
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
              <h2 className="text-lg font-bold text-white mb-4">Expense breakdown</h2>
              <CompositionBars
                rows={statement.expenses.byCategory}
                color={EXPENSE_COLOR}
                emptyLabel="No expenses in this period."
              />
            </div>
          </div>

          {/* Revenue detail */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow mb-10 overflow-x-auto">
            <div className="p-6 pb-3">
              <h2 className="text-xl font-bold text-white">Revenue detail</h2>
              <p className="text-sm text-gray-500 mt-1">
                Reservations with a stay starting in this period (accrual).
              </p>
            </div>
            {statement.revenue.lines.length === 0 ? (
              <p className="px-6 pb-6 text-gray-500 text-sm">No reservations in this period.</p>
            ) : (
              <table className="w-full min-w-150">
                <thead className="bg-gray-800 text-gray-300">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold">Guest</th>
                    <th className="px-6 py-3 text-left font-semibold">Room</th>
                    <th className="px-6 py-3 text-right font-semibold">Nights</th>
                    <th className="px-6 py-3 text-right font-semibold">Room</th>
                    <th className="px-6 py-3 text-right font-semibold">Extras</th>
                    <th className="px-6 py-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.revenue.lines.map((l) => (
                    <tr key={l.reservationId} className="border-t border-gray-800 hover:bg-gray-800/50">
                      <td className="px-6 py-3 text-gray-100 font-semibold">{l.guest}</td>
                      <td className="px-6 py-3 text-gray-300">{l.room}</td>
                      <td className="px-6 py-3 text-right text-gray-300 tabular-nums">{l.nights}</td>
                      <td className="px-6 py-3 text-right text-gray-300 tabular-nums">{formatMoney(l.roomCharge)}</td>
                      <td className="px-6 py-3 text-right text-gray-300 tabular-nums">{formatMoney(l.extras)}</td>
                      <td className="px-6 py-3 text-right text-gray-100 font-semibold tabular-nums">{formatMoney(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-700 bg-gray-800/40">
                    <td className="px-6 py-3 text-gray-300 font-semibold" colSpan={5}>
                      Total earned
                    </td>
                    <td className="px-6 py-3 text-right font-bold tabular-nums" style={{ color: REVENUE_COLOR }}>
                      {formatMoney(statement.revenue.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Expenses management */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow mb-10">
            <div className="p-6 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
              <div>
                <h2 className="text-xl font-bold text-white">Expenses</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Operating costs. Staff payroll is pulled from finalized payroll runs automatically.
                </p>
              </div>
              <button
                onClick={() => (showForm ? resetForm() : setShowForm(true))}
                className="self-start px-5 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
              >
                {showForm ? 'Cancel' : '+ Add Expense'}
              </button>
            </div>

            <AnimatePresence>
              {showForm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <form onSubmit={handleSubmit} className="grid md:grid-cols-2 gap-4 px-6 pb-6">
                    <div>
                      <label className="block text-gray-300 font-semibold mb-1 text-sm">Category</label>
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value as Expense['category'] })}
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      >
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {EXPENSE_CATEGORY_META[c].label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-gray-300 font-semibold mb-1 text-sm">Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.amount}
                        onChange={(e) => setForm({ ...form, amount: e.target.value })}
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                        required
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-gray-300 font-semibold mb-1 text-sm">Description</label>
                      <input
                        type="text"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="e.g., July electricity bill"
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-gray-300 font-semibold mb-1 text-sm">Date</label>
                      <input
                        type="date"
                        value={form.expense_date}
                        onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-gray-300 font-semibold mb-1 text-sm">Vendor (optional)</label>
                      <input
                        type="text"
                        value={form.vendor}
                        onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-300 font-semibold mb-1 text-sm">Paid via (optional)</label>
                      <select
                        value={form.payment_method}
                        onChange={(e) =>
                          setForm({ ...form, payment_method: e.target.value as ExpenseForm['payment_method'] })
                        }
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      >
                        <option value="">—</option>
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-gray-300 font-semibold mb-1 text-sm">Notes (optional)</label>
                      <input
                        type="text"
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <button
                        type="submit"
                        className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                      >
                        {editingId ? 'Save Changes' : 'Add Expense'}
                      </button>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Payroll (auto) summary line for the period */}
            <div className="px-6 py-3 border-t border-gray-800 flex justify-between items-center text-sm">
              <span className="text-gray-300">
                <span className="font-semibold">Staff payroll</span>
                <span className="text-gray-500"> · from finalized payroll runs (read-only)</span>
              </span>
              <span className="text-gray-100 font-semibold tabular-nums">
                {formatMoney(statement.expenses.byCategory.find((c) => c.key === 'payroll')?.amount || 0)}
              </span>
            </div>

            {/* Operating expense list for the current period */}
            <div className="overflow-x-auto border-t border-gray-800">
              {statement.expenses.lines.length === 0 ? (
                <p className="px-6 py-6 text-gray-500 text-sm">No operating expenses recorded in this period.</p>
              ) : (
                <table className="w-full min-w-150">
                  <thead className="bg-gray-800 text-gray-300">
                    <tr>
                      <th className="px-6 py-3 text-left font-semibold">Date</th>
                      <th className="px-6 py-3 text-left font-semibold">Category</th>
                      <th className="px-6 py-3 text-left font-semibold">Description</th>
                      <th className="px-6 py-3 text-right font-semibold">Amount</th>
                      <th className="px-6 py-3 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.expenses.lines.map((l) => {
                      const exp = expenses.find((e) => e.id === l.id)
                      return (
                        <tr key={l.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                          <td className="px-6 py-3 text-gray-300 tabular-nums">{l.date}</td>
                          <td className="px-6 py-3 text-gray-300">{l.categoryLabel}</td>
                          <td className="px-6 py-3 text-gray-100">
                            {l.description}
                            {l.vendor && <span className="text-gray-500"> · {l.vendor}</span>}
                          </td>
                          <td className="px-6 py-3 text-right text-gray-100 font-semibold tabular-nums">
                            {formatMoney(l.amount)}
                          </td>
                          <td className="px-6 py-3">
                            {exp && (
                              <div className="flex gap-3 text-sm font-semibold">
                                <button onClick={() => handleEdit(exp)} className="text-indigo-400 hover:text-indigo-300">
                                  Edit
                                </button>
                                <button onClick={() => handleDelete(exp)} className="text-red-400 hover:text-red-300">
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
