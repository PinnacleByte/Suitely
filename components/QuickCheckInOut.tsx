'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { Reservation, Room } from '@/lib/types'
import { todayIST } from '@/lib/formatDate'
import CheckInDialog from '@/components/CheckInDialog'
import CheckoutDialog from '@/components/CheckoutDialog'

// Quick check-in/check-out entry points on the navbar, so staff can act on
// a guest from anywhere in the dashboard without first navigating to
// Reservations. Both hand off to the same wizards the Reservations table
// uses (CheckInDialog / CheckoutDialog), so occupancy surcharges, guest
// IDs, early-checkout credits, and item charges all apply consistently
// regardless of where the action was started from.
export default function QuickCheckInOut() {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [openPanel, setOpenPanel] = useState<'in' | 'out' | null>(null)
  const [search, setSearch] = useState('')
  const [checkinTarget, setCheckinTarget] = useState<Reservation | null>(null)
  const [checkoutTarget, setCheckoutTarget] = useState<Reservation | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const orgId = localStorage.getItem('orgId')
    if (!orgId) return
    const [resData, roomsData] = await Promise.all([
      supabase.from('reservations').select('*').eq('org_id', orgId),
      supabase.from('rooms').select('*').eq('org_id', orgId),
    ])
    setReservations((resData.data as Reservation[]) || [])
    setRooms((roomsData.data as Room[]) || [])
  }

  const roomNumber = (roomId: string) =>
    rooms.find((r) => r.id === roomId)?.room_number || 'Unknown'
  const today = todayIST()

  const confirmedReservations = reservations.filter((r) => r.status === 'confirmed')
  const arrivalsToday = confirmedReservations.filter((r) => r.check_in_date === today)
  const checkedInReservations = reservations.filter((r) => r.status === 'checked_in')
  const departingToday = checkedInReservations.filter((r) => r.check_out_date === today)

  const matchesSearch = (r: Reservation) =>
    !search.trim() || r.guest_name.toLowerCase().includes(search.trim().toLowerCase())

  // Check-in defaults to just today's arrivals; typing a search reaches any
  // confirmed reservation regardless of date (early or backlog check-ins).
  const checkInList = search.trim() ? confirmedReservations.filter(matchesSearch) : arrivalsToday
  // Checkout isn't date-gated — a guest can leave any day — so the full
  // in-house list is always the base, search just narrows it further.
  const checkOutList = checkedInReservations.filter(matchesSearch)

  const togglePanel = (panel: 'in' | 'out') => {
    setSearch('')
    setOpenPanel((prev) => (prev === panel ? null : panel))
  }

  const openCheckin = (res: Reservation) => {
    setCheckinTarget(res)
    setOpenPanel(null)
  }

  const openCheckout = (res: Reservation) => {
    setCheckoutTarget(res)
    setOpenPanel(null)
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <button
          onClick={() => togglePanel('in')}
          className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-green-300 hover:bg-green-500/10 transition"
        >
          Check In
          {arrivalsToday.length > 0 && (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-green-500 text-white text-xs font-bold">
              {arrivalsToday.length}
            </span>
          )}
        </button>

        <AnimatePresence>
          {openPanel === 'in' && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setOpenPanel(null)} />
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-30 p-3"
              >
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search any confirmed guest..."
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm mb-2"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mb-2">
                  {search.trim() ? 'All confirmed reservations' : "Today's arrivals"}
                </p>
                {checkInList.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2 text-center">
                    {search.trim() ? 'No matches.' : 'No arrivals scheduled for today.'}
                  </p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto space-y-1">
                    {checkInList.map((res) => (
                      <li key={res.id}>
                        <button
                          onClick={() => openCheckin(res)}
                          className="w-full flex justify-between items-center px-2 py-2 rounded-lg hover:bg-gray-800 transition text-left"
                        >
                          <span className="min-w-0 truncate">
                            <span className="text-gray-100 font-semibold text-sm">
                              {res.guest_name}
                            </span>
                            <span className="text-gray-500 text-xs">
                              {' '}
                              · Room {roomNumber(res.room_id)} · {res.check_in_date}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-green-400 ml-2">
                            Check In
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <div className="relative">
        <button
          onClick={() => togglePanel('out')}
          className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-amber-300 hover:bg-amber-500/10 transition"
        >
          Check Out
          {departingToday.length > 0 && (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-xs font-bold">
              {departingToday.length}
            </span>
          )}
        </button>

        <AnimatePresence>
          {openPanel === 'out' && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setOpenPanel(null)} />
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-30 p-3"
              >
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search checked-in guests..."
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm mb-2"
                  autoFocus
                />
                {checkOutList.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2 text-center">
                    {search.trim() ? 'No matches.' : 'No guests currently checked in.'}
                  </p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto space-y-1">
                    {checkOutList.map((res) => (
                      <li key={res.id}>
                        <button
                          onClick={() => openCheckout(res)}
                          className="w-full flex justify-between items-center px-2 py-2 rounded-lg hover:bg-gray-800 transition text-left"
                        >
                          <span className="min-w-0 truncate">
                            <span className="text-gray-100 font-semibold text-sm">
                              {res.guest_name}
                            </span>
                            <span className="text-gray-500 text-xs">
                              {' '}
                              · Room {roomNumber(res.room_id)} · out {res.check_out_date}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-amber-400 ml-2">
                            Check Out
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {checkinTarget && (
        <CheckInDialog
          reservation={checkinTarget}
          roomNumber={roomNumber(checkinTarget.room_id)}
          onClose={() => setCheckinTarget(null)}
          onCheckedIn={() => {
            setCheckinTarget(null)
            loadData()
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
            loadData()
          }}
        />
      )}
    </div>
  )
}
