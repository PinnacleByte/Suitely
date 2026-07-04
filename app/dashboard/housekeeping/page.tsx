'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { Room, RoomType, MaintenanceLog } from '@/lib/types'
import { formatIST } from '@/lib/formatDate'
import { useConfirm } from '@/lib/ConfirmDialog'

const PRIORITY_BADGE: Record<MaintenanceLog['priority'], string> = {
  high: 'bg-red-500/20 text-red-300',
  medium: 'bg-amber-500/20 text-amber-300',
  low: 'bg-gray-500/20 text-gray-300',
}

const MAINTENANCE_STATUS_BADGE: Record<MaintenanceLog['status'], string> = {
  open: 'bg-red-500/20 text-red-300',
  in_progress: 'bg-blue-500/20 text-blue-300',
  completed: 'bg-green-500/20 text-green-300',
}

const statusLabel = (status: string) => status.replace('_', ' ')

const sortByRoomNumber = (a: Room, b: Room) =>
  a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: 'base' })

type MaintenanceForm = {
  title: string
  description: string
  room_id: string
  priority: MaintenanceLog['priority']
}

const emptyMaintenanceForm: MaintenanceForm = {
  title: '',
  description: '',
  room_id: '',
  priority: 'medium',
}

export default function HousekeepingPage() {
  const { confirm } = useConfirm()
  const [rooms, setRooms] = useState<Room[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [logs, setLogs] = useState<MaintenanceLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Id of the room/log currently mid-update, to disable just its buttons.
  const [busyId, setBusyId] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<MaintenanceForm>(emptyMaintenanceForm)

  useEffect(() => {
    loadData()
  }, [])

  useRealtimeRefresh(['rooms', 'room_types', 'maintenance_logs'], () => loadData())

  const loadData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const [roomsData, typesData, logsData] = await Promise.all([
        supabase.from('rooms').select('*').eq('org_id', orgId),
        supabase.from('room_types').select('*').eq('org_id', orgId),
        supabase.from('maintenance_logs').select('*').eq('org_id', orgId),
      ])

      setRooms((roomsData.data as Room[]) || [])
      setRoomTypes((typesData.data as RoomType[]) || [])
      setLogs((logsData.data as MaintenanceLog[]) || [])
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const roomLabel = (roomId: string | null) => {
    if (!roomId) return null
    return rooms.find((r) => r.id === roomId)?.room_number ?? 'Unknown'
  }
  const typeName = (room: Room) =>
    roomTypes.find((t) => t.id === room.room_type_id)?.name ?? 'Unassigned type'

  // Housekeeping finished a room — return it to service. Goes through the
  // mark_room_clean() RPC (SECURITY DEFINER) rather than a direct rooms
  // UPDATE, since staff have no direct rooms write grant (that's reserved
  // for manager/admin inventory config) but CAN complete a housekeeping
  // turnaround. The RPC re-checks org + that the room is actually 'cleaning'.
  const markRoomClean = async (room: Room) => {
    setBusyId(room.id)
    const { error: rpcError } = await supabase.rpc('mark_room_clean', { p_room: room.id })
    setBusyId(null)

    if (rpcError) {
      setError(rpcError.message)
      return
    }
    loadData()
  }

  const openIssueForRoom = (roomId: string) => {
    setForm({ ...emptyMaintenanceForm, room_id: roomId })
    setShowForm(true)
    setError('')
  }

  const toggleForm = () => {
    if (showForm) {
      setShowForm(false)
      return
    }
    setForm(emptyMaintenanceForm)
    setShowForm(true)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      // A room tied to the issue is taken out of service by the
      // sync_room_status_on_maintenance() DB trigger, not here.
      const { error: insertError } = await supabase.from('maintenance_logs').insert([
        {
          org_id: orgId,
          title: form.title,
          description: form.description,
          room_id: form.room_id || null,
          priority: form.priority,
          status: 'open',
        },
      ])

      if (insertError) {
        setError(insertError.message)
        return
      }

      setForm(emptyMaintenanceForm)
      setShowForm(false)
      loadData()
    } catch (err) {
      console.error('Failed to create maintenance issue:', err)
      setError('Failed to create maintenance issue. Please try again.')
    }
  }

  // Advance a maintenance issue. Completing it stamps completed_at and lets
  // the DB trigger return the room to housekeeping (if no other issues remain);
  // reopening clears the stamp.
  const setLogStatus = async (log: MaintenanceLog, status: MaintenanceLog['status']) => {
    setBusyId(log.id)
    const { error: updateError } = await supabase
      .from('maintenance_logs')
      .update({
        status,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
      })
      .eq('id', log.id)
    setBusyId(null)

    if (updateError) {
      setError(updateError.message)
      return
    }
    loadData()
  }

  const deleteLog = async (log: MaintenanceLog) => {
    const ok = await confirm({
      title: 'Delete maintenance issue?',
      message: `"${log.title}" will be permanently removed.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    setBusyId(log.id)
    const { error: deleteError } = await supabase
      .from('maintenance_logs')
      .delete()
      .eq('id', log.id)
    setBusyId(null)

    if (deleteError) {
      setError(deleteError.message)
      return
    }
    loadData()
  }

  const cleaningRooms = rooms.filter((r) => r.status === 'cleaning').sort(sortByRoomNumber)
  const activeLogs = logs
    .filter((l) => l.status !== 'completed')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const completedLogs = logs
    .filter((l) => l.status === 'completed')
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))

  return (
    <main className="max-w-7xl mx-auto px-4 py-12">
      <h1 className="text-3xl sm:text-4xl font-bold text-gray-100 mb-2">Housekeeping &amp; Maintenance</h1>
      <p className="text-gray-400 mb-8">
        Turn rooms around after checkout and track maintenance issues.
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30">
          {error}
        </div>
      )}

      {/* Cleaning queue */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-gray-100 mb-6">
          Cleaning Queue{' '}
          <span className="text-gray-500 font-normal text-lg">({cleaningRooms.length})</span>
        </h2>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : cleaningRooms.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
            All clear — no rooms waiting to be cleaned.
          </div>
        ) : (
          <div className="grid md:grid-cols-4 gap-4">
            <AnimatePresence>
              {cleaningRooms.map((room, i) => (
                <motion.div
                  key={room.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.25 }}
                  className="bg-gray-900 border border-gray-800 rounded-lg shadow p-4"
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="text-2xl font-bold text-gray-100">#{room.room_number}</div>
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/20 text-yellow-300">
                      cleaning
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">{typeName(room)}</p>
                  <div className="flex flex-col gap-2">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => markRoomClean(room)}
                      disabled={busyId === room.id}
                      className="w-full px-3 py-2 rounded-lg bg-green-500/10 text-green-300 text-sm font-semibold hover:bg-green-500/20 transition disabled:opacity-50"
                    >
                      Mark clean
                    </motion.button>
                    <button
                      onClick={() => openIssueForRoom(room.id)}
                      className="w-full px-3 py-1.5 rounded-lg text-gray-400 text-sm font-semibold hover:text-gray-200 transition"
                    >
                      Report issue
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* Maintenance tracker */}
      <section>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-100">
            Maintenance{' '}
            <span className="text-gray-500 font-normal text-lg">({activeLogs.length} open)</span>
          </h2>
          <button
            onClick={toggleForm}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
          >
            {showForm ? 'Cancel' : '+ Report Issue'}
          </button>
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
                <form onSubmit={handleSubmit} className="grid md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-gray-300 font-semibold mb-2">Title</label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="e.g., Leaking faucet in bathroom"
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">
                      Room <span className="text-gray-500 font-normal">(optional)</span>
                    </label>
                    <select
                      value={form.room_id}
                      onChange={(e) => setForm({ ...form, room_id: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    >
                      <option value="">General / not room-specific</option>
                      {[...rooms].sort(sortByRoomNumber).map((room) => (
                        <option key={room.id} value={room.id}>
                          Room {room.room_number}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Linking a room takes it out of service until the issue is resolved.
                    </p>
                  </div>
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Priority</label>
                    <select
                      value={form.priority}
                      onChange={(e) =>
                        setForm({ ...form, priority: e.target.value as MaintenanceLog['priority'] })
                      }
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-gray-300 font-semibold mb-2">Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      type="submit"
                      className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                    >
                      Create Issue
                    </motion.button>
                  </div>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : activeLogs.length === 0 && completedLogs.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
            No maintenance issues logged.
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {activeLogs.map((log) => (
                <MaintenanceRow
                  key={log.id}
                  log={log}
                  roomLabel={roomLabel(log.room_id)}
                  busy={busyId === log.id}
                  onStart={() => setLogStatus(log, 'in_progress')}
                  onComplete={() => setLogStatus(log, 'completed')}
                  onDelete={() => deleteLog(log)}
                />
              ))}
            </AnimatePresence>

            {completedLogs.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-sm font-semibold text-gray-400 hover:text-gray-200 py-2 select-none">
                  Completed ({completedLogs.length})
                </summary>
                <div className="space-y-3 mt-3">
                  {completedLogs.map((log) => (
                    <MaintenanceRow
                      key={log.id}
                      log={log}
                      roomLabel={roomLabel(log.room_id)}
                      busy={busyId === log.id}
                      onReopen={() => setLogStatus(log, 'open')}
                      onDelete={() => deleteLog(log)}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

function MaintenanceRow({
  log,
  roomLabel,
  busy,
  onStart,
  onComplete,
  onReopen,
  onDelete,
}: {
  log: MaintenanceLog
  roomLabel: string | null
  busy: boolean
  onStart?: () => void
  onComplete?: () => void
  onReopen?: () => void
  onDelete: () => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className="bg-gray-900 border border-gray-800 rounded-lg shadow p-5"
    >
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-gray-100">{log.title}</h3>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${PRIORITY_BADGE[log.priority]}`}
            >
              {log.priority}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${MAINTENANCE_STATUS_BADGE[log.status]}`}
            >
              {statusLabel(log.status)}
            </span>
          </div>
          {log.description && (
            <p className="text-sm text-gray-400 mt-1">{log.description}</p>
          )}
          <p className="text-xs text-gray-500 mt-2">
            {roomLabel ? `Room ${roomLabel}` : 'General'} · Reported {formatIST(log.created_at)}
            {log.completed_at && ` · Completed ${formatIST(log.completed_at)}`}
          </p>
        </div>
        <div className="flex gap-3 text-sm font-semibold shrink-0">
          {onStart && (
            <button
              onClick={onStart}
              disabled={busy}
              className="text-blue-400 hover:text-blue-300 disabled:opacity-50"
            >
              Start
            </button>
          )}
          {onComplete && (
            <button
              onClick={onComplete}
              disabled={busy}
              className="text-green-400 hover:text-green-300 disabled:opacity-50"
            >
              Complete
            </button>
          )}
          {onReopen && (
            <button
              onClick={onReopen}
              disabled={busy}
              className="text-amber-400 hover:text-amber-300 disabled:opacity-50"
            >
              Reopen
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={busy}
            className="text-red-400 hover:text-red-300 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </motion.div>
  )
}
