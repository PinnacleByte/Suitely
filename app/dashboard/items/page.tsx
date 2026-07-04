'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { useAuth } from '@/lib/AuthContext'
import { Item } from '@/lib/types'
import { formatMoney } from '@/lib/currency'
import { useConfirm } from '@/lib/ConfirmDialog'

type ItemForm = { name: string; price: string }
const emptyForm: ItemForm = { name: '', price: '' }

export default function ItemsPage() {
  const { confirm } = useConfirm()
  const { profile } = useAuth()
  // Catalog changes are admin-only (RLS-enforced); everyone can still read
  // the list to add folio charges. This hides the write controls for others.
  const canManageItems = profile?.role === 'admin'
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ItemForm>(emptyForm)
  const [error, setError] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  useRealtimeRefresh(['items'], () => loadData())

  const loadData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const { data } = await supabase
        .from('items')
        .select('*')
        .eq('org_id', orgId)
        .order('name')

      setItems((data as Item[]) || [])
    } catch (err) {
      console.error('Failed to load items:', err)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(false)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const payload = {
        org_id: orgId,
        name: form.name,
        price: parseFloat(form.price),
      }

      const { error: submitError } = editingId
        ? await supabase.from('items').update(payload).eq('id', editingId)
        : await supabase.from('items').insert([payload])

      if (submitError) {
        setError(submitError.message)
        return
      }

      resetForm()
      loadData()
    } catch (err) {
      console.error('Failed to save item:', err)
      setError('Failed to save item. Please try again.')
    }
  }

  const handleEdit = (item: Item) => {
    setForm({ name: item.name, price: String(item.price) })
    setEditingId(item.id)
    setShowForm(true)
    setError('')
  }

  const handleDelete = async (item: Item) => {
    const ok = await confirm({
      title: `Delete "${item.name}"?`,
      message: "This won't affect charges already added to a folio.",
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    const { error: deleteError } = await supabase.from('items').delete().eq('id', item.id)

    if (deleteError) {
      setError(deleteError.message)
      return
    }
    loadData()
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-100">Items</h1>
          <p className="text-gray-400 mt-2">
            Priced extras (minibar, amenities, kits) staff can add to a guest&apos;s folio.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <a
            href="/dashboard/settings"
            className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
          >
            ← Back to Settings
          </a>
          {canManageItems && (
            <button
              onClick={() => (showForm ? resetForm() : setShowForm(true))}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
            >
              {showForm ? 'Cancel' : '+ New Item'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30">
          {error}
        </div>
      )}

      <AnimatePresence>
        {showForm && canManageItems && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
              <h3 className="text-xl font-bold mb-4 text-gray-100">
                {editingId ? 'Edit Item' : 'New Item'}
              </h3>
              <form onSubmit={handleSubmit} className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Extra Water Bottle"
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">Price</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                  >
                    {editingId ? 'Save Changes' : 'Create Item'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-gray-900 border border-gray-800 rounded-lg shadow overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No items yet. Add extras staff can charge to a guest&apos;s folio.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left text-gray-300 font-semibold">Name</th>
                <th className="px-6 py-3 text-left text-gray-300 font-semibold">Price</th>
                {canManageItems && (
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-gray-800 hover:bg-gray-800">
                  <td className="px-6 py-3 text-gray-100 font-semibold">{item.name}</td>
                  <td className="px-6 py-3 text-gray-100">{formatMoney(Number(item.price))}</td>
                  {canManageItems && (
                    <td className="px-6 py-3">
                      <div className="flex gap-3 text-sm font-semibold">
                        <button
                          onClick={() => handleEdit(item)}
                          className="text-indigo-400 hover:text-indigo-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
