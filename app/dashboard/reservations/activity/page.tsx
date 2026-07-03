'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { AuditLog } from '@/lib/types'
import { formatIST, dateIST } from '@/lib/formatDate'
import ActivityCalendar from '@/components/ActivityCalendar'

const SUMMARY_BADGE: Record<string, string> = {
  Created: 'bg-green-500/20 text-green-300',
  Deleted: 'bg-red-500/20 text-red-300',
  'Checked In': 'bg-blue-500/20 text-blue-300',
  'Checked Out': 'bg-amber-500/20 text-amber-300',
  Cancelled: 'bg-red-500/20 text-red-300',
  Reinstated: 'bg-indigo-500/20 text-indigo-300',
  Edited: 'bg-gray-500/20 text-gray-300',
  'Charge Added': 'bg-purple-500/20 text-purple-300',
  'Charge Removed': 'bg-orange-500/20 text-orange-300',
}
const DEFAULT_BADGE = 'bg-gray-500/20 text-gray-300'

const badgeLabel = (log: AuditLog) =>
  log.summary || log.action.charAt(0).toUpperCase() + log.action.slice(1)

// dateStr is a plain YYYY-MM-DD (no time component), which the Date
// constructor parses as UTC midnight — display it back in UTC too so the
// same calendar day is shown regardless of the viewer's own timezone.
const formatDateLabel = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

export default function ReservationActivityPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  useEffect(() => {
    loadLogs()
  }, [])

  const loadLogs = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('org_id', orgId)
        .in('entity_type', ['reservation', 'reservation_charge'])
        .order('created_at', { ascending: false })

      setLogs((data as AuditLog[]) || [])
    } catch (err) {
      console.error('Failed to load activity log:', err)
    } finally {
      setLoading(false)
    }
  }

  // Folio-charge entries don't carry a guest name in their own snapshot
  // (it's a charge row, not a reservation row) — resolve it from whichever
  // 'reservation' entry shares the same entity_id (the reservation's id).
  // Logs are loaded newest-first, so the first match per entity_id is also
  // the most recently known guest name for that reservation.
  const guestNameByEntityId = logs.reduce<Record<string, string>>((map, log) => {
    if (log.entity_type === 'reservation' && !map[log.entity_id]) {
      const name = log.snapshot.guest_name
      if (typeof name === 'string') map[log.entity_id] = name
    }
    return map
  }, {})

  const guestNameFor = (log: AuditLog) => {
    const fallback = typeof log.snapshot.guest_name === 'string' ? log.snapshot.guest_name : null
    return guestNameByEntityId[log.entity_id] || fallback || 'Unknown'
  }

  const activeDates = new Set(logs.map((log) => dateIST(log.created_at)))
  const displayedLogs = selectedDate
    ? logs.filter((log) => dateIST(log.created_at) === selectedDate)
    : logs

  return (
    <main className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex flex-col gap-3 mb-8 sm:flex-row sm:justify-between sm:items-start">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">Reservation Activity Log</h1>
          <p className="text-gray-400 mt-2">
            Every reservation created, modified, or deleted, and every folio charge added or
            removed — including who did it and when. Deleted reservations remain visible here
            even though the reservation itself is gone.
          </p>
        </div>
        <a
          href="/dashboard/reservations"
          className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
        >
          ← Back to Reservations
        </a>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-400">Loading...</div>
      ) : (
        <div className="grid md:grid-cols-[280px_1fr] gap-6 items-start">
          <ActivityCalendar
            activeDates={activeDates}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />

          <div>
            {selectedDate && (
              <div className="flex items-center gap-3 mb-4 text-sm">
                <span className="text-gray-300">
                  Showing activity for{' '}
                  <span className="font-semibold text-gray-100">
                    {formatDateLabel(selectedDate)}
                  </span>
                </span>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="font-semibold text-indigo-400 hover:text-indigo-300"
                >
                  Show all
                </button>
              </div>
            )}

            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow overflow-x-auto">
              {displayedLogs.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  {selectedDate ? 'No activity recorded on this day' : 'No activity recorded yet'}
                </div>
              ) : (
                <table className="w-full min-w-160">
                  <thead className="bg-gray-800">
                    <tr>
                      <th className="px-6 py-3 text-left text-gray-300 font-semibold">Action</th>
                      <th className="px-6 py-3 text-left text-gray-300 font-semibold">Details</th>
                      <th className="px-6 py-3 text-left text-gray-300 font-semibold">Guest</th>
                      <th className="px-6 py-3 text-left text-gray-300 font-semibold">By</th>
                      <th className="px-6 py-3 text-left text-gray-300 font-semibold">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedLogs.map((log, i) => (
                      <motion.tr
                        key={log.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.03, 0.3) }}
                        className="border-t border-gray-800 hover:bg-gray-800"
                      >
                        <td className="px-6 py-3">
                          <span
                            className={`px-3 py-1 rounded-full text-sm font-semibold ${SUMMARY_BADGE[badgeLabel(log)] || DEFAULT_BADGE}`}
                          >
                            {badgeLabel(log)}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-gray-300 text-sm">{log.details || '—'}</td>
                        <td className="px-6 py-3 text-gray-100">{guestNameFor(log)}</td>
                        <td className="px-6 py-3 text-gray-100">{log.actor_name}</td>
                        <td className="px-6 py-3 text-gray-100">{formatIST(log.created_at)}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
