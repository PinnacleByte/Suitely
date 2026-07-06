'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { useAuth } from '@/lib/AuthContext'
import { useConfirm } from '@/lib/ConfirmDialog'
import {
  User,
  StaffCompensation,
  PayrollRun,
  PayrollRunAdjustment,
  AttendanceLog,
  PayrollSnapshot,
} from '@/lib/types'
import { todayIST } from '@/lib/formatDate'
import { formatMoney, getCurrencyCode } from '@/lib/currency'
import { printPayslip } from '@/lib/printPayslip'
import { daysInMonthOf, computeBreakdown, currentRateFor } from '@/lib/payroll'

const STATUS_BADGE: Record<PayrollRun['status'], string> = {
  draft: 'bg-gray-600/30 text-gray-300',
  finalized: 'bg-blue-500/20 text-blue-300',
  paid: 'bg-emerald-500/20 text-emerald-300',
}

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'upi', 'other'] as const

export default function PayrollPage() {
  const { profile } = useAuth()
  const { confirm, alert } = useConfirm()
  const canManagePayroll = profile?.role === 'admin' || profile?.role === 'manager'

  const [staff, setStaff] = useState<User[]>([])
  const [compensation, setCompensation] = useState<StaffCompensation[]>([])
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([])
  const [adjustments, setAdjustments] = useState<PayrollRunAdjustment[]>([])
  const [attendance, setAttendance] = useState<AttendanceLog[]>([])
  const [loading, setLoading] = useState(true)

  const [showCompForm, setShowCompForm] = useState(false)
  const [compForm, setCompForm] = useState<{
    user_id: string
    pay_type: StaffCompensation['pay_type']
    rate: string
    effective_from: string
    notes: string
  }>({ user_id: '', pay_type: 'fixed', rate: '', effective_from: todayIST(), notes: '' })

  const [showRunForm, setShowRunForm] = useState(false)
  const [runForm, setRunForm] = useState({ user_id: '', period: '' })
  const [runError, setRunError] = useState('')

  const [adjustmentForms, setAdjustmentForms] = useState<Record<string, { description: string; amount: string }>>({})
  const [paymentMethodDraft, setPaymentMethodDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    loadData()
  }, [])

  useRealtimeRefresh(
    ['users', 'staff_compensation', 'payroll_runs', 'payroll_run_adjustments', 'attendance_logs'],
    () => loadData()
  )

  const loadData = async () => {
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId) return

      const [staffData, compData, runData, adjData, attData] = await Promise.all([
        supabase.from('users').select('*').eq('org_id', orgId),
        supabase.from('staff_compensation').select('*').eq('org_id', orgId),
        supabase
          .from('payroll_runs')
          .select('*')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false }),
        supabase.from('payroll_run_adjustments').select('*').eq('org_id', orgId),
        supabase.from('attendance_logs').select('*').eq('org_id', orgId),
      ])

      setStaff((staffData.data as User[]) || [])
      setCompensation((compData.data as StaffCompensation[]) || [])
      setPayrollRuns((runData.data as PayrollRun[]) || [])
      setAdjustments((adjData.data as PayrollRunAdjustment[]) || [])
      setAttendance((attData.data as AttendanceLog[]) || [])
    } catch (err) {
      console.error('Failed to load payroll data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Only admin/manager see every staffer's row here; everyone else sees
  // just their own (RLS already limits `compensation`/`payrollRuns` the
  // same way — this just decides which *staff* to iterate over for display).
  const visibleStaff = canManagePayroll ? staff : staff.filter((s) => s.id === profile?.id)

  const openSetRate = (userId: string) => {
    setCompForm({ user_id: userId, pay_type: 'fixed', rate: '', effective_from: todayIST(), notes: '' })
    setShowCompForm(true)
  }

  const handleCompSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const orgId = localStorage.getItem('orgId')
      if (!orgId || !compForm.user_id || !compForm.rate) return

      await supabase.from('staff_compensation').insert([
        {
          org_id: orgId,
          user_id: compForm.user_id,
          pay_type: compForm.pay_type,
          rate: parseFloat(compForm.rate),
          effective_from: compForm.effective_from,
          notes: compForm.notes || null,
        },
      ])

      setShowCompForm(false)
      loadData()
    } catch (err) {
      console.error('Failed to set compensation:', err)
    }
  }

  const handleGenerateRun = async (e: React.FormEvent) => {
    e.preventDefault()
    setRunError('')
    const orgId = localStorage.getItem('orgId')
    if (!orgId || !runForm.user_id || !runForm.period) return

    const periodStart = `${runForm.period}-01`
    const periodEnd = `${runForm.period}-${String(daysInMonthOf(periodStart)).padStart(2, '0')}`

    const comp = currentRateFor(compensation, runForm.user_id, periodEnd)
    if (!comp) {
      setRunError('This staff member has no pay rate set yet — set one above first.')
      return
    }

    const staffAttendance = attendance.filter(
      (a) => a.user_id === runForm.user_id && a.log_date >= periodStart && a.log_date <= periodEnd
    )
    const breakdown = computeBreakdown(comp, periodStart, periodEnd, staffAttendance)

    await supabase.from('payroll_runs').insert([
      {
        org_id: orgId,
        user_id: runForm.user_id,
        period_start: periodStart,
        period_end: periodEnd,
        base_pay: breakdown.basePay,
        adjustments_total: 0,
        gross_pay: breakdown.basePay,
      },
    ])

    setShowRunForm(false)
    setRunForm({ user_id: '', period: '' })
    loadData()
  }

  const recalcRunTotals = async (run: PayrollRun) => {
    const { data } = await supabase
      .from('payroll_run_adjustments')
      .select('amount')
      .eq('payroll_run_id', run.id)
    const total = (data || []).reduce((sum, a) => sum + Number(a.amount), 0)
    await supabase
      .from('payroll_runs')
      .update({ adjustments_total: total, gross_pay: run.base_pay + total })
      .eq('id', run.id)
  }

  const handleAddAdjustment = async (run: PayrollRun) => {
    const form = adjustmentForms[run.id]
    const orgId = localStorage.getItem('orgId')
    if (!orgId || !form?.description || !form.amount) return

    await supabase.from('payroll_run_adjustments').insert([
      {
        org_id: orgId,
        payroll_run_id: run.id,
        description: form.description,
        amount: parseFloat(form.amount),
      },
    ])
    await recalcRunTotals(run)
    setAdjustmentForms((prev) => ({ ...prev, [run.id]: { description: '', amount: '' } }))
    loadData()
  }

  const handleRemoveAdjustment = async (adjustment: PayrollRunAdjustment, run: PayrollRun) => {
    const ok = await confirm({
      title: 'Remove this adjustment?',
      message: `${adjustment.description} (${formatMoney(adjustment.amount)})`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return

    await supabase.from('payroll_run_adjustments').delete().eq('id', adjustment.id)
    await recalcRunTotals(run)
    loadData()
  }

  const handleDeleteRun = async (run: PayrollRun) => {
    const staffName = staff.find((s) => s.id === run.user_id)?.name || 'this staff member'
    const ok = await confirm({
      title: 'Delete this draft payroll run?',
      message: `${staffName}, ${run.period_start} to ${run.period_end}. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    const { error } = await supabase.from('payroll_runs').delete().eq('id', run.id)
    if (error) {
      await alert({ title: 'Failed to delete', message: error.message })
      return
    }
    loadData()
  }

  const handleFinalize = async (run: PayrollRun) => {
    const comp = currentRateFor(compensation, run.user_id, run.period_end)
    if (!comp) {
      await alert({ title: 'No pay rate on file', message: 'Cannot finalize without a compensation record.' })
      return
    }

    const ok = await confirm({
      title: 'Finalize this payroll run?',
      message: 'This freezes the breakdown into a payslip. Later attendance/rate edits will not change it.',
      confirmLabel: 'Finalize',
    })
    if (!ok) return

    const staffAttendance = attendance.filter(
      (a) => a.user_id === run.user_id && a.log_date >= run.period_start && a.log_date <= run.period_end
    )
    const breakdown = computeBreakdown(comp, run.period_start, run.period_end, staffAttendance)
    const runAdjustments = adjustments.filter((a) => a.payroll_run_id === run.id)
    const adjustmentsTotal = runAdjustments.reduce((sum, a) => sum + Number(a.amount), 0)
    const grossPay = breakdown.basePay + adjustmentsTotal
    const staffName = staff.find((s) => s.id === run.user_id)?.name || 'Unknown'
    const finalizedAt = new Date().toISOString()

    const snapshot: PayrollSnapshot = {
      staff_name: staffName,
      period_start: run.period_start,
      period_end: run.period_end,
      currency: getCurrencyCode(),
      pay_type: comp.pay_type,
      rate: comp.rate,
      days_in_month: breakdown.daysInMonth,
      daily_rate: breakdown.dailyRate,
      days: breakdown.days,
      days_present: breakdown.daysPresent,
      days_absent: breakdown.daysAbsent,
      days_half: breakdown.daysHalf,
      base_pay: breakdown.basePay,
      adjustments: runAdjustments.map((a) => ({ description: a.description, amount: a.amount })),
      gross_pay: grossPay,
      finalized_at: finalizedAt,
    }

    const { error } = await supabase
      .from('payroll_runs')
      .update({
        base_pay: breakdown.basePay,
        adjustments_total: adjustmentsTotal,
        gross_pay: grossPay,
        status: 'finalized',
        finalized_at: finalizedAt,
        snapshot,
      })
      .eq('id', run.id)

    if (error) {
      await alert({ title: 'Failed to finalize', message: error.message })
      return
    }
    loadData()
  }

  const handleMarkPaid = async (run: PayrollRun) => {
    const method = paymentMethodDraft[run.id] || 'cash'
    const { error } = await supabase
      .from('payroll_runs')
      .update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: method })
      .eq('id', run.id)

    if (error) {
      await alert({ title: 'Failed to mark paid', message: error.message })
      return
    }
    loadData()
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-12">
      <div className="flex flex-wrap gap-3 justify-between items-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-100">Payroll</h1>
        <Link
          href="/dashboard/settings"
          className="text-sm font-semibold text-indigo-400 hover:text-indigo-300"
        >
          ← Back to Settings
        </Link>
      </div>

      {/* Compensation Section */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-gray-100 mb-6">Compensation</h2>

        {showCompForm && canManagePayroll && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
            <form onSubmit={handleCompSubmit} className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-gray-300 font-semibold mb-2">Staff Member</label>
                <select
                  value={compForm.user_id}
                  onChange={(e) => setCompForm({ ...compForm, user_id: e.target.value })}
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
                <label className="block text-gray-300 font-semibold mb-2">Pay Type</label>
                <select
                  value={compForm.pay_type}
                  onChange={(e) =>
                    setCompForm({ ...compForm, pay_type: e.target.value as StaffCompensation['pay_type'] })
                  }
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                >
                  <option value="fixed">Fixed (monthly salary)</option>
                  <option value="hourly">Hourly</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-300 font-semibold mb-2">
                  Rate {compForm.pay_type === 'hourly' ? '(per hour)' : '(per month)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={compForm.rate}
                  onChange={(e) => setCompForm({ ...compForm, rate: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-300 font-semibold mb-2">Effective From</label>
                <input
                  type="date"
                  value={compForm.effective_from}
                  onChange={(e) => setCompForm({ ...compForm, effective_from: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-gray-300 font-semibold mb-2">Notes</label>
                <input
                  type="text"
                  value={compForm.notes}
                  onChange={(e) => setCompForm({ ...compForm, notes: e.target.value })}
                  placeholder="Optional"
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                />
              </div>
              <div className="md:col-span-2 flex gap-3">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                >
                  Save Rate
                </button>
                <button
                  type="button"
                  onClick={() => setShowCompForm(false)}
                  className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg font-semibold hover:bg-gray-700 transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : visibleStaff.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
            No staff members yet
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow overflow-x-auto">
            <table className="w-full min-w-140">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">Staff</th>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">Pay Type</th>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">Rate</th>
                  <th className="px-6 py-3 text-left text-gray-300 font-semibold">Effective From</th>
                  {canManagePayroll && (
                    <th className="px-6 py-3 text-left text-gray-300 font-semibold">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visibleStaff.map((member, i) => {
                  const current = currentRateFor(compensation, member.id, todayIST())
                  return (
                    <motion.tr
                      key={member.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      className="border-t border-gray-800 hover:bg-gray-800"
                    >
                      <td className="px-6 py-3 font-semibold text-gray-100">{member.name}</td>
                      <td className="px-6 py-3 text-gray-100">
                        {current ? (current.pay_type === 'hourly' ? 'Hourly' : 'Fixed') : '—'}
                      </td>
                      <td className="px-6 py-3 text-gray-100">
                        {current
                          ? `${formatMoney(current.rate)}${current.pay_type === 'hourly' ? '/hr' : '/mo'}`
                          : 'Not set'}
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-sm">{current?.effective_from || '—'}</td>
                      {canManagePayroll && (
                        <td className="px-6 py-3">
                          <button
                            onClick={() => openSetRate(member.id)}
                            className="text-indigo-400 hover:text-indigo-300 text-sm font-semibold"
                          >
                            Set Rate
                          </button>
                        </td>
                      )}
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payroll Runs Section */}
      <div>
        <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:justify-between sm:items-center">
          <h2 className="text-2xl font-bold text-gray-100">Payroll Runs</h2>
          {canManagePayroll && (
            <button
              onClick={() => (showRunForm ? setShowRunForm(false) : setShowRunForm(true))}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
            >
              {showRunForm ? 'Cancel' : '+ New Payroll Run'}
            </button>
          )}
        </div>

        {showRunForm && canManagePayroll && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 mb-8">
            {runError && (
              <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30">
                {runError}
              </div>
            )}
            <form onSubmit={handleGenerateRun} className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-gray-300 font-semibold mb-2">Staff Member</label>
                <select
                  value={runForm.user_id}
                  onChange={(e) => setRunForm({ ...runForm, user_id: e.target.value })}
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
                <label className="block text-gray-300 font-semibold mb-2">Month</label>
                <input
                  type="month"
                  value={runForm.period}
                  onChange={(e) => setRunForm({ ...runForm, period: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                >
                  Generate
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : payrollRuns.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
            No payroll runs yet
          </div>
        ) : (
          <div className="space-y-4">
            {payrollRuns.map((run, i) => {
              const runAdjustments = adjustments.filter((a) => a.payroll_run_id === run.id)
              const staffName = staff.find((s) => s.id === run.user_id)?.name || 'Unknown'
              const adjustmentForm = adjustmentForms[run.id] || { description: '', amount: '' }

              return (
                <motion.div
                  key={run.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  className="bg-gray-900 border border-gray-800 rounded-lg shadow p-6"
                >
                  <div className="flex flex-wrap gap-3 justify-between items-center mb-3">
                    <div>
                      <span className="font-semibold text-gray-100">{staffName}</span>
                      <span className="text-gray-400 text-sm ml-2">
                        {run.period_start} → {run.period_end}
                      </span>
                    </div>
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${STATUS_BADGE[run.status]}`}
                    >
                      {run.status}
                    </span>
                  </div>

                  <div className="text-sm text-gray-300 space-y-1 mb-4">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Base Pay</span>
                      <span>{formatMoney(run.base_pay)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Adjustments</span>
                      <span>{formatMoney(run.adjustments_total)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-gray-100 pt-1 border-t border-gray-800">
                      <span>Gross Pay</span>
                      <span>{formatMoney(run.gross_pay)}</span>
                    </div>
                  </div>

                  {run.status === 'draft' && canManagePayroll && (
                    <div className="border-t border-gray-800 pt-4 space-y-3">
                      {runAdjustments.map((adj) => (
                        <div key={adj.id} className="flex justify-between items-center text-sm">
                          <span className="text-gray-300">{adj.description}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-gray-100">{formatMoney(adj.amount)}</span>
                            <button
                              onClick={() => handleRemoveAdjustment(adj, run)}
                              className="text-red-400 hover:text-red-300 text-xs font-semibold"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={adjustmentForm.description}
                          onChange={(e) =>
                            setAdjustmentForms((prev) => ({
                              ...prev,
                              [run.id]: { ...adjustmentForm, description: e.target.value },
                            }))
                          }
                          placeholder="Bonus / deduction description"
                          className="flex-1 min-w-40 px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={adjustmentForm.amount}
                          onChange={(e) =>
                            setAdjustmentForms((prev) => ({
                              ...prev,
                              [run.id]: { ...adjustmentForm, amount: e.target.value },
                            }))
                          }
                          placeholder="Amount (+/-)"
                          className="w-36 px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                        />
                        <button
                          onClick={() => handleAddAdjustment(run)}
                          className="px-3 py-1.5 text-sm bg-gray-800 text-indigo-400 rounded-lg font-semibold hover:bg-gray-700 transition"
                        >
                          Add
                        </button>
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleFinalize(run)}
                          className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition"
                        >
                          Finalize
                        </button>
                        <button
                          onClick={() => handleDeleteRun(run)}
                          className="px-4 py-2 bg-gray-800 text-red-400 rounded-lg font-semibold hover:bg-gray-700 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}

                  {run.status === 'finalized' && canManagePayroll && (
                    <div className="border-t border-gray-800 pt-4 flex flex-wrap gap-3 items-center">
                      <select
                        value={paymentMethodDraft[run.id] || 'cash'}
                        onChange={(e) =>
                          setPaymentMethodDraft((prev) => ({ ...prev, [run.id]: e.target.value }))
                        }
                        className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-100"
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleMarkPaid(run)}
                        className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-500 transition"
                      >
                        Mark Paid
                      </button>
                      <button
                        onClick={() => printPayslip(run)}
                        className="px-4 py-1.5 bg-gray-800 text-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-700 transition"
                      >
                        Print Payslip
                      </button>
                    </div>
                  )}

                  {run.status === 'paid' && (
                    <div className="border-t border-gray-800 pt-4">
                      <button
                        onClick={() => printPayslip(run)}
                        className="px-4 py-1.5 bg-gray-800 text-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-700 transition"
                      >
                        Print Payslip
                      </button>
                    </div>
                  )}
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
