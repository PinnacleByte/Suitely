'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Gauge,
  BedDouble,
  LogIn,
  LogOut,
  Sparkles,
  Wrench,
  Loader2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { todayIST } from '@/lib/formatDate'
import { formatMoney } from '@/lib/currency'
import { useAuth } from '@/lib/AuthContext'
import {
  Organization,
  Room,
  Reservation,
  StaffSchedule,
  User,
  ReservationCharge,
  Payment,
  AttendanceLog,
  StaffCompensation,
} from '@/lib/types'
import { computeBreakdown, currentRateFor } from '@/lib/payroll'
import CheckInDialog from '@/components/CheckInDialog'
import CheckoutDialog from '@/components/CheckoutDialog'

// Attendance status -> chart color. Reuses the app's existing badge hues
// (see getAttendanceStatusColor in app/dashboard/staff/page.tsx) EXCEPT
// on_leave: that page colors it purple, but purple sits at CVD ΔE 1.9 from
// half_day's blue under deuteranopia when the two are adjacent segments in
// a stacked bar (validated with the dataviz skill's palette checker) —
// a real collision that badges never hit, since each badge always carries
// its own text. Folded on_leave into the same neutral gray as "not logged"
// instead (both are non-working-day states for pay purposes anyway).
const ATTENDANCE_CHART_COLORS: Record<string, string> = {
  present: '#22c55e',
  late: '#f59e0b',
  half_day: '#3b82f6',
  absent: '#ef4444',
  on_leave: '#6b7280',
  unrecorded: '#6b7280',
}

const ATTENDANCE_LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'present', label: 'Present', color: ATTENDANCE_CHART_COLORS.present },
  { key: 'late', label: 'Late', color: ATTENDANCE_CHART_COLORS.late },
  { key: 'half_day', label: 'Half-day', color: ATTENDANCE_CHART_COLORS.half_day },
  { key: 'absent', label: 'Absent', color: ATTENDANCE_CHART_COLORS.absent },
  { key: 'leave', label: 'Leave / not logged', color: ATTENDANCE_CHART_COLORS.on_leave },
]

// Horizontal stacked bar: one segment per attendance status, width
// proportional to its share of the elapsed days so far this month. Built in
// plain HTML/flexbox (no chart library in this project) — the 2px flex gap
// is the "surface gap" separating segments; rounded-full + overflow-hidden
// on the wrapping div gives the two rounded outer ends. Zero-count
// categories are omitted so a hidden category can't leave a stray gap next
// to its neighbor.
function AttendanceBar({ days }: { days: { status: string }[] }) {
  const total = days.length
  if (total === 0) {
    return <div className="h-4 rounded-full bg-gray-800" />
  }

  const counts: Record<string, number> = {}
  for (const d of days) {
    const key = d.status === 'on_leave' || d.status === 'unrecorded' ? 'leave' : d.status
    counts[key] = (counts[key] || 0) + 1
  }

  const segments = ATTENDANCE_LEGEND.map((entry) => ({
    ...entry,
    count: counts[entry.key === 'leave' ? 'leave' : entry.key] || 0,
  })).filter((s) => s.count > 0)

  return (
    <div className="flex gap-0.5 h-4 rounded-full overflow-hidden bg-gray-800 w-full">
      {segments.map((s) => (
        <div
          key={s.key}
          role="img"
          tabIndex={0}
          aria-label={`${s.label}: ${s.count} of ${total} days`}
          title={`${s.label}: ${s.count} day${s.count === 1 ? '' : 's'}`}
          style={{ backgroundColor: s.color, flexBasis: `${(s.count / total) * 100}%` }}
        />
      ))}
    </div>
  )
}

const tileVariants = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.04, duration: 0.25 },
  }),
}

// Whole-currency figures (no cents) in the org's configured currency.
const currency = (n: number) => formatMoney(n, { decimals: 0 })

// Friendly IST date for the header (staff are in India).
const todayLabel = () =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date())

export default function DashboardPage() {
  const { profile } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [charges, setCharges] = useState<ReservationCharge[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [staff, setStaff] = useState<User[]>([])
  const [attendance, setAttendance] = useState<AttendanceLog[]>([])
  const [compensation, setCompensation] = useState<StaffCompensation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkinTarget, setCheckinTarget] = useState<Reservation | null>(null)
  const [checkoutTarget, setCheckoutTarget] = useState<Reservation | null>(null)

  // Financial figures are a manager/owner concern, not a front-desk one —
  // a receptionist logging in doesn't see the revenue/outstanding section.
  const canSeeFinancials = profile?.role === 'admin' || profile?.role === 'manager'
  // Same role split for the staff attendance/pay glance below: managers see
  // everyone, a staff login sees only their own row. `compensation` is
  // already RLS-restricted to self-or-manager, but `attendance` reads
  // org-wide (see attendance_logs' RLS) — this flag is what keeps a staff
  // login from rendering colleagues' rows on the client even though the
  // fetch itself returns them.
  const canSeeAllStaffStats = profile?.role === 'admin' || profile?.role === 'manager'

  useEffect(() => {
    loadDashboardData()
  }, [])

  useRealtimeRefresh(
    [
      'rooms',
      'reservations',
      'reservation_charges',
      'payments',
      'staff_schedules',
      'users',
      'attendance_logs',
      'staff_compensation',
    ],
    () => loadDashboardData()
  )

  const loadDashboardData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) {
        setError('No organization found. Please run setup first.')
        return
      }

      const [
        orgData,
        roomsData,
        reservationsData,
        chargesData,
        paymentsData,
        schedulesData,
        staffData,
        attendanceData,
        compensationData,
      ] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', orgId).single(),
        supabase.from('rooms').select('*').eq('org_id', orgId),
        supabase.from('reservations').select('*').eq('org_id', orgId),
        supabase.from('reservation_charges').select('*').eq('org_id', orgId),
        supabase.from('payments').select('*').eq('org_id', orgId),
        supabase.from('staff_schedules').select('*').eq('org_id', orgId),
        supabase.from('users').select('*').eq('org_id', orgId),
        supabase.from('attendance_logs').select('*').eq('org_id', orgId),
        supabase.from('staff_compensation').select('*').eq('org_id', orgId),
      ])

      if (orgData.data) setOrg(orgData.data as Organization)
      setRooms((roomsData.data as Room[]) || [])
      setReservations((reservationsData.data as Reservation[]) || [])
      setCharges((chargesData.data as ReservationCharge[]) || [])
      setPayments((paymentsData.data as Payment[]) || [])
      setSchedules((schedulesData.data as StaffSchedule[]) || [])
      setStaff((staffData.data as User[]) || [])
      setAttendance((attendanceData.data as AttendanceLog[]) || [])
      setCompensation((compensationData.data as StaffCompensation[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const today = todayIST()
  const thisMonth = today.slice(0, 7)

  const roomStatusCounts = rooms.reduce(
    (acc, room) => {
      acc[room.status] = (acc[room.status] || 0) + 1
      return acc
    },
    {} as Record<Room['status'], number>
  )

  // Occupancy against sellable rooms (rooms out for maintenance aren't
  // sellable, so they're excluded from the denominator).
  const outOfService = roomStatusCounts.maintenance || 0
  const sellableRooms = Math.max(0, rooms.length - outOfService)
  const occupancyPct =
    sellableRooms > 0 ? Math.round(((roomStatusCounts.occupied || 0) / sellableRooms) * 100) : 0

  const activeReservations = reservations.filter((r) => r.status !== 'cancelled')
  const roomNumber = (roomId: string) => rooms.find((r) => r.id === roomId)?.room_number || 'Unknown'

  const arrivalsToday = activeReservations.filter((r) => r.check_in_date === today)
  const departuresToday = activeReservations.filter((r) => r.check_out_date === today)

  // Folio charges/payments summed per reservation, so the dashboard's money
  // figures match a reservation's actual folio (room + charges − payments)
  // rather than room price alone.
  const sumByReservation = (rows: { reservation_id: string; amount: number }[]) =>
    rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.reservation_id] = (acc[row.reservation_id] || 0) + Number(row.amount)
      return acc
    }, {})
  const chargesByReservation = sumByReservation(charges)
  const paymentsByReservation = sumByReservation(payments)
  const folioTotal = (r: Reservation) =>
    Number(r.total_price) + (chargesByReservation[r.id] || 0)

  // Revenue now includes folio charges (minibar, surcharges, discounts), not
  // just room price — closes the long-standing gap where extras were ignored.
  const revenueThisMonth = activeReservations
    .filter((r) => r.check_in_date.slice(0, 7) === thisMonth)
    .reduce((sum, r) => sum + folioTotal(r), 0)

  const upcomingConfirmedRevenue = reservations
    .filter((r) => r.status === 'confirmed' && r.check_in_date > today)
    .reduce((sum, r) => sum + folioTotal(r), 0)

  // Outstanding = money still owed across active reservations: folio total
  // minus payments, counting only reservations with a positive balance (an
  // overpaid/deposit-heavy booking is a credit, not a receivable).
  const reservationsOwing = activeReservations
    .map((r) => folioTotal(r) - (paymentsByReservation[r.id] || 0))
    .filter((balance) => balance > 0.005)
  const outstandingBalance = reservationsOwing.reduce((sum, balance) => sum + balance, 0)

  const staffOnShiftToday = schedules
    .filter((s) => s.shift_date === today)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
  const staffName = (userId: string) => staff.find((s) => s.id === userId)?.name || 'Unknown'

  // Month-to-date attendance + accrued pay per staffer, for the glance
  // widget below. period is monthStart..today (not the full month) — it's
  // a live "so far" figure, not a payroll run; nothing here writes a
  // payroll_runs row. Managers see every staffer; a staff login sees only
  // their own (canSeeAllStaffStats gates which ids this iterates).
  const monthStart = `${thisMonth}-01`
  const staffForStats = canSeeAllStaffStats ? staff : staff.filter((s) => s.id === profile?.id)
  const staffStats = staffForStats.map((member) => {
    const memberAttendance = attendance.filter(
      (a) => a.user_id === member.id && a.log_date >= monthStart && a.log_date <= today
    )
    const comp = currentRateFor(compensation, member.id, today)
    const breakdown = comp ? computeBreakdown(comp, monthStart, today, memberAttendance) : null
    return { member, days: breakdown?.days || [], salarySoFar: breakdown?.basePay ?? null }
  })

  // Compact "today at a glance" strip — replaces the four oversized room-status
  // cards and adds occupancy, the one figure everyone glances at first.
  const stats: { label: string; value: string | number; color: string; icon: LucideIcon }[] = [
    { label: 'Occupancy', value: `${occupancyPct}%`, color: 'text-indigo-400', icon: Gauge },
    { label: 'Available', value: roomStatusCounts.available || 0, color: 'text-green-400', icon: BedDouble },
    { label: 'Arriving', value: arrivalsToday.length, color: 'text-sky-400', icon: LogIn },
    { label: 'Departing', value: departuresToday.length, color: 'text-amber-400', icon: LogOut },
    { label: 'To clean', value: roomStatusCounts.cleaning || 0, color: 'text-yellow-400', icon: Sparkles },
    { label: 'Maintenance', value: outOfService, color: 'text-red-400', icon: Wrench },
  ]

  return (
    <main className="max-w-7xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-white wrap-break-word">
          Welcome to {org?.name || 'Suitely'}
        </h1>
        <p className="text-gray-400 mt-2">{todayLabel()}</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6 text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-500" />
          <p className="text-gray-400 mt-2">Loading...</p>
        </div>
      ) : (
        <>
          {/* Today at a glance */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
            {stats.map(({ label, value, color, icon: Icon }, i) => (
              <motion.div
                key={label}
                custom={i}
                initial="hidden"
                animate="show"
                variants={tileVariants}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {label}
                  </span>
                  <Icon className="w-4 h-4 text-gray-600" />
                </div>
                <p className={`text-3xl font-bold mt-2 ${color}`}>{value}</p>
              </motion.div>
            ))}
          </div>

          {/* Today's worklist — the front-desk focus */}
          <div className="grid lg:grid-cols-2 gap-6 mb-10">
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-white mb-4">
                Arriving Today ({arrivalsToday.length})
              </h2>
              {arrivalsToday.length === 0 ? (
                <p className="text-gray-500 text-sm">No check-ins scheduled for today.</p>
              ) : (
                <ul className="divide-y divide-gray-800">
                  {arrivalsToday.map((r) => (
                    <li key={r.id} className="flex justify-between items-center text-sm py-2.5 first:pt-0 last:pb-0">
                      <span>
                        <span className="text-gray-100 font-semibold">{r.guest_name}</span>
                        <span className="text-gray-500"> · Room {roomNumber(r.room_id)}</span>
                      </span>
                      {r.status === 'confirmed' ? (
                        <button
                          onClick={() => setCheckinTarget(r)}
                          className="px-3 py-1 rounded-lg bg-green-500/10 text-green-300 font-semibold hover:bg-green-500/20 transition"
                        >
                          Check in
                        </button>
                      ) : (
                        <span className="text-green-400 font-semibold">✓ Checked in</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-white mb-4">
                Departing Today ({departuresToday.length})
              </h2>
              {departuresToday.length === 0 ? (
                <p className="text-gray-500 text-sm">No check-outs scheduled for today.</p>
              ) : (
                <ul className="divide-y divide-gray-800">
                  {departuresToday.map((r) => (
                    <li key={r.id} className="flex justify-between items-center text-sm py-2.5 first:pt-0 last:pb-0">
                      <span>
                        <span className="text-gray-100 font-semibold">{r.guest_name}</span>
                        <span className="text-gray-500"> · Room {roomNumber(r.room_id)}</span>
                      </span>
                      {r.status === 'checked_in' ? (
                        <button
                          onClick={() => setCheckoutTarget(r)}
                          className="px-3 py-1 rounded-lg bg-amber-500/10 text-amber-300 font-semibold hover:bg-amber-500/20 transition"
                        >
                          Check out
                        </button>
                      ) : r.status === 'checked_out' ? (
                        <span className="text-gray-400 font-semibold">✓ Checked out</span>
                      ) : (
                        <span className="text-gray-500">Not yet arrived</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Staff on shift */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6 mb-10">
            <h2 className="text-xl font-bold text-white mb-4">
              Staff on Shift Today ({staffOnShiftToday.length})
            </h2>
            {staffOnShiftToday.length === 0 ? (
              <p className="text-gray-500 text-sm">No shifts scheduled for today.</p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {staffOnShiftToday.map((s) => (
                  <li key={s.id} className="flex justify-between text-sm py-2.5 first:pt-0 last:pb-0">
                    <span className="text-gray-100 font-semibold">{staffName(s.user_id)}</span>
                    <span className="text-gray-400">
                      {s.position} · {s.start_time}–{s.end_time}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Staff attendance + pay glance — month to date */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6 mb-10">
            <div className="flex flex-wrap gap-3 justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">
                {canSeeAllStaffStats ? 'Staff Attendance & Pay' : 'My Attendance & Pay'}
                <span className="text-gray-500 font-normal text-base"> — {thisMonth}, so far</span>
              </h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {ATTENDANCE_LEGEND.map((entry) => (
                  <span key={entry.key} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    {entry.label}
                  </span>
                ))}
              </div>
            </div>

            {staffStats.length === 0 ? (
              <p className="text-gray-500 text-sm">No staff members yet.</p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {staffStats.map(({ member, days, salarySoFar }) => (
                  <li key={member.id} className="flex flex-wrap items-center gap-4 py-3 first:pt-0 last:pb-0">
                    <span className="text-gray-100 font-semibold w-32 shrink-0 truncate">
                      {member.name}
                    </span>
                    <div className="flex-1 min-w-32">
                      <AttendanceBar days={days} />
                    </div>
                    <span className="text-sm text-gray-300 w-28 shrink-0 text-right">
                      {salarySoFar === null ? (
                        <span className="text-gray-500">No rate set</span>
                      ) : (
                        <>
                          <span className="text-gray-500">So far </span>
                          <span className="font-semibold text-gray-100">{currency(salarySoFar)}</span>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Financials — managers/owners only */}
          {canSeeFinancials && (
            <div>
              <h2 className="text-lg font-semibold text-gray-300 mb-3">Financials</h2>
              <div className="grid sm:grid-cols-3 gap-6">
                <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
                  <h3 className="text-gray-400 font-semibold text-sm mb-2">Revenue This Month</h3>
                  <p className="text-2xl font-bold text-indigo-400">{currency(revenueThisMonth)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Room + folio charges for stays starting this month
                  </p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
                  <h3 className="text-gray-400 font-semibold text-sm mb-2">Upcoming Confirmed</h3>
                  <p className="text-2xl font-bold text-indigo-400">{currency(upcomingConfirmedRevenue)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    From confirmed future bookings not yet checked in
                  </p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
                  <h3 className="text-gray-400 font-semibold text-sm mb-2">Outstanding Balance</h3>
                  <p
                    className={`text-2xl font-bold ${
                      outstandingBalance > 0.005 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {currency(outstandingBalance)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {reservationsOwing.length > 0
                      ? `Unpaid across ${reservationsOwing.length} active reservation${
                          reservationsOwing.length === 1 ? '' : 's'
                        }`
                      : 'All active reservations are fully settled'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {checkinTarget && (
        <CheckInDialog
          reservation={checkinTarget}
          roomNumber={roomNumber(checkinTarget.room_id)}
          onClose={() => setCheckinTarget(null)}
          onCheckedIn={() => {
            setCheckinTarget(null)
            loadDashboardData()
          }}
        />
      )}

      {checkoutTarget && (
        <CheckoutDialog
          reservation={checkoutTarget}
          roomNumber={roomNumber(checkoutTarget.room_id)}
          onClose={() => setCheckoutTarget(null)}
          onCheckedOut={() => {
            setCheckoutTarget(null)
            loadDashboardData()
          }}
        />
      )}
    </main>
  )
}
