// Shared accounting/P&L computation — the single source of truth for the
// Accounts section's money math, reused by the Accounts page, its trend
// chart, and the printable statement (lib/printStatement.ts). Mirrors the
// role lib/payroll.ts plays for the payroll formula: keep the numbers in one
// place so the page and the print output can't drift.
//
// Revenue basis is ACCRUAL: a reservation's full folio (room + charges) is
// recognized in the period its check_in_date falls, matching the dashboard's
// "Revenue This Month" so the two never contradict. Cash received (payments
// by IST date) and outstanding balance are surfaced alongside, not instead.
// Staff cost is auto-derived from finalized/paid payroll_runs — never from
// the expenses table, which holds operating costs only (no double-counting).

import {
  Reservation,
  ReservationCharge,
  Payment,
  Expense,
  PayrollRun,
  Room,
} from '@/lib/types'
import { getCurrencyCode, CurrencyCode } from '@/lib/currency'
import { dateIST } from '@/lib/formatDate'

export type Granularity = 'week' | 'month'

// Chart hues — revenue vs expenses as two categorical series. Validated
// blue↔orange pair (dataviz skill: CVD ΔE 116 on the app's dark gray-900
// surface, both inside the dark lightness band). Composition bars reuse the
// matching side's hue as a single magnitude hue (length carries the value,
// not color), so no 8-way categorical palette is needed.
export const REVENUE_COLOR = '#3b82f6' // blue-500
export const EXPENSE_COLOR = '#ea580c' // orange-600

// --- Category labels -------------------------------------------------------
export const EXPENSE_CATEGORY_META: Record<string, { label: string }> = {
  utilities: { label: 'Utilities' },
  supplies: { label: 'Supplies' },
  maintenance: { label: 'Maintenance' },
  marketing: { label: 'Marketing' },
  rent: { label: 'Rent' },
  food_beverage: { label: 'Food & Beverage' },
  commissions: { label: 'Commissions' },
  other: { label: 'Other' },
  payroll: { label: 'Staff Payroll' }, // synthetic — sourced from payroll_runs
}

export const EXPENSE_CATEGORIES = [
  'utilities',
  'supplies',
  'maintenance',
  'marketing',
  'rent',
  'food_beverage',
  'commissions',
  'other',
] as const

// reservation_charges.category -> revenue line label ('room' is synthetic).
const CHARGE_CATEGORY_LABEL: Record<string, string> = {
  service: 'Service & Extras',
  damage: 'Damage',
  discount: 'Discounts',
  tax: 'Tax',
  other: 'Other',
}

// --- Types the page/print consume ------------------------------------------
export type RevenueLine = {
  reservationId: string
  guest: string
  room: string
  nights: number
  roomCharge: number
  extras: number
  total: number
}

export type CategoryTotal = { key: string; label: string; amount: number }

export type ExpenseLine = {
  id: string
  category: string
  categoryLabel: string
  description: string
  amount: number
  date: string
  vendor: string | null
  source: 'expense' | 'payroll'
}

export type Statement = {
  from: string
  to: string
  label: string
  granularity: Granularity
  currency: CurrencyCode
  revenue: {
    lines: RevenueLine[]
    byCategory: CategoryTotal[]
    total: number // earned
    received: number // cash in during the period (net of refunds)
    outstanding: number // still owed on this period's stays
  }
  expenses: {
    lines: ExpenseLine[]
    byCategory: CategoryTotal[]
    total: number
  }
  net: number
}

export type StatementInput = {
  reservations: Reservation[]
  charges: ReservationCharge[]
  payments: Payment[]
  rooms: Room[]
  expenses: Expense[]
  payrollRuns: PayrollRun[]
}

// --- Pure calendar-day math (UTC, so no local-TZ/DST drift) ---------------
const DAY = 86400000
function parseYMD(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
function ymd(ms: number): string {
  const dt = new Date(ms)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}
function fmtUTC(dateStr: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(parseYMD(dateStr)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}
function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to // YYYY-MM-DD lexical compare == chronological
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const n = Math.round((parseYMD(checkOut) - parseYMD(checkIn)) / DAY)
  return n > 0 ? n : 0
}

function sumBy<T>(rows: T[], keyOf: (r: T) => string, amountOf: (r: T) => number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[keyOf(r)] = (out[keyOf(r)] || 0) + amountOf(r)
  return out
}

// --- Period bounds / navigation --------------------------------------------
export function monthBounds(anchor: string): { from: string; to: string } {
  const [y, m] = anchor.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

// ISO-style Monday..Sunday week containing the anchor date.
export function weekBounds(anchor: string): { from: string; to: string } {
  const ms = parseYMD(anchor)
  const isoOffset = (new Date(ms).getUTCDay() + 6) % 7 // days since Monday
  const fromMs = ms - isoOffset * DAY
  return { from: ymd(fromMs), to: ymd(fromMs + 6 * DAY) }
}

export function periodBounds(anchor: string, g: Granularity): { from: string; to: string } {
  return g === 'month' ? monthBounds(anchor) : weekBounds(anchor)
}

// Move the anchor by ±delta periods, returning a date inside the new period.
export function shiftAnchor(anchor: string, g: Granularity, delta: number): string {
  if (g === 'month') {
    const [y, m] = anchor.split('-').map(Number)
    return ymd(Date.UTC(y, m - 1 + delta, 1))
  }
  return ymd(parseYMD(weekBounds(anchor).from) + delta * 7 * DAY)
}

export function periodLabel(from: string, to: string, g: Granularity): string {
  if (g === 'month') return fmtUTC(from, { month: 'long', year: 'numeric' })
  return `${fmtUTC(from, { month: 'short', day: 'numeric' })} – ${fmtUTC(to, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

// The last `count` periods up to and including the anchor's — for the trend.
export function recentBuckets(
  anchor: string,
  g: Granularity,
  count: number
): { from: string; to: string; label: string }[] {
  const buckets: { from: string; to: string; label: string }[] = []
  for (let i = count - 1; i >= 0; i--) {
    const { from, to } = periodBounds(shiftAnchor(anchor, g, -i), g)
    const label =
      g === 'month'
        ? fmtUTC(from, { month: 'short' })
        : fmtUTC(from, { month: 'short', day: 'numeric' })
    buckets.push({ from, to, label })
  }
  return buckets
}

// --- Revenue (accrual, by check_in_date) -----------------------------------
export function computeRevenue(
  reservations: Reservation[],
  charges: ReservationCharge[],
  payments: Payment[],
  rooms: Room[],
  from: string,
  to: string
): Statement['revenue'] {
  const roomNo = (id: string) => rooms.find((r) => r.id === id)?.room_number ?? '—'
  const chargesByRes = sumBy(charges, (c) => c.reservation_id, (c) => Number(c.amount))
  const paidByRes = sumBy(payments, (p) => p.reservation_id, (p) => Number(p.amount))

  const periodRes = reservations.filter(
    (r) => r.status !== 'cancelled' && inRange(r.check_in_date, from, to)
  )
  const periodResIds = new Set(periodRes.map((r) => r.id))

  const lines: RevenueLine[] = periodRes
    .map((r) => {
      const extras = chargesByRes[r.id] || 0
      return {
        reservationId: r.id,
        guest: r.guest_name,
        room: roomNo(r.room_id),
        nights: nightsBetween(r.check_in_date, r.check_out_date),
        roomCharge: Number(r.total_price),
        extras,
        total: Number(r.total_price) + extras,
      }
    })
    .sort((a, b) => b.total - a.total)

  const roomTotal = periodRes.reduce((s, r) => s + Number(r.total_price), 0)
  const chargeCatTotals = sumBy(
    charges.filter((c) => periodResIds.has(c.reservation_id)),
    (c) => c.category,
    (c) => Number(c.amount)
  )
  const byCategory: CategoryTotal[] = [
    { key: 'room', label: 'Room Revenue', amount: roomTotal },
    ...Object.entries(chargeCatTotals).map(([k, v]) => ({
      key: k,
      label: CHARGE_CATEGORY_LABEL[k] || k,
      amount: v,
    })),
  ].filter((c) => Math.abs(c.amount) > 0.005)

  const total = lines.reduce((s, l) => s + l.total, 0)

  // Cash actually received during the period (payments by their IST date,
  // net of negative refunds) — regardless of which reservation.
  const received = payments
    .filter((p) => inRange(dateIST(p.paid_at), from, to))
    .reduce((s, p) => s + Number(p.amount), 0)

  // Still owed on THIS period's stays (all-time payments for those stays;
    // only positive balances — a deposit-heavy booking is a credit, not a
  // receivable), mirroring the dashboard's outstanding logic.
  const outstanding = periodRes.reduce((s, r) => {
    const bal = Number(r.total_price) + (chargesByRes[r.id] || 0) - (paidByRes[r.id] || 0)
    return s + Math.max(0, bal)
  }, 0)

  return { lines, byCategory, total, received, outstanding }
}

// --- Expenses (operating + synthesized payroll) ----------------------------
export function computeExpenses(
  expenses: Expense[],
  payrollRuns: PayrollRun[],
  from: string,
  to: string
): Statement['expenses'] & { payrollTotal: number } {
  const periodExpenses = expenses.filter((e) => inRange(e.expense_date, from, to))

  const lines: ExpenseLine[] = periodExpenses
    .map((e) => ({
      id: e.id,
      category: e.category,
      categoryLabel: EXPENSE_CATEGORY_META[e.category]?.label || e.category,
      description: e.description,
      amount: Number(e.amount),
      date: e.expense_date,
      vendor: e.vendor,
      source: 'expense' as const,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))

  // Staff cost: finalized/paid runs whose period_end lands in the window.
  // Draft runs aren't a real expense yet, so they're excluded.
  const payrollTotal = payrollRuns
    .filter((pr) => (pr.status === 'finalized' || pr.status === 'paid') && inRange(pr.period_end, from, to))
    .reduce((s, pr) => s + Number(pr.gross_pay), 0)

  const byCategoryMap = sumBy(periodExpenses, (e) => e.category, (e) => Number(e.amount))
  const byCategory: CategoryTotal[] = Object.entries(byCategoryMap).map(([k, v]) => ({
    key: k,
    label: EXPENSE_CATEGORY_META[k]?.label || k,
    amount: v,
  }))
  if (payrollTotal > 0.005) {
    byCategory.push({ key: 'payroll', label: 'Staff Payroll', amount: payrollTotal })
  }
  byCategory.sort((a, b) => b.amount - a.amount)

  const total = byCategory.reduce((s, c) => s + c.amount, 0)
  return { lines, byCategory, total, payrollTotal }
}

// --- Full statement + trend ------------------------------------------------
export function computeStatement(
  data: StatementInput,
  anchor: string,
  granularity: Granularity,
  currency?: CurrencyCode
): Statement {
  const { from, to } = periodBounds(anchor, granularity)
  const revenue = computeRevenue(data.reservations, data.charges, data.payments, data.rooms, from, to)
  const expenses = computeExpenses(data.expenses, data.payrollRuns, from, to)
  return {
    from,
    to,
    label: periodLabel(from, to, granularity),
    granularity,
    currency: currency || getCurrencyCode(),
    revenue,
    expenses: { lines: expenses.lines, byCategory: expenses.byCategory, total: expenses.total },
    net: revenue.total - expenses.total,
  }
}

export type TrendPoint = { from: string; to: string; label: string; revenue: number; expenses: number; net: number }

export function buildTrend(
  data: StatementInput,
  anchor: string,
  granularity: Granularity,
  count: number
): TrendPoint[] {
  return recentBuckets(anchor, granularity, count).map((b) => {
    const revenue = computeRevenue(data.reservations, data.charges, data.payments, data.rooms, b.from, b.to).total
    const expenses = computeExpenses(data.expenses, data.payrollRuns, b.from, b.to).total
    return { ...b, revenue, expenses, net: revenue - expenses }
  })
}
