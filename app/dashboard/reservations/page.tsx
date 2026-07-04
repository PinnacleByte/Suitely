'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { Reservation, Room, RoomType } from '@/lib/types'
import { formatMoney } from '@/lib/currency'
import { useConfirm } from '@/lib/ConfirmDialog'
import { useIdentityConfirm } from '@/lib/IdentityConfirm'
import CheckInDialog from '@/components/CheckInDialog'
import CheckoutDialog from '@/components/CheckoutDialog'

const MS_PER_DAY = 1000 * 60 * 60 * 24
const STEP_LABELS = ['Dates', 'Room Type', 'Room', 'Guest Details']

const stepVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -60 : 60, opacity: 0 }),
}

type FormData = {
  room_id: string
  guest_name: string
  guest_email: string
  guest_phone: string
  check_in_date: string
  check_out_date: string
  total_price: string
}

const emptyForm: FormData = {
  room_id: '',
  guest_name: '',
  guest_email: '',
  guest_phone: '',
  check_in_date: '',
  check_out_date: '',
  total_price: '',
}

type EditFormData = FormData & { status: Reservation['status'] }

const STATUS_OPTIONS: Reservation['status'][] = [
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
]

// Color each status distinctly so the list scans at a glance.
const STATUS_BADGE: Record<Reservation['status'], string> = {
  confirmed: 'bg-blue-500/20 text-blue-300',
  checked_in: 'bg-green-500/20 text-green-300',
  checked_out: 'bg-gray-500/20 text-gray-300',
  cancelled: 'bg-red-500/20 text-red-300',
}

const statusLabel = (status: Reservation['status']) => status.replace('_', ' ')

const STATUS_FILTERS: Array<'all' | Reservation['status']> = ['all', ...STATUS_OPTIONS]

const PAYMENT_METHODS = ['cash', 'card', 'upi', 'bank_transfer', 'other'] as const
const METHOD_LABEL: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  other: 'Other',
}

export default function ReservationsPage() {
  const { confirm, alert } = useConfirm()
  const { confirmIdentity } = useIdentityConfirm()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState(1)
  const [checkingAvailability, setCheckingAvailability] = useState(false)
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState('')
  const [formData, setFormData] = useState<FormData>(emptyForm)
  // Optional deposit taken at booking. Kept separate from formData, which is
  // spread directly into the reservations insert — a deposit is a payments
  // row, not a reservations column.
  const [depositAmount, setDepositAmount] = useState('')
  const [depositMethod, setDepositMethod] =
    useState<(typeof PAYMENT_METHODS)[number]>('cash')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditFormData>({ ...emptyForm, status: 'confirmed' })
  const [editError, setEditError] = useState('')

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Reservation['status']>('all')
  const [checkinTarget, setCheckinTarget] = useState<Reservation | null>(null)
  const [checkoutTarget, setCheckoutTarget] = useState<Reservation | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  useRealtimeRefresh(['reservations', 'rooms', 'room_types'], () => loadData())

  // Auto-calculate total price from the selected room's type and length of stay.
  useEffect(() => {
    const room = rooms.find((r) => r.id === formData.room_id)
    const roomType = roomTypes.find((t) => t.id === room?.room_type_id)
    const nights = getNights(formData.check_in_date, formData.check_out_date)

    if (roomType && nights > 0) {
      setFormData((prev) => ({
        ...prev,
        total_price: (roomType.base_price * nights).toFixed(2),
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.room_id])

  // Same auto-calculation for the edit panel.
  useEffect(() => {
    const room = rooms.find((r) => r.id === editForm.room_id)
    const roomType = roomTypes.find((t) => t.id === room?.room_type_id)
    const nights = getNights(editForm.check_in_date, editForm.check_out_date)

    if (roomType && nights > 0) {
      setEditForm((prev) => ({
        ...prev,
        total_price: (roomType.base_price * nights).toFixed(2),
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editForm.room_id])

  const getNights = (checkIn: string, checkOut: string) => {
    if (!checkIn || !checkOut) return 0
    return Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / MS_PER_DAY
    )
  }

  // Whether a room has an active reservation overlapping the given dates
  // (optionally ignoring one reservation, so an edit doesn't conflict with itself).
  const isRoomBooked = (
    roomId: string,
    checkIn: string,
    checkOut: string,
    excludeId?: string
  ) => {
    if (!checkIn || !checkOut) return false

    return reservations.some(
      (res) =>
        res.room_id === roomId &&
        res.id !== excludeId &&
        res.status !== 'cancelled' &&
        checkIn < res.check_out_date &&
        checkOut > res.check_in_date
    )
  }

  const isRoomBookedForSelectedDates = (roomId: string) =>
    isRoomBooked(roomId, formData.check_in_date, formData.check_out_date)

  const loadData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const [resData, roomsData, typesData] = await Promise.all([
        supabase.from('reservations').select('*').eq('org_id', orgId),
        supabase.from('rooms').select('*').eq('org_id', orgId),
        supabase.from('room_types').select('*').eq('org_id', orgId),
      ])

      setReservations((resData.data as Reservation[]) || [])
      setRooms((roomsData.data as Room[]) || [])
      setRoomTypes((typesData.data as RoomType[]) || [])
      return resData.data as Reservation[] | null
    } catch (err) {
      console.error('Failed to load data:', err)
      return null
    } finally {
      setLoading(false)
    }
  }

  const goToStep = (next: number) => {
    setDirection(next > step ? 1 : -1)
    setError('')
    setStep(next)
  }

  const openWizard = () => {
    setEditingId(null)
    setFormData(emptyForm)
    setDepositAmount('')
    setDepositMethod('cash')
    setSelectedRoomTypeId('')
    setError('')
    setSuccess(false)
    setStep(1)
    setDirection(1)
    setShowForm(true)
    loadData()
  }

  const closeWizard = () => {
    setShowForm(false)
    setError('')
  }

  // Re-fetch the latest reservations before showing availability, then advance.
  const handleCheckAvailability = async () => {
    const nights = getNights(formData.check_in_date, formData.check_out_date)
    if (nights <= 0) {
      setError('Check-out date must be after the check-in date.')
      return
    }

    setError('')
    setCheckingAvailability(true)
    const [minDelay] = await Promise.all([
      new Promise((resolve) => setTimeout(resolve, 500)),
      loadData(),
    ])
    void minDelay
    setCheckingAvailability(false)
    setSelectedRoomTypeId('')
    setFormData((prev) => ({ ...prev, room_id: '' }))
    goToStep(2)
  }

  const roomsOfType = (roomTypeId: string) => rooms.filter((r) => r.room_type_id === roomTypeId)
  const availableRoomsOfType = (roomTypeId: string) =>
    roomsOfType(roomTypeId).filter((r) => !isRoomBookedForSelectedDates(r.id))

  const handleSelectRoomType = (typeId: string) => {
    if (availableRoomsOfType(typeId).length === 0) return
    setSelectedRoomTypeId(typeId)
    goToStep(3)
  }

  const handleSelectRoom = (room: Room) => {
    const roomType = roomTypes.find((t) => t.id === room.room_type_id)
    const nights = getNights(formData.check_in_date, formData.check_out_date)
    setFormData((prev) => ({
      ...prev,
      room_id: room.id,
      total_price: roomType ? (roomType.base_price * nights).toFixed(2) : prev.total_price,
    }))
    goToStep(4)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const nights = getNights(formData.check_in_date, formData.check_out_date)
    if (nights <= 0) {
      setError('Check-out date must be after the check-in date.')
      return
    }

    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      // Re-check for overlapping bookings on this room right before inserting,
      // since the list in state may be stale.
      const { data: existing, error: overlapError } = await supabase
        .from('reservations')
        .select('id, check_in_date, check_out_date, status')
        .eq('org_id', orgId)
        .eq('room_id', formData.room_id)
        .neq('status', 'cancelled')

      if (overlapError) {
        setError(overlapError.message)
        return
      }

      const hasOverlap = (existing || []).some(
        (res) =>
          formData.check_in_date < res.check_out_date &&
          formData.check_out_date > res.check_in_date
      )

      if (hasOverlap) {
        setError('This room is already booked for some or all of the selected dates.')
        return
      }

      // Shared-terminal accountability: the staffer confirms who they are
      // before the booking is created (records responsibility in the audit log).
      const actor = await confirmIdentity({ action: 'book' })
      if (!actor) return

      const { data: created, error: insertError } = await supabase
        .from('reservations')
        .insert([
          {
            org_id: orgId,
            ...formData,
            total_price: parseFloat(formData.total_price),
            status: 'confirmed',
          },
        ])
        .select('id')
        .single()

      if (insertError) {
        setError(insertError.message)
        return
      }

      // Record the optional booking deposit as a payments row against the
      // new reservation. Non-fatal if it fails — the booking already exists,
      // and staff can add the payment later from the Folio.
      const deposit = parseFloat(depositAmount)
      if (created && !Number.isNaN(deposit) && deposit > 0) {
        await supabase.from('payments').insert([
          {
            org_id: orgId,
            reservation_id: created.id,
            amount: deposit,
            method: depositMethod,
            note: 'Booking deposit',
          },
        ])
      }

      setSuccess(true)
      loadData()
      setTimeout(() => {
        closeWizard()
      }, 1400)
    } catch (err) {
      console.error('Failed to create reservation:', err)
      setError('Failed to create reservation. Please try again.')
    }
  }

  const openEdit = (res: Reservation) => {
    setShowForm(false)
    setEditingId(res.id)
    setEditError('')
    setEditForm({
      room_id: res.room_id,
      guest_name: res.guest_name,
      guest_email: res.guest_email,
      guest_phone: res.guest_phone || '',
      check_in_date: res.check_in_date,
      check_out_date: res.check_out_date,
      total_price: String(res.total_price),
      status: res.status,
    })
  }

  const closeEdit = () => {
    setEditingId(null)
    setEditError('')
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setEditError('')
    if (!editingId) return

    const editNights = getNights(editForm.check_in_date, editForm.check_out_date)
    if (editNights <= 0) {
      setEditError('Check-out date must be after the check-in date.')
      return
    }

    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const { data: existing, error: overlapError } = await supabase
        .from('reservations')
        .select('id, check_in_date, check_out_date, status')
        .eq('org_id', orgId)
        .eq('room_id', editForm.room_id)
        .neq('status', 'cancelled')

      if (overlapError) {
        setEditError(overlapError.message)
        return
      }

      const hasOverlap = (existing || []).some(
        (res) =>
          res.id !== editingId &&
          editForm.check_in_date < res.check_out_date &&
          editForm.check_out_date > res.check_in_date
      )

      if (hasOverlap) {
        setEditError('This room is already booked for some or all of the selected dates.')
        return
      }

      const { error: updateError } = await supabase
        .from('reservations')
        .update({
          room_id: editForm.room_id,
          guest_name: editForm.guest_name,
          guest_email: editForm.guest_email,
          guest_phone: editForm.guest_phone,
          check_in_date: editForm.check_in_date,
          check_out_date: editForm.check_out_date,
          total_price: parseFloat(editForm.total_price),
          status: editForm.status,
        })
        .eq('id', editingId)

      if (updateError) {
        setEditError(updateError.message)
        return
      }

      closeEdit()
      loadData()
    } catch (err) {
      console.error('Failed to update reservation:', err)
      setEditError('Failed to update reservation. Please try again.')
    }
  }

  const handleDelete = async (res: Reservation) => {
    const ok = await confirm({
      title: 'Delete reservation?',
      message: `This permanently deletes the reservation for ${res.guest_name}. Its folio and history will be removed too.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    const { error: deleteError } = await supabase
      .from('reservations')
      .delete()
      .eq('id', res.id)

    if (deleteError) {
      await alert({ title: 'Could not delete reservation', message: deleteError.message })
      return
    }

    loadData()
  }

  const selectedRoom = rooms.find((r) => r.id === formData.room_id)
  const selectedRoomType = roomTypes.find((t) => t.id === selectedRoom?.room_type_id)
  const nights = getNights(formData.check_in_date, formData.check_out_date)

  const roomNumberFor = (roomId: string) =>
    rooms.find((r) => r.id === roomId)?.room_number || ''

  // Client-side search (guest name/email/room) + status filter. Fine at the
  // current data volume; revisit alongside pagination if a single org grows
  // to thousands of reservations.
  const query = searchQuery.trim().toLowerCase()
  const filteredReservations = reservations.filter((res) => {
    if (statusFilter !== 'all' && res.status !== statusFilter) return false
    if (!query) return true
    return (
      res.guest_name.toLowerCase().includes(query) ||
      res.guest_email.toLowerCase().includes(query) ||
      roomNumberFor(res.room_id).toLowerCase().includes(query)
    )
  })

  // Row actions are kept lean: a single contextual primary action (check
  // in/out) for front-desk speed, plus quick record edits — the deep billing
  // work (folio, guests, history, invoices) lives on the per-booking detail
  // page (/dashboard/reservations/[id]) so staff can focus on one stay at a
  // time. Shared between the desktop table and the mobile card layout so they
  // can't drift.
  const renderActions = (res: Reservation) => (
    <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
      {res.status === 'confirmed' && (
        <button
          onClick={() => setCheckinTarget(res)}
          className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-300 hover:bg-green-500/20 transition"
        >
          Check in
        </button>
      )}
      {res.status === 'checked_in' && (
        <button
          onClick={() => setCheckoutTarget(res)}
          className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition"
        >
          Check out
        </button>
      )}
      <Link
        href={`/dashboard/reservations/${res.id}`}
        className="text-indigo-400 hover:text-indigo-300"
      >
        Manage →
      </Link>
      <button onClick={() => openEdit(res)} className="text-gray-400 hover:text-gray-200">
        Edit
      </button>
      <button onClick={() => handleDelete(res)} className="text-red-400 hover:text-red-300">
        Delete
      </button>
    </div>
  )

  return (
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="flex flex-col gap-4 mb-8 sm:flex-row sm:justify-between sm:items-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-100">Reservations</h1>
          <div className="flex gap-3 items-center">
            <Link
              href="/dashboard/reservations/activity"
              className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
            >
              View Activity Log →
            </Link>
            <button
              onClick={() => (showForm ? closeWizard() : openWizard())}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
            >
              {showForm ? 'Cancel' : '+ New Reservation'}
            </button>
          </div>
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
              <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
                {success ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center justify-center py-12 text-center"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                      className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4"
                    >
                      <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </motion.div>
                    <h2 className="text-2xl font-bold text-gray-100">Reservation Created!</h2>
                    <p className="text-gray-400 mt-1">
                      Room {selectedRoom?.room_number} booked for {formData.guest_name}.
                    </p>
                  </motion.div>
                ) : (
                  <>
                    {/* Step indicator */}
                    <div className="flex items-center mb-8">
                      {STEP_LABELS.map((label, i) => {
                        const stepNum = i + 1
                        const isActive = stepNum === step
                        const isDone = stepNum < step
                        return (
                          <div key={label} className="flex items-center flex-1 last:flex-none">
                            <div className="flex flex-col items-center">
                              <motion.div
                                animate={{
                                  backgroundColor: isDone || isActive ? '#4f46e5' : '#374151',
                                  color: isDone || isActive ? '#ffffff' : '#9ca3af',
                                  scale: isActive ? 1.15 : 1,
                                }}
                                transition={{ duration: 0.25 }}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold"
                              >
                                {isDone ? '✓' : stepNum}
                              </motion.div>
                              <span
                                className={`text-xs mt-1 font-medium ${
                                  isActive ? 'text-indigo-400' : 'text-gray-500'
                                }`}
                              >
                                {label}
                              </span>
                            </div>
                            {stepNum !== STEP_LABELS.length && (
                              <div className="flex-1 h-0.5 mx-2 bg-gray-800 relative overflow-hidden">
                                <motion.div
                                  className="absolute inset-0 bg-indigo-600"
                                  initial={false}
                                  animate={{ scaleX: isDone ? 1 : 0 }}
                                  style={{ originX: 0 }}
                                  transition={{ duration: 0.3 }}
                                />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30"
                      >
                        {error}
                      </motion.div>
                    )}

                    <AnimatePresence mode="wait" custom={direction}>
                      {step === 1 && (
                        <motion.div
                          key="step1"
                          custom={direction}
                          variants={stepVariants}
                          initial="enter"
                          animate="center"
                          exit="exit"
                          transition={{ duration: 0.25 }}
                        >
                          <h2 className="text-xl font-bold mb-6 text-gray-100">
                            When is the guest staying?
                          </h2>
                          <div className="grid md:grid-cols-2 gap-6 mb-6">
                            <div>
                              <label className="block text-gray-300 font-semibold mb-2">
                                Check-in Date
                              </label>
                              <input
                                type="date"
                                value={formData.check_in_date}
                                onChange={(e) =>
                                  setFormData({ ...formData, check_in_date: e.target.value })
                                }
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-gray-300 font-semibold mb-2">
                                Check-out Date
                              </label>
                              <input
                                type="date"
                                value={formData.check_out_date}
                                min={formData.check_in_date || undefined}
                                onChange={(e) =>
                                  setFormData({ ...formData, check_out_date: e.target.value })
                                }
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                                required
                              />
                            </div>
                          </div>
                          <motion.button
                            whileTap={{ scale: 0.97 }}
                            onClick={handleCheckAvailability}
                            disabled={
                              checkingAvailability ||
                              !formData.check_in_date ||
                              !formData.check_out_date
                            }
                            className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition disabled:bg-gray-700"
                          >
                            {checkingAvailability ? (
                              <span className="flex items-center justify-center gap-2">
                                <motion.span
                                  animate={{ rotate: 360 }}
                                  transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                                  className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                                />
                                Checking availability...
                              </span>
                            ) : (
                              'Check Availability'
                            )}
                          </motion.button>
                        </motion.div>
                      )}

                      {step === 2 && (
                        <motion.div
                          key="step2"
                          custom={direction}
                          variants={stepVariants}
                          initial="enter"
                          animate="center"
                          exit="exit"
                          transition={{ duration: 0.25 }}
                        >
                          <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-gray-100">
                              Choose a room type
                            </h2>
                            <button
                              onClick={() => goToStep(1)}
                              className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
                            >
                              ← Change dates
                            </button>
                          </div>
                          {roomTypes.length === 0 ? (
                            <p className="text-gray-400">No room types have been set up yet.</p>
                          ) : (
                            <div className="grid md:grid-cols-2 gap-4">
                              {roomTypes.map((type) => {
                                const total = roomsOfType(type.id).length
                                const available = availableRoomsOfType(type.id).length
                                const disabled = available === 0
                                return (
                                  <motion.button
                                    key={type.id}
                                    type="button"
                                    whileHover={disabled ? {} : { scale: 1.02 }}
                                    whileTap={disabled ? {} : { scale: 0.98 }}
                                    onClick={() => handleSelectRoomType(type.id)}
                                    disabled={disabled}
                                    className={`text-left p-5 rounded-lg border-2 transition ${
                                      disabled
                                        ? 'border-gray-800 bg-gray-800/50 opacity-60 cursor-not-allowed'
                                        : 'border-gray-800 hover:border-indigo-500'
                                    }`}
                                  >
                                    <div className="flex justify-between items-start">
                                      <h3 className="font-bold text-gray-100">{type.name}</h3>
                                      <span className="text-indigo-400 font-bold">
                                        {formatMoney(Number(type.base_price))}/night
                                      </span>
                                    </div>
                                    <p className="text-sm text-gray-400 mt-1">{type.description}</p>
                                    <p
                                      className={`text-xs font-semibold mt-3 ${
                                        disabled ? 'text-red-400' : 'text-green-400'
                                      }`}
                                    >
                                      {total === 0
                                        ? 'No rooms of this type yet'
                                        : disabled
                                        ? 'Fully booked for these dates'
                                        : `${available} of ${total} room(s) available`}
                                    </p>
                                  </motion.button>
                                )
                              })}
                            </div>
                          )}
                        </motion.div>
                      )}

                      {step === 3 && (
                        <motion.div
                          key="step3"
                          custom={direction}
                          variants={stepVariants}
                          initial="enter"
                          animate="center"
                          exit="exit"
                          transition={{ duration: 0.25 }}
                        >
                          <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-gray-100">
                              Pick an available room
                            </h2>
                            <button
                              onClick={() => goToStep(2)}
                              className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
                            >
                              ← Change room type
                            </button>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {availableRoomsOfType(selectedRoomTypeId).map((room) => (
                              <motion.button
                                key={room.id}
                                type="button"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleSelectRoom(room)}
                                className="p-4 rounded-lg border-2 border-gray-800 hover:border-indigo-500 hover:bg-indigo-500/10 transition text-center"
                              >
                                <div className="text-xl font-bold text-gray-100">
                                  #{room.room_number}
                                </div>
                                <div className="text-xs text-green-400 font-semibold mt-1">
                                  available
                                </div>
                              </motion.button>
                            ))}
                          </div>
                        </motion.div>
                      )}

                      {step === 4 && (
                        <motion.div
                          key="step4"
                          custom={direction}
                          variants={stepVariants}
                          initial="enter"
                          animate="center"
                          exit="exit"
                          transition={{ duration: 0.25 }}
                        >
                          <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-gray-100">Guest details</h2>
                            <button
                              onClick={() => goToStep(3)}
                              className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
                            >
                              ← Change room
                            </button>
                          </div>

                          <div className="bg-indigo-500/10 rounded-lg p-4 mb-6 text-sm text-indigo-300 flex flex-wrap gap-x-6 gap-y-1">
                            <span>
                              <strong>Room:</strong> #{selectedRoom?.room_number} ({selectedRoomType?.name})
                            </span>
                            <span>
                              <strong>Dates:</strong> {formData.check_in_date} → {formData.check_out_date}
                            </span>
                            <span>
                              <strong>Nights:</strong> {nights}
                            </span>
                          </div>

                          <form onSubmit={handleSubmit} className="grid md:grid-cols-2 gap-6">
                            <div>
                              <label className="block text-gray-300 font-semibold mb-2">
                                Guest Name
                              </label>
                              <input
                                type="text"
                                value={formData.guest_name}
                                onChange={(e) =>
                                  setFormData({ ...formData, guest_name: e.target.value })
                                }
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-gray-300 font-semibold mb-2">
                                Email <span className="text-gray-500 font-normal">(optional)</span>
                              </label>
                              <input
                                type="email"
                                value={formData.guest_email}
                                onChange={(e) =>
                                  setFormData({ ...formData, guest_email: e.target.value })
                                }
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-300 font-semibold mb-2">
                                Phone
                              </label>
                              <input
                                type="tel"
                                value={formData.guest_phone}
                                onChange={(e) =>
                                  setFormData({ ...formData, guest_phone: e.target.value })
                                }
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-300 font-semibold mb-2">
                                Total Price
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.total_price}
                                onChange={(e) =>
                                  setFormData({ ...formData, total_price: e.target.value })
                                }
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                                required
                              />
                              <p className="text-sm text-gray-500 mt-1">
                                Auto-calculated from the nightly rate and length of stay. Edit if you need to override it.
                              </p>
                            </div>
                            <div className="md:col-span-2 grid md:grid-cols-2 gap-6 pt-2 border-t border-gray-800">
                              <div>
                                <label className="block text-gray-300 font-semibold mb-2">
                                  Deposit taken now{' '}
                                  <span className="text-gray-500 font-normal">(optional)</span>
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={depositAmount}
                                  onChange={(e) => setDepositAmount(e.target.value)}
                                  placeholder="0.00"
                                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                                />
                                <p className="text-sm text-gray-500 mt-1">
                                  Recorded as a payment on the folio. Leave blank if none.
                                </p>
                              </div>
                              <div>
                                <label className="block text-gray-300 font-semibold mb-2">
                                  Deposit method
                                </label>
                                <select
                                  value={depositMethod}
                                  onChange={(e) =>
                                    setDepositMethod(
                                      e.target.value as (typeof PAYMENT_METHODS)[number]
                                    )
                                  }
                                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                                >
                                  {PAYMENT_METHODS.map((m) => (
                                    <option key={m} value={m}>
                                      {METHOD_LABEL[m]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="md:col-span-2">
                              <motion.button
                                whileTap={{ scale: 0.97 }}
                                type="submit"
                                className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                              >
                                Confirm Reservation
                              </motion.button>
                            </div>
                          </form>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {editingId && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-gray-100">Edit Reservation</h2>
                  <button
                    onClick={closeEdit}
                    className="text-sm font-semibold text-gray-500 hover:text-gray-300"
                  >
                    Cancel
                  </button>
                </div>

                {editError && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30"
                  >
                    {editError}
                  </motion.div>
                )}

                <form onSubmit={handleEditSubmit} className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Room</label>
                    <select
                      value={editForm.room_id}
                      onChange={(e) => setEditForm({ ...editForm, room_id: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      required
                    >
                      {rooms.map((room) => {
                        const booked = isRoomBooked(
                          room.id,
                          editForm.check_in_date,
                          editForm.check_out_date,
                          editingId
                        )
                        return (
                          <option key={room.id} value={room.id} disabled={booked}>
                            Room {room.room_number} (
                            {booked ? 'booked for these dates' : room.status})
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Status</label>
                    <select
                      value={editForm.status}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          status: e.target.value as Reservation['status'],
                        })
                      }
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Guest Name</label>
                    <input
                      type="text"
                      value={editForm.guest_name}
                      onChange={(e) => setEditForm({ ...editForm, guest_name: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">
                      Email <span className="text-gray-500 font-normal">(optional)</span>
                    </label>
                    <input
                      type="email"
                      value={editForm.guest_email}
                      onChange={(e) => setEditForm({ ...editForm, guest_email: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Phone</label>
                    <input
                      type="tel"
                      value={editForm.guest_phone}
                      onChange={(e) => setEditForm({ ...editForm, guest_phone: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Check-in Date</label>
                    <input
                      type="date"
                      value={editForm.check_in_date}
                      onChange={(e) =>
                        setEditForm({ ...editForm, check_in_date: e.target.value })
                      }
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Check-out Date</label>
                    <input
                      type="date"
                      value={editForm.check_out_date}
                      min={editForm.check_in_date || undefined}
                      onChange={(e) =>
                        setEditForm({ ...editForm, check_out_date: e.target.value })
                      }
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Total Price</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.total_price}
                      onChange={(e) => setEditForm({ ...editForm, total_price: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      type="submit"
                      className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                    >
                      Save Changes
                    </motion.button>
                  </div>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!loading && reservations.length > 0 && (
          <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by guest, email, or room…"
              className="w-full sm:max-w-xs px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((filter) => {
                const count =
                  filter === 'all'
                    ? reservations.length
                    : reservations.filter((r) => r.status === filter).length
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
                    {filter === 'all' ? 'All' : statusLabel(filter)} ({count})
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
        ) : reservations.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
            No reservations yet
          </div>
        ) : filteredReservations.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
            No reservations match your search or filter.
          </div>
        ) : (
          <>
          {/* Desktop: table (horizontally scrolls within its card if needed) */}
          <div className="hidden md:block bg-gray-900 border border-gray-800 rounded-lg shadow overflow-x-auto">
            <table className="w-full min-w-180">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                    Guest
                  </th>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                    Room
                  </th>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                    Check-in
                  </th>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                    Check-out
                  </th>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                    Price
                  </th>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredReservations.map((res) => (
                  <tr key={res.id} className="border-t border-gray-800 hover:bg-gray-800">
                    <td className="px-6 py-3">
                      <Link
                        href={`/dashboard/reservations/${res.id}`}
                        className="block group"
                      >
                        <p className="font-semibold text-gray-100 group-hover:text-indigo-300 transition">
                          {res.guest_name}
                        </p>
                        <p className="text-sm text-gray-400">
                          {res.guest_email}
                        </p>
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-gray-100">
                      {rooms.find((r) => r.id === res.room_id)?.room_number ||
                        'Unknown'}
                    </td>
                    <td className="px-6 py-3 text-gray-100">
                      {res.check_in_date}
                    </td>
                    <td className="px-6 py-3 text-gray-100">
                      {res.check_out_date}
                    </td>
                    <td className="px-6 py-3 text-gray-100">
                      {formatMoney(Number(res.total_price))}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-semibold capitalize ${STATUS_BADGE[res.status]}`}
                      >
                        {statusLabel(res.status)}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {renderActions(res)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards (no horizontal scroll) */}
          <div className="md:hidden space-y-4">
            {filteredReservations.map((res) => (
              <div
                key={res.id}
                className="bg-gray-900 border border-gray-800 rounded-lg shadow p-4"
              >
                <Link
                  href={`/dashboard/reservations/${res.id}`}
                  className="flex justify-between items-start gap-2 group"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-100 group-hover:text-indigo-300 transition">
                      {res.guest_name}
                    </p>
                    <p className="text-sm text-gray-400 break-all">{res.guest_email}</p>
                  </div>
                  <span
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_BADGE[res.status]}`}
                  >
                    {statusLabel(res.status)}
                  </span>
                </Link>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
                  <div>
                    <dt className="text-gray-500">Room</dt>
                    <dd className="text-gray-100">{roomNumberFor(res.room_id) || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Price</dt>
                    <dd className="text-gray-100">{formatMoney(Number(res.total_price))}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Check-in</dt>
                    <dd className="text-gray-100">{res.check_in_date}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Check-out</dt>
                    <dd className="text-gray-100">{res.check_out_date}</dd>
                  </div>
                </dl>

                <div className="mt-3 pt-3 border-t border-gray-800">
                  {renderActions(res)}
                </div>
              </div>
            ))}
          </div>
          </>
        )}

        {checkinTarget && (
          <CheckInDialog
            reservation={checkinTarget}
            roomNumber={rooms.find((r) => r.id === checkinTarget.room_id)?.room_number || 'Unknown'}
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
            roomNumber={rooms.find((r) => r.id === checkoutTarget.room_id)?.room_number || 'Unknown'}
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
