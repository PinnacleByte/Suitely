# Advanced Staff Management — Design Plan

> **Status (2026-07-05): All three phases (Attendance, Leave Requests, Compensation & Payroll) BUILT and DEPLOYED.** Written the same way `BILLING_PLAN.md` was — a phased design record, updated with "✅ BUILT" notes as each phase ships. All three phases are deployed to the live database (via the full `database.sql` re-run), and the follow-up `migrations/payroll_run_delete.sql` fix has also been run — see CLAUDE.md's Outstanding Manual Steps (none remain).

## 1. Problem statement

Today `/dashboard/staff` covers two things: a staff directory (create/edit/delete accounts, admin/manager-only) and shift scheduling (`staff_schedules`). That's it — no attendance record, no leave tracking, no compensation/payroll. For a front-desk operation running on a **shared terminal** (see CLAUDE.md's Stage 4 identity-confirmation writeup), that gap matters more than usual: whoever is logged in can act for anyone, so any staff-writable attendance or pay data is a falsification risk. Hence the explicit ask — **attendance, leave approval, and payroll are manager/admin-only writes**; staff get read access to their own records and (for leave) the ability to *request*, never to *assert fact*.

## 2. Guiding principles (consistent with the existing codebase)

- **Reads are usually org-wide** (matches every other table) **except compensation and payroll**, which are financial/sensitive per-person data — a staff member should not be able to read a colleague's salary just because RLS reads are normally unrestricted elsewhere. This is a **deliberate, first-of-its-kind exception** to the "reads are open" rule and is called out per-table below.
- **Add/remove-only where it mirrors billing** — leave requests and compensation-rate changes follow the same discipline as `reservation_charges`/`payments`: correct a mistake by inserting a new row (or deleting), not by mutating history.
- **Snapshot for immutability** — a finalized payslip freezes its breakdown into JSONB at finalize time, exactly like `invoices.snapshot`. Editing attendance/leave/compensation afterward never rewrites an already-finalized payslip.
- **`current_user_role()` is the enforcement mechanism**, not new machinery — every new table's write policies are `current_user_role() IN ('admin','manager')`, same helper already driving `rooms`/`room_types`/`users`/`staff_schedules`/invoice-void.
- **No hardware/biometric time clock, no payment-gateway disbursement.** Attendance is manually logged; payroll produces a payslip *record*, it doesn't move money — consistent with "lean, free-tier stack" and the fact Stripe integration is explicitly Phase 3, guest-facing, unrelated scope.
- **`entity_type` on `audit_logs` has no CHECK constraint** (confirmed) — new values (`attendance`, `leave_request`, `compensation`, `payroll_run`) need no migration there. The existing `action` CHECK (`create/update/delete/confirm`) already covers what these triggers need.
- **No new nav items** — Attendance and Leave live as new sections on the existing `/dashboard/staff` page (staff already have read access there); Payroll gets its own page linked from the `/dashboard/settings` hub, matching how Items/Invoices/Activity Log were kept off the top nav.

---

## 3. Phase A — Attendance ✅ BUILT (2026-07-05)

The highest daily-value, lowest-complexity piece: a manager/admin marks each staffer Present/Absent/Late/Half-day per day, optionally with clock in/out times. Shipped: `attendance_logs` table + RLS (org-wide read, admin/manager-only write) + `log_attendance_audit()` trigger (migration appended to `database.sql`); `AttendanceLog` type; a new "Attendance" section on `/dashboard/staff` with a "Today's Roll Call" quick-mark card plus a full log table (add/edit/delete for admin/manager, read-only for staff). Lives under Settings → Staff — **not** added to the top nav bar. Verified with `npx tsc --noEmit`. **✅ Deployed** to the live database (via the full `database.sql` re-run) — see CLAUDE.md's Outstanding Manual Steps.

### 3.1 Schema

```sql
CREATE TABLE attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'half_day', 'on_leave')),
  clock_in TIME,
  clock_out TIME,
  -- Payroll docking override for this specific day (fixed-salary staff
  -- only — see §5.2). NULL = apply the default docking rule for `status`;
  -- 'paid' = pay the day in full regardless of status (e.g. manager
  -- approves paid leave); 'unpaid' = dock it even if status is present.
  pay_override TEXT CHECK (pay_override IN ('paid', 'unpaid')),
  notes TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, log_date)
);

CREATE INDEX idx_attendance_logs_org_user ON attendance_logs(org_id, user_id);
CREATE INDEX idx_attendance_logs_org_date ON attendance_logs(org_id, log_date);
ALTER TABLE attendance_logs REPLICA IDENTITY FULL;

ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view attendance" ON attendance_logs
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Managers can insert attendance" ON attendance_logs
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can update attendance" ON attendance_logs
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete attendance" ON attendance_logs
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
```

- `UNIQUE(org_id, user_id, log_date)` — one row per staffer per day; correcting a day is an upsert (`on_leave` status exists so a day covered by an approved leave request can be reflected here too, independent of Phase B).
- Reads stay **org-wide** (like `staff_schedules`) — attendance status isn't as sensitive as pay, and visibility helps shift coverage ("who's actually in today").
- `pay_override` needs no extra RLS — it's a column on a table only admin/manager can already write, so the existing UPDATE policy covers it. The Attendance edit form gets an optional "Override pay for this day" control next to status.
- `log_attendance_audit()` trigger (INSERT/UPDATE/DELETE), `entity_type = 'attendance'`, summaries like `Marked Present`, `Marked Absent`, `Attendance Corrected` (diff of status/times).

### 3.2 Types

```ts
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
```

### 3.3 UI — new "Attendance" section on `/dashboard/staff`

- **"Today's Roll Call" card** (admin/manager only): every active staff member listed with a one-click status selector (Present/Absent/Late/Half-day) defaulting to unset; "Save All" upserts today's `attendance_logs` rows in one pass. This is the feature that actually gets used daily — a full form per person, per day, is too much friction and won't get adopted.
- **Attendance log table** below it: month picker + optional staff filter, showing date/staff/status/times/notes, with Edit/Delete (admin/manager only) reusing the existing `ConfirmDialog` for delete. Staff (read-only) see the same table with no action column, mirroring how the Staff Members table already hides Actions for non-managers.
- `useRealtimeRefresh(['attendance_logs'], () => loadData())`, matching every other page.

**Effort:** ~1 day (table + RLS + trigger + roll-call UI + log table).

---

## 4. Phase B — Leave / Time-off requests ✅ BUILT (2026-07-05)

Staff can request; only admin/manager can decide. Because a *request* isn't an assertion of fact, letting staff create their own doesn't reopen the falsification concern — approval is still gated. Shipped: `leave_requests` table + RLS (self-insert locked to `status='pending'`, manager/admin-only approve/reject, withdraw-own-while-pending or manager/admin delete-any) + `log_leave_request_audit()` trigger (migration appended to `database.sql`); `LeaveRequest` type; a new "Leave Requests" section on `/dashboard/staff` (Settings → Staff only, no nav change) with a "+ Request Leave" form open to everyone and an Approve/Reject/Withdraw/Delete action column gated per-row by ownership + role. Verified with `npx tsc --noEmit`. **✅ Deployed** to the live database (via the full `database.sql` re-run) — see CLAUDE.md's Outstanding Manual Steps.

### 4.1 Schema

```sql
CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'other', -- annual | sick | casual | unpaid | other (UI option list, not enum)
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_leave_requests_org_user ON leave_requests(org_id, user_id);
ALTER TABLE leave_requests REPLICA IDENTITY FULL;

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view leave requests" ON leave_requests
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Staff can request their own leave" ON leave_requests
  FOR INSERT WITH CHECK (org_id = current_org_id() AND user_id = auth.uid());
CREATE POLICY "Managers can decide on leave" ON leave_requests
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Withdraw own pending or manager cleanup" ON leave_requests
  FOR DELETE USING (
    org_id = current_org_id() AND (
      (user_id = auth.uid() AND status = 'pending')
      OR current_user_role() IN ('admin', 'manager')
    )
  );
```

- No `'cancelled'` status needed — a staffer withdrawing their own request is just a DELETE while it's still `pending` (same "correct by delete" discipline as elsewhere). Once reviewed, only admin/manager can touch the row.
- **No UPDATE policy for the requester at all** — they can't edit dates/reason after submitting (delete and re-request instead), and they definitely can't self-approve.
- `log_leave_request_audit()` trigger: `Leave Requested` (INSERT), `Leave Approved`/`Leave Rejected` (UPDATE where status changed), `Leave Request Withdrawn` (DELETE while pending).
- **Approving a leave request does not auto-write `attendance_logs`** — keeps the two tables independent (approved leave is a plan; attendance is what actually happened, e.g. someone approved for leave who then covered a shift anyway). A manager can still manually set `on_leave` in Phase A's roll call for those days.

### 4.2 Types

```ts
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
```

### 4.3 UI — new "Leave Requests" section on `/dashboard/staff`

- **Everyone** gets a "+ Request Leave" button (dates, type, reason) that inserts against their own `user_id` (derived from `profile.id`, not a picker — you can't request leave for someone else).
- A list/table: staff, type, dates, status badge (amber pending / green approved / red rejected), reason. **Admin/manager** see Approve/Reject buttons on pending rows (opens a tiny reason-optional note field) plus can delete any row; **staff** see only a Withdraw button on their own pending rows.
- `useRealtimeRefresh(['leave_requests'], () => loadData())`.

**Effort:** ~1 day (table + RLS + trigger + request/approve UI).

---

## 5. Phase C — Compensation & Payroll ✅ BUILT (2026-07-05)

The most sensitive and most complex phase — deliberately split into two sub-steps and given its own page (`/dashboard/payroll`, linked from Settings) rather than crowding the Staff page further. Shipped: `staff_compensation` (append-only rate history), `payroll_runs` + `payroll_run_adjustments` (draft → finalize → paid, with a frozen `PayrollSnapshot`), `log_payroll_run_audit()` trigger, `lib/printPayslip.ts`, and the full `/dashboard/payroll` page (rate-setting, run generation from the resolved §6 formula, adjustments, Finalize, Mark Paid, Print). Verified with `npx tsc --noEmit`.

**One thing this phase required that no prior phase did:** `staff_compensation`/`payroll_runs`/`payroll_run_adjustments` reads are restricted to the staffer themselves + admin/manager — but their audit trail entries would otherwise leak through the previously-blanket, org-wide-readable `audit_logs` table. Fixed by splitting `audit_logs`'s single SELECT policy into two: one excludes `entity_type = 'payroll_run'` from the general org-wide grant, the other re-admits exactly those rows only to the run's own staffer or admin/manager. `staff_compensation` intentionally has **no** audit trigger at all (only `payroll_runs` does) — narrows the leak surface, and a rate-set is already visible as a row in the compensation table itself for anyone allowed to see it.

**Amendment (2026-07-05, after real usage):** the original design gave `payroll_runs` no DELETE policy at all (§5.2 below, matching invoices). In practice, generating a run mid-month before any attendance was logged produces a ₹0 draft that's easy to end up with by mistake (or duplicate by clicking Generate twice) — with no way to clean it up. Added a **draft-only** DELETE policy (finalized/paid runs are still immutable) plus a Delete button next to Finalize in the UI, and extended `log_payroll_run_audit()`/its trigger to log deletions (`Payroll Run Deleted`). See `migrations/payroll_run_delete.sql` for the additive migration.

**Future candidate — edit/delete a *finalized* payslip (deferred, not an oversight).** A finalized/paid run is deliberately immutable (mirrors invoices) so a payslip can't silently change after it's issued. Adding an admin-only "revert to draft" (a status `UPDATE` back to `draft`, clearing `snapshot`/`finalized_at`) or a delete-finalized path is a **small** change — a widened RLS policy + a UI action — but it weakens that immutability guarantee, so it stays deferred as a conscious decision. It also feeds the Accounts P&L (finalized runs are the "Staff Payroll" expense line), so a revert would retroactively move a period's expense. **Until it's built, clean up a test/finalized run directly in the Supabase SQL editor** (`delete from payroll_runs where id = '…'`, which runs as owner and bypasses RLS). Tracked in CLAUDE.md → Next Phases → Accounts candidates.

### 5.1 Compensation structure (rate-setting)

```sql
-- Append-only, like reservation_charges/payments: a rate change is a new
-- row with its own effective_from, never an UPDATE of history. "Current"
-- rate = latest row with effective_from <= today.
CREATE TABLE staff_compensation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pay_type TEXT NOT NULL CHECK (pay_type IN ('hourly', 'fixed')),
  rate DECIMAL(10, 2) NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_compensation_org_user ON staff_compensation(org_id, user_id);

ALTER TABLE staff_compensation ENABLE ROW LEVEL SECURITY;
-- Reads deliberately NOT org-wide — salary is per-person sensitive.
CREATE POLICY "Self or managers can view compensation" ON staff_compensation
  FOR SELECT USING (
    org_id = current_org_id() AND (user_id = auth.uid() OR current_user_role() IN ('admin', 'manager'))
  );
CREATE POLICY "Managers can set compensation" ON staff_compensation
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete compensation" ON staff_compensation
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
-- No UPDATE policy at all — correct a rate by inserting a new effective-dated row.
```

> **Resolved:** admin+manager, as written above — confirmed 2026-07-05.

### 5.2 Payroll runs

```sql
CREATE TABLE payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  base_pay DECIMAL(10, 2) NOT NULL,       -- computed from compensation + attendance at generation time
  adjustments_total DECIMAL(10, 2) NOT NULL DEFAULT 0,  -- SUM of payroll_run_adjustments while draft
  gross_pay DECIMAL(10, 2) NOT NULL,      -- base_pay + adjustments_total
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'paid')),
  snapshot JSONB,                          -- frozen breakdown, written at finalize time (like invoices.snapshot)
  finalized_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,                     -- cash | bank_transfer | upi | other (free-ish, like payments.method)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Itemized bonus/deduction lines, additive on top of base_pay — same shape
-- as reservation_charges. Add/remove only, and only while the run is 'draft'.
CREATE TABLE payroll_run_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,          -- positive = bonus, negative = deduction
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Self or managers can view payroll runs" ON payroll_runs
  FOR SELECT USING (
    org_id = current_org_id() AND (user_id = auth.uid() OR current_user_role() IN ('admin', 'manager'))
  );
CREATE POLICY "Managers can manage payroll runs" ON payroll_runs
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can update payroll runs" ON payroll_runs
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
-- Delete is DRAFT-ONLY (added 2026-07-05, after real usage showed the need
-- to clean up a mistaken/duplicate generation): CREATE POLICY "Managers can
-- delete draft payroll runs" ON payroll_runs FOR DELETE USING (org_id =
-- current_org_id() AND current_user_role() IN ('admin','manager') AND
-- status = 'draft'). Once finalized/paid a run is still immutable like an
-- invoice — nothing is locked in yet at 'draft', so deleting one is safe.

ALTER TABLE payroll_run_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Self or managers can view payroll adjustments" ON payroll_run_adjustments
  FOR SELECT USING (
    org_id = current_org_id() AND EXISTS (
      SELECT 1 FROM payroll_runs pr WHERE pr.id = payroll_run_id
        AND (pr.user_id = auth.uid() OR current_user_role() IN ('admin', 'manager'))
    )
  );
CREATE POLICY "Managers can add payroll adjustments" ON payroll_run_adjustments
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can remove payroll adjustments" ON payroll_run_adjustments
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
```

- **Generation**: manager/admin picks a staffer + period (a full calendar month, `period_start`/`period_end` = 1st/last day — custom partial periods are an edge case handled manually via adjustments, not by this formula). The client computes `base_pay` per §6's resolved formula and inserts a `draft` row. Add/remove adjustment lines while draft (bonus, deduction, advance recovery).
- **Finalize**: freezes `snapshot` (staffer name/role, period, rate, attendance breakdown, each adjustment line, gross_pay, org currency) — same immutability guarantee as invoices; editing attendance or compensation afterward never changes a finalized payslip.
- **Mark Paid**: sets `status='paid'`, `paid_at`, `payment_method` — a record that payroll was settled, **not** an actual disbursement (no gateway integration, matches Known Limitations' "No payment processing").
- `log_payroll_run_audit()` trigger: `Payroll Run Created`, `Payroll Finalized`, `Payroll Marked Paid`.
- **Print**: `lib/printPayslip.ts`, same shape as `lib/printInvoice.ts` — renders from `snapshot` only, never live data, formats via `formatMoney(n, { currency: snapshot.currency })`.

### 5.3 Types

```ts
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

export type PayrollRunAdjustment = {
  id: string
  org_id: string
  payroll_run_id: string
  description: string
  amount: number
  created_at: string
}

export type PayrollSnapshot = {
  staff_name: string
  period_start: string
  period_end: string
  currency: string
  pay_type: 'hourly' | 'fixed'
  rate: number
  days_in_month: number       // fixed pay_type only — the divisor used (§6)
  daily_rate: number | null   // fixed pay_type only — rate / days_in_month
  days: {                     // one entry per day in the period — the audit trail for docking
    date: string
    status: 'present' | 'absent' | 'late' | 'half_day' | 'on_leave' | 'unrecorded'
    pay_override: 'paid' | 'unpaid' | null
    amount: number            // what that specific day contributed to base_pay
  }[]
  days_present: number
  days_absent: number
  days_half: number
  base_pay: number
  adjustments: { description: string; amount: number }[]
  gross_pay: number
  finalized_at: string
}

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
```

### 5.4 UI — new page `app/dashboard/payroll/page.tsx`

- Linked from `/dashboard/settings` (hub), "← Back to Settings" like Items/Invoices.
- **Compensation section**: table of staff + current rate (pay type, amount, effective date); admin/manager get "Set Rate" (inserts a new effective-dated row). Non-managers see only their own row (RLS-filtered — the query just returns fewer rows, no client-side gating needed for the sensitive part).
- **Payroll Runs section**: "+ New Payroll Run" (staff picker — admin/manager only — + period dates) computes and inserts a draft; the runs list (number-free, just period + staff + status) with Draft rows expandable to add/remove adjustment lines, "Finalize", then "Mark Paid" and "Print Payslip" once finalized/paid. Non-managers see only their own runs (again via RLS, not client filtering).

**Effort:** ~2–2.5 days (two tables + adjustments + RLS + generation math + finalize/print + new page). The largest phase by far — reasonable to split further into C1 (compensation) / C2 (runs) if you want a mid-phase review point.

---

## 6. Pay computation formula (resolved 2026-07-05)

**Fixed (`pay_type = 'fixed'`) staff:**

```
days_in_month = number of calendar days in period_start's month (28/29/30/31, via a plain
                 date calc — e.g. (date_trunc('month', period_start) + interval '1 month'
                 - interval '1 day')::date, or the JS equivalent for client-side generation)
daily_rate     = rate / days_in_month

for each calendar day d in [period_start, period_end]:
  row = attendance_logs row for (user, d), if any

  if row.pay_override = 'paid':               amount(d) = daily_rate          -- forced full pay
  else if row.pay_override = 'unpaid':         amount(d) = 0                   -- forced docked
  else if row is missing:                      amount(d) = 0                   -- unrecorded = docked by default
  else if row.status IN ('present','late'):    amount(d) = daily_rate
  else if row.status = 'half_day':             amount(d) = daily_rate / 2
  else if row.status IN ('absent','on_leave'): amount(d) = 0                   -- docked by default

base_pay = SUM(amount(d) for all d in period)
```

This directly implements what you described: no attendance record, an absence, or unpaid leave all dock the day by default; `pay_override = 'paid'` is the manager/admin's escape hatch to pay a specific day anyway (whether it's `absent`, `on_leave`, or has no row at all) — and everything is per-day so the payslip snapshot (`PayrollSnapshot.days[]`) shows exactly which days were docked and why (including `status: 'unrecorded'` for the missing-row case, so a payslip is auditable even for gaps in logging).
- **Practical implication:** since an unrecorded day is now a docked day, daily attendance logging (§3's "Today's Roll Call") stops being a nice-to-have and becomes load-bearing for correct pay — worth keeping in mind when Phase A ships, since a manager skipping roll-call for a few days will silently short everyone's next payslip unless they go back and mark those days `present` (or use `pay_override`) before finalizing.
- **Hourly (`pay_type = 'hourly'`) staff:** no docking/override logic — pay is simply `SUM(hours worked per day, from clock_in/clock_out where both are logged)` × `rate`. An absence or unpaid leave day naturally contributes 0 hours; `pay_override` only applies to fixed-salary docking and is a no-op for hourly staff (their form doesn't need to show it).
- **Recommendation:** generate one payroll run per full calendar month (§5.4) so `period_start`/`period_end` always line up cleanly with `days_in_month` — a custom partial period is possible but the divisor stays "days in that calendar month," not "days in the period," which would understate a mid-month hire's pay if computed the other way.

**Overtime** remains out of scope for this plan (would need cross-referencing `attendance_logs.clock_out` against `staff_schedules.end_time`) — a "Phase C+" candidate if it matters later, analogous to how Billing deferred tax.

## 7. Suggested build order

1. **Phase A — Attendance** (highest daily value, simplest, no sensitive-read exception to design around).
2. **Phase B — Leave requests** (small, reuses Phase A's audit/RLS patterns, adds the one staff-writable table in this whole plan — scoped tightly to self-insert/self-delete-while-pending).
3. **Phase C — Compensation & Payroll** (largest; answer §6's open decisions first, then build compensation before runs since runs depend on it).

Each phase is an **appended** `database.sql` section (the file is fully re-runnable per the current convention — for a *live* org with real data you'd instead write it as a standalone additive migration, not a full re-run). After each phase: update `CLAUDE.md`'s Architecture/Key Files sections and Outstanding Manual Steps, same as Billing did.
