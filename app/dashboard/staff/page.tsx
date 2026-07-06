'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, getFreshAccessToken } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { useAuth } from '@/lib/AuthContext'
import { useConfirm } from '@/lib/ConfirmDialog'
import { User, StaffSchedule, AttendanceLog, LeaveRequest } from '@/lib/types'
import { todayIST } from '@/lib/formatDate'

export default function StaffPage() {
  const { profile } = useAuth()
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
  const [attendance, setAttendance] = useState<AttendanceLog[]>([])
  const [showAttendanceForm, setShowAttendanceForm] = useState(false)
  const [editingAttendanceId, setEditingAttendanceId] = useState<string | null>(null)
  const [attendanceForm, setAttendanceForm] = useState<{
    user_id: string
    log_date: string
    status: AttendanceLog['status']
    clock_in: string
    clock_out: string
    pay_override: '' | 'paid' | 'unpaid'
    notes: string
  }>({
    user_id: '',
    log_date: todayIST(),
    status: 'present',
    clock_in: '',
    clock_out: '',
    pay_override: '',
    notes: '',
  })
  // Draft picks for today's roll-call, keyed by user_id — separate from
  // `attendance` so unsaved picks don't get wiped by a realtime refresh.
  const [rollCallDraft, setRollCallDraft] = useState<Record<string, AttendanceLog['status']>>({})
  const [rollCallSaving, setRollCallSaving] = useState(false)
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [showLeaveForm, setShowLeaveForm] = useState(false)
  const [leaveForm, setLeaveForm] = useState<{
    leave_type: LeaveRequest['leave_type']
    start_date: string
    end_date: string
    reason: string
  }>({
    leave_type: 'annual',
    start_date: '',
    end_date: '',
    reason: '',
  })
  // Optional review note per pending request, keyed by request id — typed
  // before clicking Approve/Reject, not persisted until then.
  const [leaveReviewNotes, setLeaveReviewNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    loadData()
  }, [])

  useRealtimeRefresh(
    ['users', 'staff_schedules', 'attendance_logs', 'leave_requests'],
    () => loadData()
  )

  const loadData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const [staffData, scheduleData, attendanceData, leaveData] = await Promise.all([
        supabase.from('users').select('*').eq('org_id', orgId),
        supabase.from('staff_schedules').select('*').eq('org_id', orgId),
        supabase
          .from('attendance_logs')
          .select('*')
          .eq('org_id', orgId)
          .order('log_date', { ascending: false }),
        supabase
          .from('leave_requests')
          .select('*')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false }),
      ])

      setStaff((staffData.data as User[]) || [])
      setSchedules((scheduleData.data as StaffSchedule[]) || [])
      setAttendance((attendanceData.data as AttendanceLog[]) || [])
      setLeaveRequests((leaveData.data as LeaveRequest[]) || [])
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStaffError('')

    setStaffSubmitting(true)
    try {
      // Fresh token from the auth client (not a stale context snapshot) so the
      // server doesn't reject an expired JWT with 401 "Invalid session".
      const accessToken = await getFreshAccessToken()
      if (!accessToken) {
        setStaffError('Session expired — sign in again.')
        setStaffSubmitting(false)
        return
      }
      const res = await fetch('/api/staff/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
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

  const openAddAttendance = () => {
    setEditingAttendanceId(null)
    setAttendanceForm({
      user_id: '',
      log_date: todayIST(),
      status: 'present',
      clock_in: '',
      clock_out: '',
      pay_override: '',
      notes: '',
    })
    setShowAttendanceForm(true)
  }

  const openEditAttendance = (log: AttendanceLog) => {
    setEditingAttendanceId(log.id)
    setAttendanceForm({
      user_id: log.user_id,
      log_date: log.log_date,
      status: log.status,
      clock_in: log.clock_in || '',
      clock_out: log.clock_out || '',
      pay_override: log.pay_override || '',
      notes: log.notes || '',
    })
    setShowAttendanceForm(true)
  }

  const closeAttendanceForm = () => {
    setShowAttendanceForm(false)
    setEditingAttendanceId(null)
  }

  const handleAttendanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const payload = {
        org_id: orgId,
        user_id: attendanceForm.user_id,
        log_date: attendanceForm.log_date,
        status: attendanceForm.status,
        clock_in: attendanceForm.clock_in || null,
        clock_out: attendanceForm.clock_out || null,
        pay_override: attendanceForm.pay_override || null,
        notes: attendanceForm.notes || null,
        recorded_by: profile?.id || null,
      }

      if (editingAttendanceId) {
        await supabase.from('attendance_logs').update(payload).eq('id', editingAttendanceId)
      } else {
        await supabase.from('attendance_logs').insert([payload])
      }

      closeAttendanceForm()
      loadData()
    } catch (err) {
      console.error('Failed to save attendance:', err)
    }
  }

  const handleDeleteAttendance = async (log: AttendanceLog) => {
    const staffName = staff.find((s) => s.id === log.user_id)?.name || 'this staff member'
    const ok = await confirm({
      title: 'Delete attendance record?',
      message: `Removes the ${log.log_date} attendance entry for ${staffName}.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    const { error: deleteError } = await supabase.from('attendance_logs').delete().eq('id', log.id)
    if (deleteError) {
      await alert({ title: 'Failed to delete', message: deleteError.message })
      return
    }
    loadData()
  }

  const todaysAttendance = attendance.filter((a) => a.log_date === todayIST())

  const rollCallStatusFor = (userId: string): AttendanceLog['status'] | undefined =>
    rollCallDraft[userId] ?? todaysAttendance.find((a) => a.user_id === userId)?.status

  const handleRollCallPick = (userId: string, status: AttendanceLog['status']) => {
    setRollCallDraft((prev) => ({ ...prev, [userId]: status }))
  }

  const handleRollCallSave = async () => {
    const orgId = localStorage.getItem('orgId')
    if (!orgId || Object.keys(rollCallDraft).length === 0) return

    setRollCallSaving(true)
    try {
      const rows = Object.entries(rollCallDraft).map(([userId, status]) => ({
        org_id: orgId,
        user_id: userId,
        log_date: todayIST(),
        status,
        recorded_by: profile?.id || null,
      }))
      await supabase.from('attendance_logs').upsert(rows, { onConflict: 'org_id,user_id,log_date' })
      setRollCallDraft({})
      loadData()
    } catch (err) {
      console.error('Failed to save roll call:', err)
    } finally {
      setRollCallSaving(false)
    }
  }

  const getAttendanceStatusColor = (status: string) => {
    switch (status) {
      case 'present':
        return 'bg-green-500/20 text-green-300'
      case 'late':
        return 'bg-amber-500/20 text-amber-300'
      case 'half_day':
        return 'bg-blue-500/20 text-blue-300'
      case 'on_leave':
        return 'bg-purple-500/20 text-purple-300'
      default:
        return 'bg-red-500/20 text-red-300'
    }
  }

  const closeLeaveForm = () => {
    setShowLeaveForm(false)
    setLeaveForm({ leave_type: 'annual', start_date: '', end_date: '', reason: '' })
  }

  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      await supabase.from('leave_requests').insert([
        {
          org_id: orgId,
          user_id: profile.id,
          leave_type: leaveForm.leave_type,
          start_date: leaveForm.start_date,
          end_date: leaveForm.end_date,
          reason: leaveForm.reason || null,
        },
      ])

      closeLeaveForm()
      loadData()
    } catch (err) {
      console.error('Failed to submit leave request:', err)
    }
  }

  const handleReviewLeave = async (request: LeaveRequest, status: 'approved' | 'rejected') => {
    if (!profile) return
    const { error: reviewError } = await supabase
      .from('leave_requests')
      .update({
        status,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        review_note: leaveReviewNotes[request.id] || null,
      })
      .eq('id', request.id)

    if (reviewError) {
      await alert({ title: 'Failed to update request', message: reviewError.message })
      return
    }
    setLeaveReviewNotes((prev) => {
      const next = { ...prev }
      delete next[request.id]
      return next
    })
    loadData()
  }

  const handleDeleteLeaveRequest = async (request: LeaveRequest) => {
    const isOwn = request.user_id === profile?.id
    const staffName = staff.find((s) => s.id === request.user_id)?.name || 'this staff member'
    const ok = await confirm({
      title: isOwn ? 'Withdraw your leave request?' : `Delete ${staffName}'s leave request?`,
      message: `${leaveTypeLabel(request.leave_type)}, ${request.start_date} to ${request.end_date}.`,
      confirmLabel: isOwn ? 'Withdraw' : 'Delete',
      danger: true,
    })
    if (!ok) return

    const { error: deleteError } = await supabase.from('leave_requests').delete().eq('id', request.id)
    if (deleteError) {
      await alert({ title: 'Failed to remove request', message: deleteError.message })
      return
    }
    loadData()
  }

  const leaveTypeLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1)

  const getLeaveStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-500/20 text-green-300'
      case 'rejected':
        return 'bg-red-500/20 text-red-300'
      default:
        return 'bg-amber-500/20 text-amber-300'
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

        {/* Attendance Section */}
        <div>
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:justify-between sm:items-center">
            <h2 className="text-2xl font-bold text-gray-100">Attendance</h2>
            {canManageStaff && (
              <button
                onClick={() => (showAttendanceForm ? closeAttendanceForm() : openAddAttendance())}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
              >
                {showAttendanceForm ? 'Cancel' : '+ Log Attendance'}
              </button>
            )}
          </div>

          {canManageStaff && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6 mb-8">
              <div className="flex flex-wrap gap-3 justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-200">
                  Today&apos;s Roll Call — {todayIST()}
                </h3>
                <button
                  onClick={handleRollCallSave}
                  disabled={rollCallSaving || Object.keys(rollCallDraft).length === 0}
                  className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-500 transition disabled:bg-gray-700 disabled:text-gray-500"
                >
                  {rollCallSaving ? 'Saving...' : 'Save All'}
                </button>
              </div>
              {staff.length === 0 ? (
                <p className="text-gray-500 text-sm">No staff members yet.</p>
              ) : (
                <div className="space-y-1">
                  {staff.map((member) => {
                    const current = rollCallStatusFor(member.id)
                    return (
                      <div
                        key={member.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 border-t border-gray-800 first:border-t-0"
                      >
                        <span className="text-gray-200 font-medium">{member.name}</span>
                        <div className="flex flex-wrap gap-2">
                          {(['present', 'late', 'half_day', 'absent'] as const).map((status) => (
                            <button
                              key={status}
                              onClick={() => handleRollCallPick(member.id, status)}
                              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                                current === status
                                  ? getAttendanceStatusColor(status)
                                  : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                              }`}
                            >
                              {status === 'half_day' ? 'Half-day' : status.charAt(0).toUpperCase() + status.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {showAttendanceForm && canManageStaff && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
              <form
                onSubmit={handleAttendanceSubmit}
                className="grid md:grid-cols-2 gap-6"
              >
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Staff Member
                  </label>
                  <select
                    value={attendanceForm.user_id}
                    onChange={(e) =>
                      setAttendanceForm({ ...attendanceForm, user_id: e.target.value })
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
                  <label className="block text-gray-300 font-semibold mb-2">Date</label>
                  <input
                    type="date"
                    value={attendanceForm.log_date}
                    onChange={(e) =>
                      setAttendanceForm({ ...attendanceForm, log_date: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">Status</label>
                  <select
                    value={attendanceForm.status}
                    onChange={(e) =>
                      setAttendanceForm({
                        ...attendanceForm,
                        status: e.target.value as AttendanceLog['status'],
                      })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  >
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="half_day">Half-day</option>
                    <option value="absent">Absent</option>
                    <option value="on_leave">On Leave</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Pay Override
                  </label>
                  <select
                    value={attendanceForm.pay_override}
                    onChange={(e) =>
                      setAttendanceForm({
                        ...attendanceForm,
                        pay_override: e.target.value as '' | 'paid' | 'unpaid',
                      })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  >
                    <option value="">Default (follow status)</option>
                    <option value="paid">Force paid</option>
                    <option value="unpaid">Force unpaid</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Clock In
                  </label>
                  <input
                    type="time"
                    value={attendanceForm.clock_in}
                    onChange={(e) =>
                      setAttendanceForm({ ...attendanceForm, clock_in: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">
                    Clock Out
                  </label>
                  <input
                    type="time"
                    value={attendanceForm.clock_out}
                    onChange={(e) =>
                      setAttendanceForm({ ...attendanceForm, clock_out: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-gray-300 font-semibold mb-2">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={attendanceForm.notes}
                    onChange={(e) =>
                      setAttendanceForm({ ...attendanceForm, notes: e.target.value })
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
                    {editingAttendanceId ? 'Save Changes' : 'Log Attendance'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : attendance.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
              No attendance records yet
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow overflow-x-auto">
              <table className="w-full min-w-160">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Staff
                    </th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Times
                    </th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                      Notes
                    </th>
                    {canManageStaff && (
                      <th className="px-6 py-3 text-left text-gray-300 font-semibold">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((log, i) => (
                    <motion.tr
                      key={log.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      className="border-t border-gray-800 hover:bg-gray-800"
                    >
                      <td className="px-6 py-3 text-gray-100">{log.log_date}</td>
                      <td className="px-6 py-3 font-semibold text-gray-100">
                        {staff.find((s) => s.id === log.user_id)?.name || 'Unknown'}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getAttendanceStatusColor(log.status)}`}
                        >
                          {log.status === 'half_day' ? 'Half-day' : log.status.replace('_', ' ')}
                        </span>
                        {log.pay_override && (
                          <span className="ml-2 text-xs text-gray-500">
                            ({log.pay_override === 'paid' ? 'forced paid' : 'forced unpaid'})
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-sm">
                        {log.clock_in || log.clock_out
                          ? `${log.clock_in || '—'} - ${log.clock_out || '—'}`
                          : '—'}
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-sm">{log.notes || '—'}</td>
                      {canManageStaff && (
                        <td className="px-6 py-3">
                          <div className="flex gap-3">
                            <button
                              onClick={() => openEditAttendance(log)}
                              className="text-indigo-400 hover:text-indigo-300 text-sm font-semibold"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteAttendance(log)}
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

        {/* Leave Requests Section */}
        <div className="mt-12">
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:justify-between sm:items-center">
            <h2 className="text-2xl font-bold text-gray-100">Leave Requests</h2>
            <button
              onClick={() => (showLeaveForm ? closeLeaveForm() : setShowLeaveForm(true))}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
            >
              {showLeaveForm ? 'Cancel' : '+ Request Leave'}
            </button>
          </div>

          {showLeaveForm && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
              <form onSubmit={handleLeaveSubmit} className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">Type</label>
                  <select
                    value={leaveForm.leave_type}
                    onChange={(e) =>
                      setLeaveForm({
                        ...leaveForm,
                        leave_type: e.target.value as LeaveRequest['leave_type'],
                      })
                    }
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  >
                    <option value="annual">Annual</option>
                    <option value="sick">Sick</option>
                    <option value="casual">Casual</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">Start Date</label>
                  <input
                    type="date"
                    value={leaveForm.start_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">End Date</label>
                  <input
                    type="date"
                    value={leaveForm.end_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-gray-300 font-semibold mb-2">Reason</label>
                  <input
                    type="text"
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                    placeholder="Optional"
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                  >
                    Submit Request
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : leaveRequests.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
              No leave requests yet
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg shadow overflow-x-auto">
              <table className="w-full min-w-160">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">Staff</th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">Type</th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">Dates</th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">Reason</th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">Status</th>
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveRequests.map((request, i) => {
                    const isOwn = request.user_id === profile?.id
                    const canDecide = canManageStaff && request.status === 'pending'
                    const canRemove = (isOwn && request.status === 'pending') || canManageStaff
                    return (
                      <motion.tr
                        key={request.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.03, 0.3) }}
                        className="border-t border-gray-800 hover:bg-gray-800"
                      >
                        <td className="px-6 py-3 font-semibold text-gray-100">
                          {staff.find((s) => s.id === request.user_id)?.name || 'Unknown'}
                        </td>
                        <td className="px-6 py-3 text-gray-100">
                          {leaveTypeLabel(request.leave_type)}
                        </td>
                        <td className="px-6 py-3 text-gray-100">
                          {request.start_date} - {request.end_date}
                        </td>
                        <td className="px-6 py-3 text-gray-400 text-sm">
                          {request.reason || '—'}
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getLeaveStatusColor(request.status)}`}
                          >
                            {request.status}
                          </span>
                          {request.review_note && (
                            <p className="text-xs text-gray-500 mt-1">{request.review_note}</p>
                          )}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex flex-col gap-2">
                            {canDecide && (
                              <>
                                <input
                                  type="text"
                                  value={leaveReviewNotes[request.id] || ''}
                                  onChange={(e) =>
                                    setLeaveReviewNotes({
                                      ...leaveReviewNotes,
                                      [request.id]: e.target.value,
                                    })
                                  }
                                  placeholder="Note (optional)"
                                  className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-100"
                                />
                                <div className="flex gap-3">
                                  <button
                                    onClick={() => handleReviewLeave(request, 'approved')}
                                    className="text-green-400 hover:text-green-300 text-sm font-semibold"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleReviewLeave(request, 'rejected')}
                                    className="text-red-400 hover:text-red-300 text-sm font-semibold"
                                  >
                                    Reject
                                  </button>
                                </div>
                              </>
                            )}
                            {canRemove && (
                              <button
                                onClick={() => handleDeleteLeaveRequest(request)}
                                className="text-gray-400 hover:text-red-300 text-sm font-semibold text-left"
                              >
                                {isOwn ? 'Withdraw' : 'Delete'}
                              </button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
  )
}
