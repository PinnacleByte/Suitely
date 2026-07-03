'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { ReservationGuest } from '@/lib/types'

type GuestForm = { name: string; id_type: string; id_number: string }
const emptyGuestForm: GuestForm = { name: '', id_type: '', id_number: '' }

// View/edit the lead guest's ID plus every additional occupant's name+ID.
// Separate from the check-in wizard on purpose — ID capture there is
// optional, so this is where staff fill in or correct IDs afterward.
export default function ReservationGuests({
  reservationId,
  guestCount,
  leadGuestName,
  leadIdType,
  leadIdNumber,
}: {
  reservationId: string
  guestCount: number | null
  leadGuestName: string
  leadIdType: string | null
  leadIdNumber: string | null
}) {
  const [guests, setGuests] = useState<ReservationGuest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [leadType, setLeadType] = useState(leadIdType || '')
  const [leadNumber, setLeadNumber] = useState(leadIdNumber || '')
  const [savingLead, setSavingLead] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<GuestForm>(emptyGuestForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    loadGuests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId])

  const loadGuests = async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('reservation_guests')
      .select('*')
      .eq('reservation_id', reservationId)
      .order('created_at', { ascending: true })

    if (loadError) {
      setError(loadError.message)
    } else {
      setGuests((data as ReservationGuest[]) || [])
    }
    setLoading(false)
  }

  const saveLeadId = async () => {
    setSavingLead(true)
    const { error: updateError } = await supabase
      .from('reservations')
      .update({ guest_id_type: leadType.trim() || null, guest_id_number: leadNumber.trim() || null })
      .eq('id', reservationId)
    setSavingLead(false)

    if (updateError) setError(updateError.message)
  }

  const openAdd = () => {
    setForm(emptyGuestForm)
    setEditingId(null)
    setShowForm(true)
    setError('')
  }

  const openEdit = (guest: ReservationGuest) => {
    setForm({ name: guest.name, id_type: guest.id_type || '', id_number: guest.id_number || '' })
    setEditingId(guest.id)
    setShowForm(true)
    setError('')
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!form.name.trim()) {
      setError('Enter a name.')
      return
    }

    const orgId = localStorage.getItem('orgId')
    if (!orgId) return

    const payload = {
      name: form.name.trim(),
      id_type: form.id_type.trim() || null,
      id_number: form.id_number.trim() || null,
    }

    const { error: submitError } = editingId
      ? await supabase.from('reservation_guests').update(payload).eq('id', editingId)
      : await supabase
          .from('reservation_guests')
          .insert([{ ...payload, org_id: orgId, reservation_id: reservationId }])

    if (submitError) {
      setError(submitError.message)
      return
    }

    closeForm()
    loadGuests()
  }

  const handleDelete = async (guest: ReservationGuest) => {
    setBusyId(guest.id)
    const { error: deleteError } = await supabase
      .from('reservation_guests')
      .delete()
      .eq('id', guest.id)
    setBusyId(null)

    if (deleteError) {
      setError(deleteError.message)
      return
    }
    loadGuests()
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading guests...</p>
  }

  return (
    <div>
      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30 text-sm">
          {error}
        </div>
      )}

      <p className="text-xs text-gray-500 mb-3">
        {guestCount !== null
          ? `${guestCount} guest${guestCount === 1 ? '' : 's'} on file`
          : 'Guest count not yet recorded (set at check-in).'}
      </p>

      <div className="bg-gray-800/50 rounded-lg p-3 mb-3">
        <p className="text-sm font-semibold text-gray-100 mb-2">
          {leadGuestName} <span className="text-gray-500 font-normal">(lead guest)</span>
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="text"
            value={leadType}
            onChange={(e) => setLeadType(e.target.value)}
            placeholder="ID type (e.g. Aadhaar)"
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
          />
          <input
            type="text"
            value={leadNumber}
            onChange={(e) => setLeadNumber(e.target.value)}
            placeholder="ID number"
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
          />
          <button
            onClick={saveLeadId}
            disabled={savingLead}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-500 transition disabled:opacity-50"
          >
            {savingLead ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {guests.map((guest) => (
          <motion.div
            key={guest.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex justify-between items-center bg-gray-800/50 rounded-lg p-3 mb-2 text-sm"
          >
            <div>
              <p className="font-semibold text-gray-100">{guest.name}</p>
              <p className="text-xs text-gray-400">
                {guest.id_type || guest.id_number
                  ? `${guest.id_type || 'ID'}: ${guest.id_number || '—'}`
                  : 'No ID entered'}
              </p>
            </div>
            <div className="flex gap-3 text-xs font-semibold">
              <button onClick={() => openEdit(guest)} className="text-indigo-400 hover:text-indigo-300">
                Edit
              </button>
              <button
                onClick={() => handleDelete(guest)}
                disabled={busyId === guest.id}
                className="text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {showForm ? (
        <form onSubmit={handleSubmit} className="bg-gray-800/50 rounded-lg p-3 mt-2">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Guest name"
            className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm mb-2"
          />
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="text"
              value={form.id_type}
              onChange={(e) => setForm({ ...form, id_type: e.target.value })}
              placeholder="ID type"
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
            />
            <input
              type="text"
              value={form.id_number}
              onChange={(e) => setForm({ ...form, id_number: e.target.value })}
              placeholder="ID number"
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-500 transition"
            >
              {editingId ? 'Save' : 'Add'}
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
      ) : (
        <button
          onClick={openAdd}
          className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
        >
          + Add Guest
        </button>
      )}
    </div>
  )
}
