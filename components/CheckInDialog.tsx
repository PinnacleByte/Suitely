'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { Reservation, RoomType } from '@/lib/types'

const MS_PER_DAY = 1000 * 60 * 60 * 24
const nightsBetween = (start: string, end: string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / MS_PER_DAY)

const STEP_LABELS = ['Occupancy', 'Guest IDs', 'Review']

const money = (n: number) => `$${n.toFixed(2)}`

type GuestSlot = { name: string; id_type: string; id_number: string }

// Confirms how many guests are actually staying (not just the lead
// guest on file), auto-surcharges anyone over the room type's capacity,
// and optionally captures an ID for each occupant. ID capture is
// deliberately optional — front desk can check someone in before ID is
// handed over and fill it in later from the reservation's Guests panel.
export default function CheckInDialog({
  reservation,
  roomNumber,
  onClose,
  onCheckedIn,
}: {
  reservation: Reservation
  roomNumber: string
  onClose: () => void
  onCheckedIn: () => void
}) {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [roomType, setRoomType] = useState<RoomType | null>(null)
  const [guestCount, setGuestCount] = useState(1)
  const [leadIdType, setLeadIdType] = useState('')
  const [leadIdNumber, setLeadIdNumber] = useState('')
  const [additionalGuests, setAdditionalGuests] = useState<GuestSlot[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadRoomType = async () => {
      const { data: room } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', reservation.room_id)
        .single()

      if (room) {
        const { data: type } = await supabase
          .from('room_types')
          .select('*')
          .eq('id', room.room_type_id)
          .single()
        setRoomType((type as RoomType) || null)
      }
      setLoading(false)
    }
    loadRoomType()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the additional-guest slots (everyone but the lead guest) in sync
  // with the entered headcount.
  useEffect(() => {
    const needed = Math.max(0, guestCount - 1)
    setAdditionalGuests((prev) => {
      const next = [...prev.slice(0, needed)]
      while (next.length < needed) next.push({ name: '', id_type: '', id_number: '' })
      return next
    })
  }, [guestCount])

  const nights = nightsBetween(reservation.check_in_date, reservation.check_out_date)
  const maxGuests = roomType?.max_guests ?? null
  const excessGuests = maxGuests !== null ? Math.max(0, guestCount - maxGuests) : 0
  const nightlyFee = roomType ? Number(roomType.extra_guest_fee) : 0
  const surcharge = Math.round(excessGuests * nightlyFee * nights * 100) / 100

  const goNext = () => {
    setError('')
    if (step === 1 && (!Number.isFinite(guestCount) || guestCount < 1)) {
      setError('Enter at least 1 guest.')
      return
    }
    setStep((s) => Math.min(3, s + 1))
  }
  const goBack = () => setStep((s) => Math.max(1, s - 1))

  const updateAdditionalGuest = (index: number, field: keyof GuestSlot, value: string) => {
    setAdditionalGuests((prev) =>
      prev.map((g, i) => (i === index ? { ...g, [field]: value } : g))
    )
  }

  const handleConfirm = async () => {
    setError('')
    setSubmitting(true)

    const { error: updateError } = await supabase
      .from('reservations')
      .update({
        status: 'checked_in',
        guest_count: guestCount,
        guest_id_type: leadIdType.trim() || null,
        guest_id_number: leadIdNumber.trim() || null,
      })
      .eq('id', reservation.id)

    if (updateError) {
      setSubmitting(false)
      setError(updateError.message)
      return
    }

    const orgId = localStorage.getItem('orgId')
    if (orgId) {
      const namedGuests = additionalGuests.filter((g) => g.name.trim())
      if (namedGuests.length > 0) {
        await supabase.from('reservation_guests').insert(
          namedGuests.map((g) => ({
            org_id: orgId,
            reservation_id: reservation.id,
            name: g.name.trim(),
            id_type: g.id_type.trim() || null,
            id_number: g.id_number.trim() || null,
          }))
        )
      }

      if (surcharge > 0) {
        await supabase.from('reservation_charges').insert([
          {
            org_id: orgId,
            reservation_id: reservation.id,
            description: `Extra guest surcharge: ${excessGuests} over capacity × ${nights} night${nights === 1 ? '' : 's'}`,
            amount: surcharge,
            category: 'service',
          },
        ])
      }
    }

    setSubmitting(false)
    onCheckedIn()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-lg shadow-xl p-6 max-h-[85vh] overflow-y-auto"
      >
        <h2 className="text-xl font-bold text-gray-100 mb-1">Check In</h2>
        <p className="text-sm text-gray-400 mb-5">
          {reservation.guest_name} · Room {roomNumber}
        </p>

        {/* Step indicator */}
        <div className="flex items-center mb-6">
          {STEP_LABELS.map((label, i) => {
            const stepNum = i + 1
            const isActive = stepNum === step
            const isDone = stepNum < step
            return (
              <div key={label} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                      isDone || isActive ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {isDone ? '✓' : stepNum}
                  </div>
                  <span
                    className={`text-xs mt-1 font-medium ${isActive ? 'text-indigo-400' : 'text-gray-500'}`}
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
                      transition={{ duration: 0.25 }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-400">Loading room details...</p>
        ) : (
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <label className="block text-gray-300 font-semibold mb-2 text-sm">
                  How many guests are staying in this room?
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={guestCount}
                  onChange={(e) => setGuestCount(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 mb-3"
                />
                {maxGuests !== null && (
                  <p className="text-xs text-gray-500 mb-3">
                    This room type sleeps up to {maxGuests} guest{maxGuests === 1 ? '' : 's'}.
                  </p>
                )}
                {surcharge > 0 && (
                  <div className="px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-sm text-indigo-300">
                    {money(nightlyFee)}/night × {excessGuests} extra guest{excessGuests === 1 ? '' : 's'} ×{' '}
                    {nights} night{nights === 1 ? '' : 's'} = {money(surcharge)} surcharge will be added
                    to the folio.
                  </div>
                )}
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <p className="text-sm text-gray-400 mb-3">
                  ID capture is optional — can be added later from the reservation&apos;s Guests
                  panel.
                </p>

                <div className="bg-gray-800/50 rounded-lg p-3 mb-3">
                  <p className="text-sm font-semibold text-gray-100 mb-2">
                    {reservation.guest_name} <span className="text-gray-500 font-normal">(lead guest)</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={leadIdType}
                      onChange={(e) => setLeadIdType(e.target.value)}
                      placeholder="ID type (e.g. Aadhaar)"
                      className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                    />
                    <input
                      type="text"
                      value={leadIdNumber}
                      onChange={(e) => setLeadIdNumber(e.target.value)}
                      placeholder="ID number"
                      className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                    />
                  </div>
                </div>

                {additionalGuests.map((guest, i) => (
                  <div key={i} className="bg-gray-800/50 rounded-lg p-3 mb-3">
                    <input
                      type="text"
                      value={guest.name}
                      onChange={(e) => updateAdditionalGuest(i, 'name', e.target.value)}
                      placeholder={`Guest ${i + 2} name`}
                      className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm mb-2"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={guest.id_type}
                        onChange={(e) => updateAdditionalGuest(i, 'id_type', e.target.value)}
                        placeholder="ID type (e.g. Aadhaar)"
                        className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                      />
                      <input
                        type="text"
                        value={guest.id_number}
                        onChange={(e) => updateAdditionalGuest(i, 'id_number', e.target.value)}
                        placeholder="ID number"
                        className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                      />
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-300">Guests</span>
                    <span className="text-gray-100">{guestCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">{reservation.guest_name} (lead)</span>
                    <span className="text-gray-100">
                      {leadIdType || leadIdNumber ? `${leadIdType || 'ID'}: ${leadIdNumber || '—'}` : 'No ID entered'}
                    </span>
                  </div>
                  {additionalGuests.map((guest, i) =>
                    guest.name.trim() ? (
                      <div key={i} className="flex justify-between">
                        <span className="text-gray-300">{guest.name}</span>
                        <span className="text-gray-100">
                          {guest.id_type || guest.id_number
                            ? `${guest.id_type || 'ID'}: ${guest.id_number || '—'}`
                            : 'No ID entered'}
                        </span>
                      </div>
                    ) : null
                  )}
                  {surcharge > 0 && (
                    <div className="flex justify-between pt-2 border-t border-gray-800">
                      <span className="font-bold text-gray-100">Extra guest surcharge</span>
                      <span className="font-bold text-indigo-400">{money(surcharge)}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        <div className="flex items-center gap-3 mt-6">
          {step > 1 && (
            <button
              onClick={goBack}
              disabled={submitting}
              className="px-4 py-2 text-gray-400 font-semibold hover:text-gray-200 transition disabled:opacity-50"
            >
              Back
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-gray-400 font-semibold hover:text-gray-200 transition disabled:opacity-50"
          >
            Cancel
          </button>
          {step < 3 ? (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={goNext}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition disabled:opacity-50"
            >
              Next
            </motion.button>
          ) : (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition disabled:opacity-50"
            >
              {submitting ? 'Checking in...' : 'Confirm Check In'}
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
