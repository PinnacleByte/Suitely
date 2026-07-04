'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { useAuth } from '@/lib/AuthContext'
import { useConfirm } from '@/lib/ConfirmDialog'
import { User, StaffSchedule } from '@/lib/types'

export default function StaffPage() {
  const { session, profile } = useAuth()
  const { confirm, alert } = useConfirm()
  // UI-level gate only for now — real DB-level (RLS) enforcement of role
  // permissions is a separate, larger change; this matches the app's
  // existing pattern (e.g. the dashboard's Financials widget).
  const canManageStaff = profile?.role === 'admin' || profile?.role === 'manager'
  const [staff, setStaff] = useState<User[]>([])
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [showStaffForm, setShowStaffForm] = useState(false)
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null)
  const [staffError, setStaffError] = useState('')
  const [staffSubmitting, setStaffSubmitting] = useState(false)
  const [staffForm, setStaffForm] = useState<{
    name: string
    email: string
    password: string
    role: 'admin' | 'manager' | 'staff'
  }>({
    name: '',
    email: '',
    password: '',
    role: 'staff',
  })
  const [scheduleForm, setScheduleForm] = useState({
    user_id: '',
    shift_date: '',
    start_time: '',
    end_time: '',
    position: '',
    notes: '',
  })

  useEffect(() => {
    loadData()
  }, [])

  useRealtimeRefresh(['users', 'staff_schedules'], () => loadData())

  const loadData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const [staffData, scheduleData] = await Promise.all([
        supabase.from('users').select('*').eq('org_id', orgId),
        supabase.from('staff_schedules').select('*').eq('org_id', orgId),
      ])

      setStaff((staffData.data as User[]) || [])
      setSchedules((scheduleData.data as StaffSchedule[]) || [])
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStaffError('')
    if (!session) return

    setStaffSubmitting(true)
    try {
      const res = await fetch('/api/staff/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(staffForm),
      })

      const result = await res.json()

      if (!res.ok) {
        setStaffError(result.error || 'Failed to create staff member.')
        return
      }

      setStaffForm({
        name: '',
        email: '',
        password: '',
        role: 'staff',
      })
      setShowStaffForm(false)
      loadData()
    } catch (err) {
      console.error('Failed to create staff:', err)
      setStaffError('Failed to create staff member. Please try again.')
    } finally {
      setStaffSubmitting(false)
    }
  }

  const openAddStaff = () => {
    setEditingStaffId(null)
    setStaffForm({ name: '', email: '', password: '', role: 'staff' })
    setStaffError('')
    setShowStaffForm(true)
  }

  const openEditStaff = (member: User) => {
    setEditingStaffId(member.id)
    setStaffForm({ name: member.name, email: member.email, password: '', role: member.role })
    setStaffError('')
    setShowStaffForm(true)
  }

  const closeStaffForm = () => {
    setShowStaffForm(false)
    setEditingStaffId(null)
    setStaffError('')
  }

  // Name + role only — email is tied to the Supabase Auth account and
  // changing it needs the admin API, out of scope for now.
  const handleEditStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingStaffId) return
    setStaffError('')
    setStaffSubmitting(true)

    const { error: updateError } = await supabase
      .from('users')
      .update({ name: staffForm.name, role: staffForm.role })
      .eq('id', editingStaffId)

    setStaffSubmitting(false)
    if (updateError) {
      setStaffError(updateError.message)
      return
    }
    closeStaffForm()
    loadData()
  }

  const handleDeleteStaff = async (member: User) => {
    if (member.id === profile?.id) {
      await alert({
        title: "Can't delete your own account",
        message: 'Have another admin remove your account if needed.',
      })
      return
    }
    if (member.role === 'admin' && staff.filter((s) => s.role === 'admin').length <= 1) {
      await alert({
        title: "Can't delete the last admin",
        message: 'Promote another staff member to admin first.',
      })
      return
    }

    const ok = await confirm({
      title: `Delete ${member.name}?`,
      message:
        'This removes their access to the app immediately. This cannot be undone from here.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    const { error: deleteError } = await supabase.from('users').delete().eq('id', member.id)
    if (deleteError) {
      await alert({ title: 'Failed to delete', message: deleteError.message })
      return
    }
    loadData()
  }

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      await supabase.from('staff_schedules').insert([
        {
          org_id: orgId,
          ...scheduleForm,
        },
      ])

      setScheduleForm({
        user_id: '',
        shift_date: '',
        start_time: '',
        end_time: '',
        position: '',
        notes: '',
      })
      setShowScheduleForm(false)
      loadData()
    } catch (err) {
      console.error('Failed to create schedule:', err)
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-red-500/20 text-red-300'
      case 'manager':
        return 'bg-blue-500/20 text-blue-300'
      case 'staff':
        return 'bg-green-500/20 text-green-300'
      default:
        return 'bg-gray-500/20 text-gray-300'
    }
  }

  return (
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="flex flex-wrap gap-3 justify-between items-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-100">Staff Management</h1>
          <a
            href="/dashboard/settings"
            className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
          >
            ← Back to Settings
          </a>
        </div>

        {/* Staff Section */}
        <div className="mb-12">
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:justify-between sm:items-center">
            <h2 className="text-2xl font-bold text-gray-100">Staff Members</h2>
            {canManageStaff && (
              <button
                onClick={() => (showStaffForm ? closeStaffForm() : openAddStaff())}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
              >
                {showStaffForm ? 'Cancel' : '+ Add Staff'}
              </button>
            )}
          </div>

          {showStaffForm && canManageStaff && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
              {staffError && (
                <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30">
                  {staffError}
                </div>
              )}
              <form
                onSubmit={editingStaffId ? handleEditStaffSubmit : handleStaffSubmit}
                className="grid md:grid-cols-2 gap-6"
              >
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    value={staffForm.name}
                    onChange={(e) =>
                      setStaffForm({ ...staffForm, name: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                {editingStaffId ? (
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Email</label>
                    <input
                      type="email"
                      value={staffForm.email}
                      disabled
                      className="w-full px-4 py-2 bg-gray-800/50 border border-gray-800 rounded-lg text-gray-500"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-gray-300 font-semibold mb-2">
                        Email
                      </label>
                      <input
                        type="email"
                        value={staffForm.email}
                        onChange={(e) =>
                          setStaffForm({ ...staffForm, email: e.target.value })
                        }
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-gray-300 font-semibold mb-2">
                        Temporary Password
                      </label>
                      <input
                        type="text"
                        value={staffForm.password}
                        onChange={(e) =>
                          setStaffForm({ ...staffForm, password: e.target.value })
                        }
                        placeholder="Share this with the staff member directly"
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                        minLength={6}
                        required
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Role
                  </label>
                  <select
                    value={staffForm.role}
                    onChange={(e) =>
                      setStaffForm({
                        ...staffForm,
                        role: e.target.value as 'admin' | 'manager' | 'staff',
                      })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  >
                    <option value="staff">Staff</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={staffSubmitting}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition disabled:bg-gray-700"
                  >
                    {staffSubmitting
                      ? editingStaffId
                        ? 'Saving...'
                        : 'Adding...'
                      : editingStaffId
                        ? 'Save Changes'
                        : 'Add Staff Member'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : staff.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
              No staff members yet
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow overflow-x-auto">
              <table className="w-full min-w-140">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Role
                    </th>
                    {canManageStaff && (
                      <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {staff.map((member, i) => (
                    <motion.tr
                      key={member.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      className="border-t border-gray-800 hover:bg-gray-800"
                    >
                      <td className="px-6 py-3 font-semibold text-gray-100">
                        {member.name}
                      </td>
                      <td className="px-6 py-3 text-gray-400">
                        {member.email}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getRoleColor(member.role)}`}
                        >
                          {member.role}
                        </span>
                      </td>
                      {canManageStaff && (
                        <td className="px-6 py-3">
                          <div className="flex gap-3">
                            <button
                              onClick={() => openEditStaff(member)}
                              className="text-indigo-400 hover:text-indigo-300 text-sm font-semibold"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteStaff(member)}
                              className="text-red-400 hover:text-red-300 text-sm font-semibold"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Schedules Section */}
        <div>
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:justify-between sm:items-center">
            <h2 className="text-2xl font-bold text-gray-100">Schedules</h2>
            <button
              onClick={() => setShowScheduleForm(!showScheduleForm)}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
            >
              {showScheduleForm ? 'Cancel' : '+ New Schedule'}
            </button>
          </div>

          {showScheduleForm && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
              <form
                onSubmit={handleScheduleSubmit}
                className="grid md:grid-cols-2 gap-6"
              >
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Staff Member
                  </label>
                  <select
                    value={scheduleForm.user_id}
                    onChange={(e) =>
                      setScheduleForm({
                        ...scheduleForm,
                        user_id: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  >
                    <option value="">Select a staff member</option>
                    {staff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Shift Date
                  </label>
                  <input
                    type="date"
                    value={scheduleForm.shift_date}
                    onChange={(e) =>
                      setScheduleForm({
                        ...scheduleForm,
                        shift_date: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={scheduleForm.start_time}
                    onChange={(e) =>
                      setScheduleForm({
                        ...scheduleForm,
                        start_time: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={scheduleForm.end_time}
                    onChange={(e) =>
                      setScheduleForm({
                        ...scheduleForm,
                        end_time: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Position
                  </label>
                  <input
                    type="text"
                    value={scheduleForm.position}
                    onChange={(e) =>
                      setScheduleForm({
                        ...scheduleForm,
                        position: e.target.value,
                      })
                    }
                    placeholder="e.g., Front Desk, Housekeeping"
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={scheduleForm.notes}
                    onChange={(e) =>
                      setScheduleForm({
                        ...scheduleForm,
                        notes: e.target.value,
                      })
                    }
                    placeholder="Optional notes"
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                  >
                    Create Schedule
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : schedules.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
              No schedules yet
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow overflow-x-auto">
              <table className="w-full min-w-140">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Staff
                    </th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Position
                    </th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((schedule, i) => (
                    <motion.tr
                      key={schedule.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      className="border-t border-gray-800 hover:bg-gray-800"
                    >
                      <td className="px-6 py-3 font-semibold text-gray-100">
                        {staff.find((s) => s.id === schedule.user_id)?.name ||
                          'Unknown'}
                      </td>
                      <td className="px-6 py-3 text-gray-100">
                        {schedule.position}
                      </td>
                      <td className="px-6 py-3 text-gray-100">
                        {schedule.shift_date}
                      </td>
                      <td className="px-6 py-3 text-gray-100">
                        {schedule.start_time} - {schedule.end_time}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
  )
}
