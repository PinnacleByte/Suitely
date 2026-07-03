'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, BedDouble, Sparkles, ShoppingBag, Users, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { todayIST } from '@/lib/formatDate'
import { formatMoney } from '@/lib/currency'
import { Organization, Room, Reservation, StaffSchedule, User, ReservationCharge, Payment } from '@/lib/types'
import CheckInDialog from '@/components/CheckInDialog'
import CheckoutDialog from '@/components/CheckoutDialog'

const statCardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.3 },
  }),
}

const ROOM_STATUS_META: Record<Room['status'], { label: string; color: string }> = {
  available: { label: 'Available', color: 'text-green-400' },
  occupied: { label: 'Occupied', color: 'text-blue-400' },
  cleaning: { label: 'Cleaning', color: 'text-yellow-400' },
  maintenance: { label: 'Maintenance', color: 'text-red-400' },
}

// Whole-currency figures (no cents) in the org's configured currency.
const currency = (n: number) => formatMoney(n, { decimals: 0 })

const QUICK_ACTIONS: { href: string; label: string; icon: LucideIcon; color: string }[] = [
  { href: '/dashboard/reservations', label: 'Manage Reservations', icon: CalendarDays, color: 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-300' },
  { href: '/dashboard/rooms', label: 'Manage Rooms', icon: BedDouble, color: 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-300' },
  { href: '/dashboard/housekeeping', label: 'Housekeeping', icon: Sparkles, color: 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-300' },
  { href: '/dashboard/items', label: 'Manage Items', icon: ShoppingBag, color: 'bg-teal-500/10 hover:bg-teal-500/20 text-teal-300' },
  { href: '/dashboard/staff', label: 'Manage Staff', icon: Users, color: 'bg-green-500/10 hover:bg-green-500/20 text-green-300' },
]

export default function DashboardPage() {
  const [org, setOrg] = useState<Organization | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [charges, setCharges] = useState<ReservationCharge[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [staff, setStaff] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkinTarget, setCheckinTarget] = useState<Reservation | null>(null)
  const [checkoutTarget, setCheckoutTarget] = useState<Reservation | null>(null)

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) {
        setError('No organization found. Please run setup first.')
        return
      }

      const [orgData, roomsData, reservationsData, chargesData, paymentsData, schedulesData, staffData] =
        await Promise.all([
          supabase.from('organizations').select('*').eq('id', orgId).single(),
          supabase.from('rooms').select('*').eq('org_id', orgId),
          supabase.from('reservations').select('*').eq('org_id', orgId),
          supabase.from('reservation_charges').select('*').eq('org_id', orgId),
          supabase.from('payments').select('*').eq('org_id', orgId),
          supabase.from('staff_schedules').select('*').eq('org_id', orgId),
          supabase.from('users').select('*').eq('org_id', orgId),
        ])

      if (orgData.data) setOrg(orgData.data as Organization)
      setRooms((roomsData.data as Room[]) || [])
      setReservations((reservationsData.data as Reservation[]) || [])
      setCharges((chargesData.data as ReservationCharge[]) || [])
      setPayments((paymentsData.data as Payment[]) || [])
      setSchedules((schedulesData.data as StaffSchedule[]) || [])
      setStaff((staffData.data as User[]) || [])
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

  return (
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white wrap-break-word">
            Welcome to {org?.name || 'Suitely'}
          </h1>
          <p className="text-gray-400 mt-2">
            Manage your hotel operations efficiently
          </p>
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
            {/* Room status breakdown */}
            <h2 className="text-lg font-semibold text-gray-300 mb-3">Room Status</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
              {(Object.keys(ROOM_STATUS_META) as Room['status'][]).map((status, i) => (
                <motion.div
                  key={status}
                  custom={i}
                  initial="hidden"
                  animate="show"
                  variants={statCardVariants}
                  className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6"
                >
                  <h3 className="text-gray-400 font-semibold text-sm mb-2">
                    {ROOM_STATUS_META[status].label}
                  </h3>
                  <p className={`text-4xl font-bold ${ROOM_STATUS_META[status].color}`}>
                    {roomStatusCounts[status] || 0}
                  </p>
                </motion.div>
              ))}
            </div>

            {/* Today's arrivals & departures */}
            <div className="grid md:grid-cols-2 gap-6 mb-10">
              <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
                <h2 className="text-xl font-bold text-white mb-4">
                  Arriving Today ({arrivalsToday.length})
                </h2>
                {arrivalsToday.length === 0 ? (
                  <p className="text-gray-500 text-sm">No check-ins scheduled for today.</p>
                ) : (
                  <ul className="space-y-2">
                    {arrivalsToday.map((r) => (
                      <li key={r.id} className="flex justify-between items-center text-sm">
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
                  <ul className="space-y-2">
                    {departuresToday.map((r) => (
                      <li key={r.id} className="flex justify-between items-center text-sm">
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

            {/* Revenue snapshot */}
            <div className="grid md:grid-cols-3 gap-6 mb-10">
              <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
                <h3 className="text-gray-400 font-semibold text-sm mb-2">
                  Revenue This Month
                </h3>
                <p className="text-3xl font-bold text-indigo-400">
                  {currency(revenueThisMonth)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Room + folio charges for stays starting this month (confirmed, checked-in, checked-out)
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
                <h3 className="text-gray-400 font-semibold text-sm mb-2">
                  Upcoming Confirmed Revenue
                </h3>
                <p className="text-3xl font-bold text-indigo-400">
                  {currency(upcomingConfirmedRevenue)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  From confirmed future bookings not yet checked in
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
                <h3 className="text-gray-400 font-semibold text-sm mb-2">
                  Outstanding Balance
                </h3>
                <p
                  className={`text-3xl font-bold ${
                    outstandingBalance > 0.005 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  {currency(outstandingBalance)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {reservationsOwing.length > 0
                    ? `Unpaid across ${reservationsOwing.length} active reservation${
                        reservationsOwing.length === 1 ? '' : 's'
                      } (room + folio − payments)`
                    : 'All active reservations are fully settled'}
                </p>
              </div>
            </div>

            {/* Staff on shift + quick actions */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
                <h2 className="text-xl font-bold text-white mb-4">
                  Staff on Shift Today ({staffOnShiftToday.length})
                </h2>
                {staffOnShiftToday.length === 0 ? (
                  <p className="text-gray-500 text-sm">No shifts scheduled for today.</p>
                ) : (
                  <ul className="space-y-2">
                    {staffOnShiftToday.map((s) => (
                      <li key={s.id} className="flex justify-between text-sm">
                        <span className="text-gray-100 font-semibold">{staffName(s.user_id)}</span>
                        <span className="text-gray-400">
                          {s.position} · {s.start_time}–{s.end_time}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6">
                <h2 className="text-xl font-bold text-white mb-4">
                  Quick Actions
                </h2>
                <div className="space-y-3">
                  {QUICK_ACTIONS.map(({ href, label, icon: Icon, color }) => (
                    <motion.a
                      key={href}
                      whileHover={{ x: 2 }}
                      href={href}
                      className={`flex items-center gap-3 p-4 rounded-lg font-semibold transition ${color}`}
                    >
                      <Icon className="w-5 h-5" /> {label}
                    </motion.a>
                  ))}
                </div>
              </div>
            </div>
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
