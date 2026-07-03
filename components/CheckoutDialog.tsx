'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { Reservation, Item } from '@/lib/types'
import { todayIST } from '@/lib/formatDate'
import ItemGrid from '@/components/ItemGrid'

const MS_PER_DAY = 1000 * 60 * 60 * 24
const nightsBetween = (start: string, end: string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / MS_PER_DAY)

const STEP_LABELS = ['Departure', 'Items', 'Review']

const money = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`)

// Confirms a guest's actual departure date, lets staff add any extra items
// used during the stay, then checks them out in one step. Capturing the
// real date (not just flipping status) matters because the booking
// wizard's overlap check treats any non-cancelled reservation as occupying
// its room through check_out_date — a stale future date on an early
// departure would keep blocking rebookings for nights the guest actually
// vacated. Early departures are also credited automatically.
export default function CheckoutDialog({
  reservation,
  roomNumber,
  onClose,
  onCheckedOut,
}: {
  reservation: Reservation
  roomNumber: string
  onClose: () => void
  onCheckedOut: () => void
}) {
  const [step, setStep] = useState(1)
  const [checkoutDate, setCheckoutDate] = useState(todayIST())
  const [items, setItems] = useState<Item[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const orgId = localStorage.getItem('orgId')
    if (!orgId) return
    supabase
      .from('items')
      .select('*')
      .eq('org_id', orgId)
      .order('name')
      .then(({ data }) => setItems((data as Item[]) || []))
  }, [])

  const originalNights = nightsBetween(reservation.check_in_date, reservation.check_out_date)
  const actualNights = nightsBetween(reservation.check_in_date, checkoutDate)
  const unusedNights = Math.max(0, originalNights - actualNights)
  const nightlyRate = originalNights > 0 ? Number(reservation.total_price) / originalNights : 0
  const credit = Math.round(unusedNights * nightlyRate * 100) / 100

  const itemLines = items
    .filter((item) => (quantities[item.id] || 0) > 0)
    .map((item) => ({
      description: `${item.name} x${quantities[item.id]}`,
      amount: Number(item.price) * quantities[item.id],
    }))
  const itemsSubtotal = itemLines.reduce((sum, line) => sum + line.amount, 0)
  const grandTotal = Number(reservation.total_price) - credit + itemsSubtotal

  const goNext = () => {
    setError('')
    if (step === 1 && checkoutDate < reservation.check_in_date) {
      setError('Checkout date cannot be before the check-in date.')
      return
    }
    setStep((s) => Math.min(3, s + 1))
  }
  const goBack = () => setStep((s) => Math.max(1, s - 1))

  const handleConfirm = async () => {
    setError('')
    setSubmitting(true)

    const { error: updateError } = await supabase
      .from('reservations')
      .update({ status: 'checked_out', check_out_date: checkoutDate })
      .eq('id', reservation.id)

    if (updateError) {
      setSubmitting(false)
      setError(updateError.message)
      return
    }

    // Auto-credit unused nights and log any items as folio line items, so
    // the shortened stay / extras are reflected transparently (and
    // reversibly — both are removable from the Folio panel) rather than
    // silently adjusting total_price.
    const orgId = localStorage.getItem('orgId')
    if (orgId) {
      const chargeRows: { org_id: string; reservation_id: string; description: string; amount: number; category: string }[] = []

      if (credit > 0) {
        chargeRows.push({
          org_id: orgId,
          reservation_id: reservation.id,
          description: `Early checkout credit: ${unusedNights} unused night${unusedNights === 1 ? '' : 's'}`,
          amount: -credit,
          category: 'discount',
        })
      }
      for (const line of itemLines) {
        chargeRows.push({
          org_id: orgId,
          reservation_id: reservation.id,
          description: line.description,
          amount: line.amount,
          category: 'service',
        })
      }

      if (chargeRows.length > 0) {
        await supabase.from('reservation_charges').insert(chargeRows)
      }
    }

    setSubmitting(false)
    onCheckedOut()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-lg shadow-xl p-6"
      >
        <h2 className="text-xl font-bold text-gray-100 mb-1">Check Out</h2>
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
                Actual checkout date
              </label>
              <input
                type="date"
                value={checkoutDate}
                min={reservation.check_in_date}
                onChange={(e) => setCheckoutDate(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 mb-4"
              />
              {checkoutDate !== reservation.check_out_date && (
                <div className="px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-sm text-indigo-300">
                  {unusedNights > 0
                    ? `Leaving ${unusedNights} night${unusedNights === 1 ? '' : 's'} early — a ${money(credit)} credit will be added to the folio.`
                    : `Original checkout date was ${reservation.check_out_date}.`}
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
                Add any extra items the guest used (optional).
              </p>
              <ItemGrid
                items={items}
                quantities={quantities}
                onQuantityChange={(id, qty) => setQuantities((prev) => ({ ...prev, [id]: qty }))}
              />
              {itemsSubtotal > 0 && (
                <div className="flex justify-between text-sm mt-4 pt-3 border-t border-gray-800">
                  <span className="text-gray-300">Items subtotal</span>
                  <span className="text-gray-100 font-semibold">{money(itemsSubtotal)}</span>
                </div>
              )}
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
              <div className="space-y-1.5 mb-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">Room charge</span>
                  <span className="text-gray-100">{money(Number(reservation.total_price))}</span>
                </div>
                {credit > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-300">
                      Early checkout credit ({unusedNights} night{unusedNights === 1 ? '' : 's'})
                    </span>
                    <span className="text-green-400">{money(-credit)}</span>
                  </div>
                )}
                {itemLines.map((line, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-gray-300">{line.description}</span>
                    <span className="text-gray-100">{money(line.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-gray-800">
                  <span className="font-bold text-gray-100">Total</span>
                  <span className="font-bold text-indigo-400">{money(grandTotal)}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
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
              {submitting ? 'Checking out...' : 'Confirm Check Out'}
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
