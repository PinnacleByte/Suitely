'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, Loader2, Receipt, Users, History, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Reservation, Room, AuditLog } from '@/lib/types'
import { formatIST } from '@/lib/formatDate'
import { formatMoney } from '@/lib/currency'
import { useConfirm } from '@/lib/ConfirmDialog'
import ReservationFolio from '@/components/ReservationFolio'
import ReservationGuests from '@/components/ReservationGuests'
import CheckInDialog from '@/components/CheckInDialog'
import CheckoutDialog from '@/components/CheckoutDialog'

const MS_PER_DAY = 1000 * 60 * 60 * 24

// Mirrors the list page's badge styling so status reads the same everywhere.
const STATUS_BADGE: Record<Reservation['status'], string> = {
  confirmed: 'bg-blue-500/20 text-blue-300',
  checked_in: 'bg-green-500/20 text-green-300',
  checked_out: 'bg-gray-500/20 text-gray-300',
  cancelled: 'bg-red-500/20 text-red-300',
}
const statusLabel = (status: Reservation['status']) => status.replace('_', ' ')

const nightsBetween = (checkIn: string, checkOut: string) => {
  if (!checkIn || !checkOut) return 0
  return Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / MS_PER_DAY)
}

type Tab = 'folio' | 'guests' | 'history'
const TABS: { id: Tab; label: string; icon: typeof Receipt }[] = [
  { id: 'folio', label: 'Folio', icon: Receipt },
  { id: 'guests', label: 'Guests', icon: Users },
  { id: 'history', label: 'History', icon: History },
]

export default function ReservationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { confirm, alert } = useConfirm()

  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<Tab>('folio')

  const [history, setHistory] = useState<AuditLog[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [checkinTarget, setCheckinTarget] = useState<Reservation | null>(null)
  const [checkoutTarget, setCheckoutTarget] = useState<Reservation | null>(null)

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const [resData, roomsData] = await Promise.all([
        supabase.from('reservations').select('*').eq('org_id', orgId).eq('id', id).single(),
        supabase.from('rooms').select('*').eq('org_id', orgId),
      ])

      if (resData.error || !resData.data) {
        setNotFound(true)
        return
      }

      setReservation(resData.data as Reservation)
      setRooms((roomsData.data as Room[]) || [])
    } catch (err) {
      console.error('Failed to load reservation:', err)
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  // Load the merged reservation/charge/payment activity for this booking,
  // same query the list page's History expander used.
  const loadHistory = async () => {
    setHistoryLoading(true)
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .in('entity_type', ['reservation', 'reservation_charge', 'payment'])
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
    setHistory((data as AuditLog[]) || [])
    setHistoryLoading(false)
  }

  const openTab = (next: Tab) => {
    setTab(next)
    if (next === 'history' && history.length === 0) loadHistory()
  }

  const roomNumber = reservation
    ? rooms.find((r) => r.id === reservation.room_id)?.room_number || 'Unknown'
    : 'Unknown'

  const handleDelete = async () => {
    if (!reservation) return
    const ok = await confirm({
      title: 'Delete reservation?',
      message: `This permanently deletes the reservation for ${reservation.guest_name}. Its folio and history will be removed too.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    const { error } = await supabase.from('reservations').delete().eq('id', reservation.id)
    if (error) {
      await alert({ title: 'Could not delete reservation', message: error.message })
      return
    }
    router.push('/dashboard/reservations')
  }

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-12 text-center">
        <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-500" />
        <p className="text-gray-400 mt-2">Loading reservation...</p>
      </main>
    )
  }

  if (notFound || !reservation) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-12">
        <Link
          href="/dashboard/reservations"
          className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-400 hover:text-indigo-300"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Reservations
        </Link>
        <div className="mt-6 bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
          Reservation not found.
        </div>
      </main>
    )
  }

  const nights = nightsBetween(reservation.check_in_date, reservation.check_out_date)

  return (
    <main className="max-w-5xl mx-auto px-4 py-12">
      <Link
        href="/dashboard/reservations"
        className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-400 hover:text-indigo-300"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Reservations
      </Link>

      {/* Header: who / where / when + status + primary actions */}
      <div className="mt-4 bg-gray-900 border border-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-100 wrap-break-word">
                {reservation.guest_name}
              </h1>
              <span
                className={`shrink-0 px-3 py-1 rounded-full text-sm font-semibold capitalize ${STATUS_BADGE[reservation.status]}`}
              >
                {statusLabel(reservation.status)}
              </span>
            </div>
            <p className="text-gray-400 mt-1 break-all">{reservation.guest_email}</p>
            {reservation.guest_phone && (
              <p className="text-gray-500 text-sm">{reservation.guest_phone}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            {reservation.status === 'confirmed' && (
              <button
                onClick={() => setCheckinTarget(reservation)}
                className="px-4 py-2 rounded-lg bg-green-500/10 text-green-300 font-semibold hover:bg-green-500/20 transition"
              >
                Check in
              </button>
            )}
            {reservation.status === 'checked_in' && (
              <button
                onClick={() => setCheckoutTarget(reservation)}
                className="px-4 py-2 rounded-lg bg-amber-500/10 text-amber-300 font-semibold hover:bg-amber-500/20 transition"
              >
                Check out
              </button>
            )}
            <button
              onClick={handleDelete}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-red-500/10 text-red-300 font-semibold hover:bg-red-500/20 transition"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mt-6 pt-6 border-t border-gray-800 text-sm">
          <div>
            <dt className="text-gray-500">Room</dt>
            <dd className="text-gray-100 font-semibold">{roomNumber}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Check-in</dt>
            <dd className="text-gray-100 font-semibold">{reservation.check_in_date}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Check-out</dt>
            <dd className="text-gray-100 font-semibold">{reservation.check_out_date}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Room charge</dt>
            <dd className="text-gray-100 font-semibold">
              {formatMoney(Number(reservation.total_price))}
              {nights > 0 && (
                <span className="text-gray-500 font-normal"> · {nights} night{nights === 1 ? '' : 's'}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 mb-6">
        {TABS.map(({ id: tabId, label, icon: Icon }) => (
          <button
            key={tabId}
            onClick={() => openTab(tabId)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === tabId
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6"
      >
        {tab === 'folio' && (
          <ReservationFolio
            reservationId={reservation.id}
            roomTotal={Number(reservation.total_price)}
            guestName={reservation.guest_name}
            roomNumber={roomNumber}
            checkInDate={reservation.check_in_date}
            checkOutDate={reservation.check_out_date}
          />
        )}

        {tab === 'guests' && (
          <ReservationGuests
            reservationId={reservation.id}
            guestCount={reservation.guest_count}
            leadGuestName={reservation.guest_name}
            leadIdType={reservation.guest_id_type}
            leadIdNumber={reservation.guest_id_number}
          />
        )}

        {tab === 'history' && (
          historyLoading ? (
            <p className="text-sm text-gray-400">Loading history...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400">No history recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {history.map((entry) => (
                <li key={entry.id} className="text-sm text-gray-300">
                  <span className="font-semibold">
                    {entry.summary ||
                      entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}
                  </span>
                  {entry.details && <span className="text-gray-400"> — {entry.details}</span>}
                  {' by '}
                  <span className="font-semibold">{entry.actor_name}</span>
                  {' on '}
                  {formatIST(entry.created_at)}
                </li>
              ))}
            </ul>
          )
        )}
      </motion.div>

      {checkinTarget && (
        <CheckInDialog
          reservation={checkinTarget}
          roomNumber={roomNumber}
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
          roomNumber={roomNumber}
          onClose={() => setCheckoutTarget(null)}
          onCheckedOut={() => {
            setCheckoutTarget(null)
            loadData()
          }}
        />
      )}
    </main>
  )
}
