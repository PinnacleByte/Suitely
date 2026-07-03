'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { ReservationCharge, Item } from '@/lib/types'
import { formatIST } from '@/lib/formatDate'
import ItemGrid from '@/components/ItemGrid'

const CATEGORY_OPTIONS: ReservationCharge['category'][] = [
  'service',
  'damage',
  'discount',
  'tax',
  'other',
]

const CATEGORY_BADGE: Record<ReservationCharge['category'], string> = {
  service: 'bg-blue-500/20 text-blue-300',
  damage: 'bg-red-500/20 text-red-300',
  discount: 'bg-green-500/20 text-green-300',
  tax: 'bg-gray-500/20 text-gray-300',
  other: 'bg-purple-500/20 text-purple-300',
}

const money = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`)

type ChargeForm = {
  description: string
  amount: string
  category: ReservationCharge['category']
}

const emptyChargeForm: ChargeForm = { description: '', amount: '', category: 'service' }

// Itemized folio for a single reservation: the room cost (roomTotal, from
// reservations.total_price) plus any incidental charges/discounts on top
// of it. Self-contained so it can be dropped into a per-row expander
// without bloating the parent page's state.
export default function ReservationFolio({
  reservationId,
  roomTotal,
  guestName,
  roomNumber,
  checkInDate,
  checkOutDate,
}: {
  reservationId: string
  roomTotal: number
  guestName: string
  roomNumber: string
  checkInDate: string
  checkOutDate: string
}) {
  const [charges, setCharges] = useState<ReservationCharge[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [chargeMode, setChargeMode] = useState<'catalog' | 'custom'>('catalog')
  const [form, setForm] = useState<ChargeForm>(emptyChargeForm)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [items, setItems] = useState<Item[]>([])
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({})

  useEffect(() => {
    loadCharges()
    loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId])

  const loadCharges = async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('reservation_charges')
      .select('*')
      .eq('reservation_id', reservationId)
      .order('created_at', { ascending: true })

    if (loadError) {
      setError(loadError.message)
    } else {
      setCharges((data as ReservationCharge[]) || [])
    }
    setLoading(false)
  }

  const loadItems = async () => {
    const orgId = localStorage.getItem('orgId')
    if (!orgId) return
    const { data } = await supabase.from('items').select('*').eq('org_id', orgId).order('name')
    setItems((data as Item[]) || [])
  }

  const closeForm = () => {
    setShowForm(false)
    setItemQuantities({})
    setError('')
  }

  const handleAddCatalogItems = async () => {
    setError('')

    const lines = items
      .filter((item) => (itemQuantities[item.id] || 0) > 0)
      .map((item) => ({
        description: `${item.name} x${itemQuantities[item.id]}`,
        amount: Number(item.price) * itemQuantities[item.id],
      }))

    if (lines.length === 0) {
      setError('Select at least one item.')
      return
    }

    const orgId = localStorage.getItem('orgId')
    if (!orgId) return

    const { error: insertError } = await supabase.from('reservation_charges').insert(
      lines.map((line) => ({
        org_id: orgId,
        reservation_id: reservationId,
        description: line.description,
        amount: line.amount,
        category: 'service',
      }))
    )

    if (insertError) {
      setError(insertError.message)
      return
    }

    closeForm()
    loadCharges()
  }

  const handleAddCharge = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const amount = parseFloat(form.amount)
    if (!form.description.trim() || Number.isNaN(amount) || amount === 0) {
      setError('Enter a description and a non-zero amount.')
      return
    }

    const orgId = localStorage.getItem('orgId')
    if (!orgId) return

    const { error: insertError } = await supabase.from('reservation_charges').insert([
      {
        org_id: orgId,
        reservation_id: reservationId,
        description: form.description.trim(),
        amount,
        category: form.category,
      },
    ])

    if (insertError) {
      setError(insertError.message)
      return
    }

    setForm(emptyChargeForm)
    closeForm()
    loadCharges()
  }

  const handleDeleteCharge = async (charge: ReservationCharge) => {
    setBusyId(charge.id)
    const { error: deleteError } = await supabase
      .from('reservation_charges')
      .delete()
      .eq('id', charge.id)
    setBusyId(null)

    if (deleteError) {
      setError(deleteError.message)
      return
    }
    loadCharges()
  }

  const chargesTotal = charges.reduce((sum, c) => sum + Number(c.amount), 0)
  const grandTotal = roomTotal + chargesTotal

  // Opens a small, self-contained print window rather than adding a PDF
  // library or print stylesheet across the app — the browser's own
  // "Print" dialog already offers "Save as PDF", which covers the guest's
  // usual ask without new dependencies.
  const handlePrintReceipt = () => {
    const win = window.open('', '_blank', 'width=420,height=600')
    if (!win) return

    const chargeRows = charges
      .map(
        (c) =>
          `<div class="line"><span>${c.description}</span><span>${money(Number(c.amount))}</span></div>`
      )
      .join('')

    win.document.write(`
      <html>
        <head>
          <title>Receipt — ${guestName}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 18px; margin: 0 0 2px; }
            .muted { color: #666; font-size: 12px; margin: 0 0 16px; }
            .line { display: flex; justify-content: space-between; font-size: 14px; margin: 4px 0; }
            .total { display: flex; justify-content: space-between; font-weight: bold; font-size: 15px;
              border-top: 1px solid #ccc; padding-top: 8px; margin-top: 8px; }
            .printed { color: #999; font-size: 11px; margin-top: 24px; }
          </style>
        </head>
        <body>
          <h1>Suitely — Guest Receipt</h1>
          <p class="muted">
            ${guestName} · Room ${roomNumber}<br />
            ${checkInDate} &rarr; ${checkOutDate}
          </p>
          <div class="line"><span>Room charge</span><span>${money(roomTotal)}</span></div>
          ${chargeRows}
          <div class="total"><span>Total</span><span>${money(grandTotal)}</span></div>
          <p class="printed">Printed ${formatIST(new Date().toISOString())}</p>
        </body>
      </html>
    `)
    win.document.close()
    win.focus()
    win.print()
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading folio...</p>
  }

  return (
    <div>
      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-1.5 mb-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-300">Room charge</span>
          <span className="text-gray-100 font-semibold">{money(roomTotal)}</span>
        </div>

        <AnimatePresence>
          {charges.map((charge) => (
            <motion.div
              key={charge.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex justify-between items-center text-sm"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${CATEGORY_BADGE[charge.category]}`}
                >
                  {charge.category}
                </span>
                <span className="text-gray-300 truncate">{charge.description}</span>
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <span className={charge.amount < 0 ? 'text-green-400' : 'text-gray-100'}>
                  {money(Number(charge.amount))}
                </span>
                <button
                  onClick={() => handleDeleteCharge(charge)}
                  disabled={busyId === charge.id}
                  className="text-red-400 hover:text-red-300 text-xs font-semibold disabled:opacity-50"
                >
                  Remove
                </button>
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        <div className="flex justify-between items-center text-sm pt-2 border-t border-gray-800">
          <span className="font-bold text-gray-100">Total</span>
          <span className="flex items-center gap-3">
            <button
              onClick={handlePrintReceipt}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300"
            >
              Print Receipt
            </button>
            <span className="font-bold text-indigo-400">{money(grandTotal)}</span>
          </span>
        </div>
      </div>

      {showForm ? (
        <div className="bg-gray-800/50 rounded-lg p-3">
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setChargeMode('catalog')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                chargeMode === 'catalog'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              From Catalog
            </button>
            <button
              type="button"
              onClick={() => setChargeMode('custom')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                chargeMode === 'custom'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              Custom
            </button>
          </div>

          {chargeMode === 'catalog' ? (
            <div>
              {items.length === 0 ? (
                <p className="text-sm text-gray-500 mb-3">
                  No catalog items yet. Add some on the Items page, or use a custom charge.
                </p>
              ) : (
                <>
                  <ItemGrid
                    items={items}
                    quantities={itemQuantities}
                    onQuantityChange={(id, qty) =>
                      setItemQuantities((prev) => ({ ...prev, [id]: qty }))
                    }
                  />
                  <div className="flex justify-between text-sm mt-3 pt-2 border-t border-gray-700">
                    <span className="text-gray-300">Subtotal</span>
                    <span className="text-gray-100 font-semibold">
                      {money(
                        items.reduce(
                          (sum, item) => sum + Number(item.price) * (itemQuantities[item.id] || 0),
                          0
                        )
                      )}
                    </span>
                  </div>
                </>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleAddCatalogItems}
                  className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-500 transition"
                >
                  Add Items
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-1.5 text-gray-400 font-semibold text-sm hover:text-gray-200 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleAddCharge} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-35">
                <label className="block text-gray-400 text-xs font-semibold mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g., Minibar"
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-400 text-xs font-semibold mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as ReservationCharge['category'] })
                  }
                  className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm capitalize"
                >
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat} className="capitalize">
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs font-semibold mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="-10 for a discount"
                  className="w-32 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                  required
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-500 transition"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-1.5 text-gray-400 font-semibold text-sm hover:text-gray-200 transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
        >
          + Add Charge
        </button>
      )}
    </div>
  )
}
