// Shared pay-computation helpers — used by both the Payroll page (payroll
// runs over a finalized period) and the Dashboard's month-to-date staff
// stats widget (a live, unfinalized "so far this month" figure). Kept in one
// place so the two call sites can't silently drift out of sync on the
// formula resolved in STAFF_MANAGEMENT_PLAN.md §6.

import { AttendanceLog, StaffCompensation, PayrollSnapshot } from '@/lib/types'

// -- Date helpers (pure calendar-day math via UTC, so no local-timezone /
// DST drift when iterating or measuring "days in this month") -----------
export function daysInMonthOf(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function eachDateInRange(startStr: string, endStr: string): string[] {
  const [sy, sm, sd] = startStr.split('-').map(Number)
  const [ey, em, ed] = endStr.split('-').map(Number)
  const startUTC = Date.UTC(sy, sm - 1, sd)
  const endUTC = Date.UTC(ey, em - 1, ed)
  const dates: string[] = []
  for (let t = startUTC; t <= endUTC; t += 86400000) {
    const dt = new Date(t)
    dates.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
    )
  }
  return dates
}

export function hoursBetween(clockIn: string, clockOut: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const diff = toMinutes(clockOut) - toMinutes(clockIn)
  return diff > 0 ? diff / 60 : 0
}

// The pay formula resolved in STAFF_MANAGEMENT_PLAN.md §6: fixed-salary
// staff are paid rate/days-in-month per day, docked to 0 for absent/
// on_leave/no-record, with pay_override forcing a specific day either way.
// Hourly staff are simply paid for logged clock_in/clock_out hours.
// `periodStart`/`periodEnd` need not span a full month — the dashboard
// widget passes month-start..today for a live "so far" figure, while the
// Payroll page passes a full calendar month for an actual run.
export function computeBreakdown(
  comp: StaffCompensation,
  periodStart: string,
  periodEnd: string,
  staffAttendance: AttendanceLog[]
) {
  const dates = eachDateInRange(periodStart, periodEnd)
  const days: PayrollSnapshot['days'] = []
  let basePay = 0
  let daysPresent = 0
  let daysAbsent = 0
  let daysHalf = 0
  const daysInMonth = comp.pay_type === 'fixed' ? daysInMonthOf(periodStart) : null
  const dailyRate = daysInMonth ? comp.rate / daysInMonth : null

  for (const date of dates) {
    const row = staffAttendance.find((a) => a.log_date === date)
    const status = (row?.status ?? 'unrecorded') as PayrollSnapshot['days'][number]['status']
    const override = row?.pay_override ?? null
    let amount = 0

    if (comp.pay_type === 'fixed' && dailyRate !== null) {
      if (override === 'paid') amount = dailyRate
      else if (override === 'unpaid') amount = 0
      else if (!row) amount = 0
      else if (status === 'present' || status === 'late') amount = dailyRate
      else if (status === 'half_day') amount = dailyRate / 2
      else amount = 0 // absent / on_leave
    } else if (row?.clock_in && row?.clock_out) {
      amount = hoursBetween(row.clock_in, row.clock_out) * comp.rate
    }

    days.push({ date, status, pay_override: override, amount: Math.round(amount * 100) / 100 })
    basePay += amount
    if (status === 'present') daysPresent++
    else if (status === 'absent') daysAbsent++
    else if (status === 'half_day') daysHalf++
  }

  return {
    days,
    basePay: Math.round(basePay * 100) / 100,
    daysInMonth,
    dailyRate,
    daysPresent,
    daysAbsent,
    daysHalf,
  }
}

// The rate in effect as of a given date — the latest row with
// effective_from <= asOfDate (append-only history, see StaffCompensation).
export function currentRateFor(
  compensation: StaffCompensation[],
  userId: string,
  asOfDate: string
): StaffCompensation | undefined {
  return compensation
    .filter((c) => c.user_id === userId && c.effective_from <= asOfDate)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]
}
