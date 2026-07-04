'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { useAuth } from '@/lib/AuthContext'
import { ReservationCharge, Item, Payment, Invoice, InvoiceSnapshot } from '@/lib/types'
import { formatIST } from '@/lib/formatDate'
import { formatMoney, getCurrencyCode } from '@/lib/currency'
import { useConfirm } from '@/lib/ConfirmDialog'
import { useIdentityConfirm } from '@/lib/IdentityConfirm'
import { printInvoice } from '@/lib/printInvoice'
import ItemGrid from '@/components/ItemGrid'

const INVOICE_STATUS_BADGE: Record<Invoice['status'], string> = {
  issued: 'bg-blue-500/20 text-blue-300',
  paid: 'bg-emerald-500/20 text-emerald-300',
  void: 'bg-gray-600/30 text-gray-400 line-through',
}

const PAYMENT_METHODS: Payment['method'][] = ['cash', 'card', 'upi', 'bank_transfer', 'other']
const METHOD_LABEL: Record<Payment['method'], string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  other: 'Other',
}

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

const money = formatMoney

type ChargeForm = {
  description: string
  amount: string
  category: ReservationCharge['category']
}

const emptyChargeForm: ChargeForm = { description: '', amount: '', category: 'service' }

type PaymentForm = {
  amount: string
  method: Payment['method']
  note: string
}

const emptyPaymentForm: PaymentForm = { amount: '', method: 'cash', note: '' }

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
  const { confirm } = useConfirm()
  const { confirmIdentity } = useIdentityConfirm()
  const { profile } = useAuth()
  // Voiding an issued invoice is manager/admin only (RLS-enforced); staff
  // can issue but not void. This hides the Void control for staff.
  const canVoidInvoice = profile?.role === 'admin' || profile?.role === 'manager'
  const [charges, setCharges] = useState<ReservationCharge[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [issuing, setIssuing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [chargeMode, setChargeMode] = useState<'catalog' | 'custom'>('catalog')
  const [form, setForm] = useState<ChargeForm>(emptyChargeForm)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [items, setItems] = useState<Item[]>([])
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({})

  useEffect(() => {
    loadCharges()
    loadPayments()
    loadInvoices()
    loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId])

  useRealtimeRefresh(['reservation_charges', 'payments', 'invoices', 'items'], () => {
    loadCharges()
    loadPayments()
    loadInvoices()
    loadItems()
  })

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

  const loadPayments = async () => {
    const { data, error: loadError } = await supabase
      .from('payments')
      .select('*')
      .eq('reservation_id', reservationId)
      .order('paid_at', { ascending: true })

    if (loadError) {
      setError(loadError.message)
    } else {
      setPayments((data as Payment[]) || [])
    }
  }

  const loadInvoices = async () => {
    const { data, error: loadError } = await supabase
      .from('invoices')
      .select('*')
      .eq('reservation_id', reservationId)
      .order('issued_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
    } else {
      setInvoices((data as Invoice[]) || [])
    }
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

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const amount = parseFloat(paymentForm.amount)
    if (Number.isNaN(amount) || amount === 0) {
      setError('Enter a non-zero amount (use a negative amount for a refund).')
      return
    }

    const orgId = localStorage.getItem('orgId')
    if (!orgId) return

    // Shared-terminal accountability: confirm who's taking the payment.
    const actor = await confirmIdentity({ action: 'payment', entityId: reservationId })
    if (!actor) return

    const { error: insertError } = await supabase.from('payments').insert([
      {
        org_id: orgId,
        reservation_id: reservationId,
        amount,
        method: paymentForm.method,
        note: paymentForm.note.trim() || null,
      },
    ])

    if (insertError) {
      setError(insertError.message)
      return
    }

    setPaymentForm(emptyPaymentForm)
    setShowPaymentForm(false)
    loadPayments()
  }

  const handleDeletePayment = async (payment: Payment) => {
    setBusyId(payment.id)
    const { error: deleteError } = await supabase.from('payments').delete().eq('id', payment.id)
    setBusyId(null)

    if (deleteError) {
      setError(deleteError.message)
      return
    }
    loadPayments()
  }

  const chargesTotal = charges.reduce((sum, c) => sum + Number(c.amount), 0)
  const grandTotal = roomTotal + chargesTotal
  const paidTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0)
  const balanceDue = grandTotal - paidTotal

  // Issue a formal, immutable invoice: allocate a race-safe date-based
  // number (SECURITY DEFINER RPC), then freeze the current folio state into
  // the snapshot. No tax yet (Billing Phase C) — subtotal == total.
  const handleIssueInvoice = async () => {
    setError('')

    const orgId = localStorage.getItem('orgId')
    if (!orgId) return

    // Shared-terminal accountability: confirm who's issuing the invoice.
    const actor = await confirmIdentity({ action: 'invoice', entityId: reservationId })
    if (!actor) return

    setIssuing(true)

    const { data: number, error: numberError } = await supabase.rpc('next_invoice_number', {
      p_org: orgId,
    })
    if (numberError || !number) {
      setError(numberError?.message || 'Could not allocate an invoice number.')
      setIssuing(false)
      return
    }

    const snapshot: InvoiceSnapshot = {
      guest_name: guestName,
      room_number: roomNumber,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      currency: getCurrencyCode(),
      lines: [
        { description: 'Room charge', amount: roomTotal },
        ...charges.map((c) => ({ description: c.description, amount: Number(c.amount) })),
      ],
      subtotal: grandTotal,
      tax_total: 0,
      total: grandTotal,
      amount_paid: paidTotal,
      balance_due: balanceDue,
      issued_at: new Date().toISOString(),
    }

    const { error: insertError } = await supabase.from('invoices').insert([
      {
        org_id: orgId,
        reservation_id: reservationId,
        invoice_number: number,
        status: balanceDue <= 0 ? 'paid' : 'issued',
        snapshot,
        subtotal: grandTotal,
        tax_total: 0,
        total: grandTotal,
      },
    ])

    setIssuing(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    loadInvoices()
  }

  const handleVoidInvoice = async (invoice: Invoice) => {
    const ok = await confirm({
      title: `Void ${invoice.invoice_number}?`,
      message:
        'The invoice number is retained and the record is kept — it will just be marked void. This cannot be undone.',
      confirmLabel: 'Void invoice',
      danger: true,
    })
    if (!ok) return

    const { error: voidError } = await supabase
      .from('invoices')
      .update({ status: 'void' })
      .eq('id', invoice.id)

    if (voidError) {
      setError(voidError.message)
      return
    }
    loadInvoices()
  }


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

    const paymentRows = payments
      .map(
        (p) =>
          `<div class="line"><span>${p.amount < 0 ? 'Refund' : 'Paid'} — ${METHOD_LABEL[p.method]}${p.note ? ' · ' + p.note : ''}</span><span>${money(Number(p.amount))}</span></div>`
      )
      .join('')

    const balanceLabel = balanceDue > 0 ? 'Balance Due' : balanceDue < 0 ? 'Refund Due' : 'Settled'
    const balanceClass = balanceDue > 0 ? 'due' : balanceDue < 0 ? 'refund' : 'settled'

    win.document.write(`
      <html>
        <head>
          <title>Receipt — ${guestName}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 18px; margin: 0 0 2px; }
            .muted { color: #666; font-size: 12px; margin: 0 0 16px; }
            .line { display: flex; justify-content: space-between; font-size: 14px; margin: 4px 0; }
            .total { display: flex; justify-content: space-between; font-weight: bold; font-size: 16px;
              border-top: 1px solid #ccc; padding-top: 8px; margin-top: 8px; }
            .grand { display: flex; justify-content: space-between; font-weight: bold; font-size: 20px;
              border-top: 2px solid #333; padding-top: 10px; margin-top: 10px; }
            .grand.due { color: #b45309; }
            .grand.refund { color: #c2410c; }
            .grand.settled { color: #047857; }
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
          <div class="total"><span>Total Charges</span><span>${money(grandTotal)}</span></div>
          ${paymentRows}
          <div class="total"><span>Total Paid</span><span>${money(paidTotal)}</span></div>
          <div class="grand ${balanceClass}"><span>${balanceLabel}</span><span>${money(Math.abs(balanceDue))}</span></div>
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
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Charges</p>
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

        <div className="flex justify-between items-center pt-2 border-t border-gray-800">
          <span className="font-bold text-gray-100 text-base">Total Charges</span>
          <span className="flex items-center gap-3">
            <button
              onClick={handlePrintReceipt}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300"
            >
              Print Receipt
            </button>
            <span className="font-bold text-indigo-400 text-lg">{money(grandTotal)}</span>
          </span>
        </div>

        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-3">Payments</p>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-500">No payments recorded yet.</p>
        ) : (
          <AnimatePresence>
            {payments.map((payment) => (
              <motion.div
                key={payment.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex justify-between items-center text-sm"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      payment.amount < 0
                        ? 'bg-orange-500/20 text-orange-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {payment.amount < 0 ? 'Refund' : 'Paid'}
                  </span>
                  <span className="text-gray-300 truncate">
                    {METHOD_LABEL[payment.method]}
                    {payment.note ? ` · ${payment.note}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  <span
                    className={`font-semibold ${payment.amount < 0 ? 'text-orange-400' : 'text-emerald-400'}`}
                  >
                    {money(Number(payment.amount))}
                  </span>
                  <button
                    onClick={() => handleDeletePayment(payment)}
                    disabled={busyId === payment.id}
                    className="text-red-400 hover:text-red-300 text-xs font-semibold disabled:opacity-50"
                  >
                    Remove
                  </button>
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        <div className="flex justify-between items-center pt-2 border-t border-gray-800">
          <span className="font-bold text-gray-100 text-base">Total Paid</span>
          <span className="font-bold text-emerald-400 text-lg">{money(paidTotal)}</span>
        </div>

        <div className="flex justify-between items-center pt-3 mt-1 border-t-2 border-gray-700">
          <span className="font-bold text-gray-100 text-lg">
            {balanceDue > 0 ? 'Balance Due' : balanceDue < 0 ? 'Refund Due' : 'Settled'}
          </span>
          <span
            className={`font-bold text-xl ${
              balanceDue > 0
                ? 'text-amber-400'
                : balanceDue < 0
                  ? 'text-orange-400'
                  : 'text-emerald-400'
            }`}
          >
            {money(Math.abs(balanceDue))}
          </span>
        </div>
      </div>

      {invoices.length > 0 && (
        <div className="mb-3 pt-3 border-t border-gray-800 space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoices</p>
          <AnimatePresence>
            {invoices.map((inv) => (
              <motion.div
                key={inv.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex justify-between items-center text-sm"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${INVOICE_STATUS_BADGE[inv.status]}`}
                  >
                    {inv.status}
                  </span>
                  <span className="text-gray-300 truncate">{inv.invoice_number}</span>
                  <span className="text-gray-500 shrink-0">{money(Number(inv.total))}</span>
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => printInvoice(inv)}
                    className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold"
                  >
                    Print
                  </button>
                  {inv.status !== 'void' && canVoidInvoice && (
                    <button
                      onClick={() => handleVoidInvoice(inv)}
                      className="text-red-400 hover:text-red-300 text-xs font-semibold"
                    >
                      Void
                    </button>
                  )}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

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
      ) : showPaymentForm ? (
        <form
          onSubmit={handleAddPayment}
          className="bg-gray-800/50 rounded-lg p-3 flex flex-wrap items-end gap-3"
        >
          <div>
            <label className="block text-gray-400 text-xs font-semibold mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              value={paymentForm.amount}
              onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
              placeholder="-50 for a refund"
              className="w-32 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-gray-400 text-xs font-semibold mb-1">Method</label>
            <select
              value={paymentForm.method}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, method: e.target.value as Payment['method'] })
              }
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-35">
            <label className="block text-gray-400 text-xs font-semibold mb-1">Note (optional)</label>
            <input
              type="text"
              value={paymentForm.note}
              onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
              placeholder="e.g., Deposit, card ****1234"
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-500 transition"
            >
              Record
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPaymentForm(false)
                setPaymentForm(emptyPaymentForm)
                setError('')
              }}
              className="px-4 py-1.5 text-gray-400 font-semibold text-sm hover:text-gray-200 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-4">
          <button
            onClick={() => setShowForm(true)}
            className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
          >
            + Add Charge
          </button>
          <button
            onClick={() => setShowPaymentForm(true)}
            className="text-sm font-semibold text-emerald-400 hover:text-emerald-300"
          >
            + Record Payment
          </button>
          <button
            onClick={handleIssueInvoice}
            disabled={issuing}
            className="text-sm font-semibold text-gray-300 hover:text-white disabled:opacity-50"
          >
            {issuing ? 'Issuing…' : 'Issue Invoice'}
          </button>
        </div>
      )}
    </div>
  )
}
