export type Organization = {
  id: string
  name: string
  slug: string
  currency: string
  created_at: string
}

export type User = {
  id: string
  org_id: string
  email: string
  name: string
  role: 'admin' | 'manager' | 'staff'
  created_at: string
}

export type Room = {
  id: string
  org_id: string
  room_number: string
  room_type_id: string
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance'
  created_at: string
}

export type RoomType = {
  id: string
  org_id: string
  name: string
  description: string
  base_price: number
  max_guests: number
  extra_guest_fee: number
  created_at: string
}

export type Reservation = {
  id: string
  org_id: string
  room_id: string
  guest_name: string
  guest_email: string
  guest_phone: string
  check_in_date: string
  check_out_date: string
  total_price: number
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled'
  guest_count: number | null
  guest_id_type: string | null
  guest_id_number: string | null
  created_at: string
}

// An occupant beyond the lead guest already captured on the reservation
// itself (guest_name/guest_id_type/guest_id_number) — one row per
// additional person staying in the room, each with their own ID.
export type ReservationGuest = {
  id: string
  org_id: string
  reservation_id: string
  name: string
  id_type: string | null
  id_number: string | null
  created_at: string
}

export type ReservationCharge = {
  id: string
  org_id: string
  reservation_id: string
  description: string
  amount: number
  category: 'service' | 'damage' | 'discount' | 'tax' | 'other'
  created_at: string
}

// Money received against a reservation. Additive alongside the folio:
// amount owed is (total_price + SUM(reservation_charges.amount)); amount
// paid is SUM(payments.amount). A negative amount is a refund. Add/remove
// only, mirroring ReservationCharge.
export type Payment = {
  id: string
  org_id: string
  reservation_id: string
  amount: number
  method: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'other'
  note: string | null
  paid_at: string
  created_at: string
}

// The frozen contents of an invoice, captured at issue time so the printed
// document never changes if the underlying reservation/charges/currency are
// later edited. `currency` is the org's currency code at issue time.
export type InvoiceSnapshot = {
  guest_name: string
  room_number: string
  check_in_date: string
  check_out_date: string
  currency: string
  lines: { description: string; amount: number }[]
  subtotal: number
  tax_total: number
  total: number
  amount_paid: number
  balance_due: number
  issued_at: string
}

// An immutable billing document. Issued manually from the folio; a mistake
// is voided (status change), never deleted. See BILLING_PLAN.md Phase B.
export type Invoice = {
  id: string
  org_id: string
  reservation_id: string
  invoice_number: string
  status: 'issued' | 'paid' | 'void'
  snapshot: InvoiceSnapshot
  subtotal: number
  tax_total: number
  total: number
  issued_at: string
  created_at: string
}

export type Item = {
  id: string
  org_id: string
  name: string
  price: number
  created_at: string
}

export type StaffSchedule = {
  id: string
  org_id: string
  user_id: string
  shift_date: string
  start_time: string
  end_time: string
  position: string
  notes: string | null
  created_at: string
}

// Manager/admin-only daily attendance record. pay_override drives payroll
// docking (see STAFF_MANAGEMENT_PLAN.md Phase C): null follows the default
// rule for `status`, 'paid'/'unpaid' forces the day one way regardless.
export type AttendanceLog = {
  id: string
  org_id: string
  user_id: string
  log_date: string
  status: 'present' | 'absent' | 'late' | 'half_day' | 'on_leave'
  clock_in: string | null
  clock_out: string | null
  pay_override: 'paid' | 'unpaid' | null
  notes: string | null
  recorded_by: string | null
  created_at: string
}

// A staffer's own leave/time-off request — the one staff-writable table in
// the whole staff-management build, and only for their own row (INSERT is
// locked to status='pending' by RLS). Approve/reject is manager/admin only;
// withdrawing a still-pending request is a DELETE, not a status change.
export type LeaveRequest = {
  id: string
  org_id: string
  user_id: string
  leave_type: 'annual' | 'sick' | 'casual' | 'unpaid' | 'other'
  start_date: string
  end_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
}

// A staffer's pay rate. Append-only — a rate change is a NEW row with its
// own effective_from, never an UPDATE of an existing one (mirrors
// reservation_charges/payments). "Current" rate = the row with the latest
// effective_from <= today. Reads are restricted to the staffer themselves
// or admin/manager — the first deliberate exception to this app's usual
// "reads are org-wide" rule, since salary is per-person sensitive.
export type StaffCompensation = {
  id: string
  org_id: string
  user_id: string
  pay_type: 'hourly' | 'fixed'
  rate: number
  effective_from: string
  notes: string | null
  created_at: string
}

// An itemized bonus/deduction line on a draft payroll run, additive on top
// of base_pay (positive = bonus, negative = deduction). Add/remove only,
// and only meaningful while the parent run is still 'draft'.
export type PayrollRunAdjustment = {
  id: string
  org_id: string
  payroll_run_id: string
  description: string
  amount: number
  created_at: string
}

// Frozen at finalize time into payroll_runs.snapshot — never recomputed
// from live data afterward, same immutability guarantee as InvoiceSnapshot.
// `days[]` is the per-day audit trail behind base_pay: exactly which days
// were paid/half-paid/docked and why (see STAFF_MANAGEMENT_PLAN.md §6).
export type PayrollSnapshot = {
  staff_name: string
  period_start: string
  period_end: string
  currency: string
  pay_type: 'hourly' | 'fixed'
  rate: number
  days_in_month: number | null // fixed pay_type only — the divisor used
  daily_rate: number | null // fixed pay_type only — rate / days_in_month
  days: {
    date: string
    status: 'present' | 'absent' | 'late' | 'half_day' | 'on_leave' | 'unrecorded'
    pay_override: 'paid' | 'unpaid' | null
    amount: number
  }[]
  days_present: number
  days_absent: number
  days_half: number
  base_pay: number
  adjustments: { description: string; amount: number }[]
  gross_pay: number
  finalized_at: string
}

// A payroll run for one staffer over one period. base_pay/gross_pay are
// live-computed while `draft`; `snapshot` is written once at finalize time
// and never changes afterward, even if attendance/compensation are edited
// later (same immutability guarantee as Invoice). Reads restricted like
// StaffCompensation (self or admin/manager only).
export type PayrollRun = {
  id: string
  org_id: string
  user_id: string
  period_start: string
  period_end: string
  base_pay: number
  adjustments_total: number
  gross_pay: number
  status: 'draft' | 'finalized' | 'paid'
  snapshot: PayrollSnapshot | null
  finalized_at: string | null
  paid_at: string | null
  payment_method: string | null
  created_at: string
}

// An operating expense — the expense side of the Accounts P&L. Holds only
// operating costs (utilities, supplies, rent, ...), NEVER salaries: staff
// cost is auto-derived from payroll_runs so it isn't double-counted. Reads
// are RLS-restricted to admin/manager (financial data), like payroll.
export type Expense = {
  id: string
  org_id: string
  category:
    | 'utilities'
    | 'supplies'
    | 'maintenance'
    | 'marketing'
    | 'rent'
    | 'food_beverage'
    | 'commissions'
    | 'other'
  description: string
  amount: number
  vendor: string | null
  expense_date: string
  payment_method: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'other' | null
  notes: string | null
  recorded_by: string | null
  created_at: string
}

export type MaintenanceLog = {
  id: string
  org_id: string
  room_id: string | null
  title: string
  description: string
  status: 'open' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  created_at: string
  completed_at: string | null
}

export type AuditLog = {
  id: string
  org_id: string
  entity_type: string
  entity_id: string
  action: 'create' | 'update' | 'delete'
  actor_user_id: string | null
  actor_name: string
  snapshot: Record<string, unknown>
  summary: string | null
  details: string | null
  created_at: string
}
