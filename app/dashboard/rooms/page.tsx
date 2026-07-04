'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { useAuth } from '@/lib/AuthContext'
import { Room, RoomType, MaintenanceLog } from '@/lib/types'
import { formatMoney } from '@/lib/currency'
import { useConfirm } from '@/lib/ConfirmDialog'

const STATUS_FILTERS: Array<'all' | Room['status']> = [
  'all',
  'available',
  'occupied',
  'cleaning',
  'maintenance',
]

const sortByRoomNumber = (a: Room, b: Room) =>
  a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: 'base' })

export default function RoomsPage() {
  const { confirm } = useConfirm()
  const { profile } = useAuth()
  // Rooms/room-types are inventory config: manager + admin only (RLS-enforced;
  // this just hides the write controls staff can't use). Staff still see the
  // room grid read-only, and can act on maintenance from the Housekeeping page.
  const canManageRooms = profile?.role === 'admin' || profile?.role === 'manager'
  const [rooms, setRooms] = useState<Room[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([])
  const [loading, setLoading] = useState(true)
  const [showRoomForm, setShowRoomForm] = useState(false)
  const [showTypeForm, setShowTypeForm] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | Room['status']>('all')
  const [error, setError] = useState('')
  const [roomForm, setRoomForm] = useState({
    room_number: '',
    room_type_id: '',
    status: 'available',
  })
  const [typeForm, setTypeForm] = useState({
    name: '',
    description: '',
    base_price: '',
    max_guests: '',
    extra_guest_fee: '',
  })

  useEffect(() => {
    loadData()
  }, [])

  useRealtimeRefresh(['rooms', 'room_types', 'maintenance_logs'], () => loadData())

  const loadData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const [roomsData, typesData, maintenanceData] = await Promise.all([
        supabase.from('rooms').select('*').eq('org_id', orgId),
        supabase.from('room_types').select('*').eq('org_id', orgId),
        supabase.from('maintenance_logs').select('*').eq('org_id', orgId).neq('status', 'completed'),
      ])

      setRooms((roomsData.data as Room[]) || [])
      setRoomTypes((typesData.data as RoomType[]) || [])
      setMaintenanceLogs((maintenanceData.data as MaintenanceLog[]) || [])
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const resetTypeForm = () => {
    setTypeForm({ name: '', description: '', base_price: '', max_guests: '', extra_guest_fee: '' })
    setEditingTypeId(null)
    setShowTypeForm(false)
  }

  const resetRoomForm = () => {
    setRoomForm({ room_number: '', room_type_id: '', status: 'available' })
    setEditingRoomId(null)
    setShowRoomForm(false)
  }

  const handleTypeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const payload = {
        org_id: orgId,
        name: typeForm.name,
        description: typeForm.description,
        base_price: parseFloat(typeForm.base_price),
        max_guests: parseInt(typeForm.max_guests),
        extra_guest_fee: parseFloat(typeForm.extra_guest_fee) || 0,
      }

      const { error: submitError } = editingTypeId
        ? await supabase.from('room_types').update(payload).eq('id', editingTypeId)
        : await supabase.from('room_types').insert([payload])

      if (submitError) {
        setError(submitError.message)
        return
      }

      resetTypeForm()
      loadData()
    } catch (err) {
      console.error('Failed to save room type:', err)
      setError('Failed to save room type. Please try again.')
    }
  }

  const handleEditType = (type: RoomType) => {
    setTypeForm({
      name: type.name,
      description: type.description || '',
      base_price: String(type.base_price),
      max_guests: String(type.max_guests),
      extra_guest_fee: String(type.extra_guest_fee),
    })
    setEditingTypeId(type.id)
    setShowTypeForm(true)
    setError('')
  }

  const handleDeleteType = async (type: RoomType) => {
    const roomsOfType = rooms.filter((r) => r.room_type_id === type.id)
    const message =
      roomsOfType.length > 0
        ? `This will also delete ${roomsOfType.length} room(s) of this type and any of their reservations.`
        : 'This room type will be permanently removed.'

    const ok = await confirm({
      title: `Delete "${type.name}"?`,
      message,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    setError('')
    const { error: deleteError } = await supabase
      .from('room_types')
      .delete()
      .eq('id', type.id)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    loadData()
  }

  const handleRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const payload = {
        org_id: orgId,
        room_number: roomForm.room_number,
        room_type_id: roomForm.room_type_id,
        status: roomForm.status,
      }

      const { error: submitError } = editingRoomId
        ? await supabase.from('rooms').update(payload).eq('id', editingRoomId)
        : await supabase.from('rooms').insert([payload])

      if (submitError) {
        setError(submitError.message)
        return
      }

      resetRoomForm()
      loadData()
    } catch (err) {
      console.error('Failed to save room:', err)
      setError('Failed to save room. Please try again.')
    }
  }

  const handleEditRoom = (room: Room) => {
    setRoomForm({
      room_number: room.room_number,
      room_type_id: room.room_type_id,
      status: room.status,
    })
    setEditingRoomId(room.id)
    setShowRoomForm(true)
    setError('')
  }

  const handleDeleteRoom = async (room: Room) => {
    const ok = await confirm({
      title: `Delete room ${room.room_number}?`,
      message: 'This will also delete any reservations for this room.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    setError('')
    const { error: deleteError } = await supabase
      .from('rooms')
      .delete()
      .eq('id', room.id)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    loadData()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available':
        return 'bg-green-500/20 text-green-300'
      case 'occupied':
        return 'bg-blue-500/20 text-blue-300'
      case 'cleaning':
        return 'bg-yellow-500/20 text-yellow-300'
      case 'maintenance':
        return 'bg-red-500/20 text-red-300'
      default:
        return 'bg-gray-500/20 text-gray-300'
    }
  }

  return (
      <main className="max-w-7xl mx-auto px-4 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-100 mb-8">Room Management</h1>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30">
            {error}
          </div>
        )}

        {/* Room Types Section */}
        <div className="mb-12">
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:justify-between sm:items-center">
            <h2 className="text-2xl font-bold text-gray-100">Room Types</h2>
            {canManageRooms && (
              <button
                onClick={() => {
                  if (showTypeForm) {
                    resetTypeForm()
                  } else {
                    setShowTypeForm(true)
                  }
                }}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
              >
                {showTypeForm ? 'Cancel' : '+ New Room Type'}
              </button>
            )}
          </div>

          {showTypeForm && canManageRooms && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
              <h3 className="text-xl font-bold mb-4">
                {editingTypeId ? 'Edit Room Type' : 'New Room Type'}
              </h3>
              <form onSubmit={handleTypeSubmit} className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Type Name
                  </label>
                  <input
                    type="text"
                    value={typeForm.name}
                    onChange={(e) =>
                      setTypeForm({ ...typeForm, name: e.target.value })
                    }
                    placeholder="e.g., Deluxe Suite"
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Base Price
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={typeForm.base_price}
                    onChange={(e) =>
                      setTypeForm({ ...typeForm, base_price: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Max Guests
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={typeForm.max_guests}
                    onChange={(e) =>
                      setTypeForm({ ...typeForm, max_guests: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Extra Guest Fee <span className="text-gray-500 font-normal">(per night, over max guests)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={typeForm.extra_guest_fee}
                    onChange={(e) =>
                      setTypeForm({ ...typeForm, extra_guest_fee: e.target.value })
                    }
                    placeholder="0.00"
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-gray-300 font-semibold mb-2">
                    Description
                  </label>
                  <textarea
                    value={typeForm.description}
                    onChange={(e) =>
                      setTypeForm({ ...typeForm, description: e.target.value })
                    }
                    rows={3}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                  >
                    {editingTypeId ? 'Save Changes' : 'Create Room Type'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : roomTypes.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
              No room types yet
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {roomTypes.map((type, i) => (
                <motion.div
                  key={type.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.3 }}
                  className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-xl font-bold text-gray-100">
                      {type.name}
                    </h3>
                    {canManageRooms && (
                      <div className="flex gap-3 text-sm font-semibold">
                        <button
                          onClick={() => handleEditType(type)}
                          className="text-indigo-400 hover:text-indigo-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteType(type)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-gray-400 mb-4">{type.description}</p>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm text-gray-400">Max Guests</p>
                      <p className="text-lg font-bold text-gray-100">
                        {type.max_guests}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-400">Base Price</p>
                      <p className="text-lg font-bold text-indigo-400">
                        {formatMoney(Number(type.base_price))}
                      </p>
                    </div>
                  </div>
                  {Number(type.extra_guest_fee) > 0 && (
                    <p className="text-xs text-gray-500 mt-2">
                      +{formatMoney(Number(type.extra_guest_fee))}/night per guest over capacity
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Rooms Section */}
        <div>
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:justify-between sm:items-center">
            <h2 className="text-2xl font-bold text-gray-100">Rooms</h2>
            {canManageRooms && (
              <button
                onClick={() => {
                  if (showRoomForm) {
                    resetRoomForm()
                  } else {
                    setShowRoomForm(true)
                  }
                }}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
              >
                {showRoomForm ? 'Cancel' : '+ New Room'}
              </button>
            )}
          </div>

          {showRoomForm && canManageRooms && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
              <h3 className="text-xl font-bold mb-4">
                {editingRoomId ? 'Edit Room' : 'New Room'}
              </h3>
              <form onSubmit={handleRoomSubmit} className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Room Number
                  </label>
                  <input
                    type="text"
                    value={roomForm.room_number}
                    onChange={(e) =>
                      setRoomForm({
                        ...roomForm,
                        room_number: e.target.value,
                      })
                    }
                    placeholder="e.g., 101"
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Room Type
                  </label>
                  <select
                    value={roomForm.room_type_id}
                    onChange={(e) =>
                      setRoomForm({
                        ...roomForm,
                        room_type_id: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  >
                    <option value="">Select a room type</option>
                    {roomTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>
                {editingRoomId && (
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">
                      Status
                    </label>
                    <select
                      value={roomForm.status}
                      onChange={(e) =>
                        setRoomForm({ ...roomForm, status: e.target.value })
                      }
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    >
                      <option value="available">Available</option>
                      <option value="occupied">Occupied</option>
                      <option value="cleaning">Cleaning</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </div>
                )}
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                  >
                    {editingRoomId ? 'Save Changes' : 'Create Room'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Status filter tabs */}
          <div className="flex flex-wrap gap-2 mb-6">
            {STATUS_FILTERS.map((status) => {
              const count =
                status === 'all' ? rooms.length : rooms.filter((r) => r.status === status).length
              const active = statusFilter === status
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold capitalize transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {status} ({count})
                </button>
              )
            })}
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : rooms.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
              No rooms yet
            </div>
          ) : (
            (() => {
              const visibleRooms = rooms.filter(
                (r) => statusFilter === 'all' || r.status === statusFilter
              )

              if (visibleRooms.length === 0) {
                return (
                  <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
                    No {statusFilter} rooms
                  </div>
                )
              }

              const groups = roomTypes
                .map((type) => ({
                  type,
                  rooms: visibleRooms.filter((r) => r.room_type_id === type.id).sort(sortByRoomNumber),
                }))
                .filter((group) => group.rooms.length > 0)

              const knownTypeIds = new Set(roomTypes.map((t) => t.id))
              const orphanRooms = visibleRooms
                .filter((r) => !knownTypeIds.has(r.room_type_id))
                .sort(sortByRoomNumber)

              const openIssuesByRoom = maintenanceLogs.reduce<Record<string, MaintenanceLog[]>>(
                (map, log) => {
                  if (!log.room_id) return map
                  if (!map[log.room_id]) map[log.room_id] = []
                  map[log.room_id].push(log)
                  return map
                },
                {}
              )

              const renderRoomCard = (room: Room, i: number) => (
                <motion.div
                  key={room.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -2 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.25 }}
                  className="bg-gray-900 border border-gray-800 rounded-lg shadow p-4 hover:shadow-lg hover:border-gray-700 transition"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="text-2xl font-bold text-gray-100">
                      #{room.room_number}
                    </div>
                    {canManageRooms && (
                      <div className="flex gap-2 text-xs font-semibold">
                        <button
                          onClick={() => handleEditRoom(room)}
                          className="text-indigo-400 hover:text-indigo-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteRoom(room)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getStatusColor(room.status)}`}>
                    {room.status}
                  </span>
                  {room.status === 'maintenance' && (openIssuesByRoom[room.id]?.length || 0) > 0 && (
                    <p className="text-xs text-gray-500 mt-2 truncate">
                      {openIssuesByRoom[room.id].length === 1
                        ? openIssuesByRoom[room.id][0].title
                        : `${openIssuesByRoom[room.id].length} open issues`}
                      {' · '}
                      <Link
                        href="/dashboard/housekeeping"
                        className="text-indigo-400 hover:text-indigo-300 font-semibold"
                      >
                        View
                      </Link>
                    </p>
                  )}
                </motion.div>
              )

              return (
                <div className="space-y-10">
                  {groups.map((group) => (
                    <div key={group.type.id}>
                      <h3 className="text-lg font-semibold text-gray-300 mb-4">
                        {group.type.name}{' '}
                        <span className="text-gray-500 font-normal">({group.rooms.length})</span>
                      </h3>
                      <div className="grid md:grid-cols-4 gap-4">
                        {group.rooms.map((room, i) => renderRoomCard(room, i))}
                      </div>
                    </div>
                  ))}

                  {orphanRooms.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-300 mb-4">
                        Other Rooms{' '}
                        <span className="text-gray-500 font-normal">({orphanRooms.length})</span>
                      </h3>
                      <div className="grid md:grid-cols-4 gap-4">
                        {orphanRooms.map((room, i) => renderRoomCard(room, i))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()
          )}
        </div>
      </main>
  )
}
