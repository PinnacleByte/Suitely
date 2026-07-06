-- =====================================================================
-- Suitely — full database schema (single source of truth)
-- =====================================================================
-- This file is now CLEAN and RE-RUNNABLE: it drops every app table and
-- recreates everything from scratch, with role-based RLS defined inline
-- next to each table. Run the whole file in the Supabase SQL editor.
--
-- ⚠ DESTRUCTIVE: the reset block below drops all app tables (CASCADE), so
-- every reservation / room / staff row is wiped. It does NOT touch the
-- Supabase-managed auth.users table — so if you re-run /setup with the
-- SAME admin email you'll hit a "user already registered" conflict. Either
-- use a fresh email, or first delete the old login under Authentication →
-- Users in the Supabase dashboard.
--
-- ROLE MODEL (enforced by RLS, not just the UI):
--   • Reads: any authenticated org member can SELECT any table in their org.
--   • staff  : book/edit/delete reservations, folio charges, guests,
--              payments, issue invoices, housekeeping ops (maintenance
--              issues + mark-clean via the mark_room_clean() RPC), and
--              submitting/withdrawing their OWN leave requests.
--   • manager: everything staff can, PLUS rooms/room-types config, staff
--              accounts + schedules + attendance, voiding invoices,
--              approving/rejecting any leave request, and setting pay
--              rates / running payroll (staff_compensation, payroll_runs).
--   • admin  : everything, PLUS the items catalog and org settings (currency).
--
-- READ EXCEPTION: staff_compensation, payroll_runs, and payroll_run_adjustments
-- are NOT org-wide readable like every other table — a staffer can only see
-- their OWN rate/payslips (or admin/manager can see everyone's). This also
-- means their audit_logs entries (entity_type = 'payroll_run') are read-
-- restricted the same way — see the split audit_logs SELECT policies below.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reset (drop in reverse-dependency order; CASCADE clears policies/triggers)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS invoice_counters CASCADE;
DROP TABLE IF EXISTS staff_pins CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS reservation_guests CASCADE;
DROP TABLE IF EXISTS items CASCADE;
DROP TABLE IF EXISTS reservation_charges CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS maintenance_logs CASCADE;
DROP TABLE IF EXISTS payroll_run_adjustments CASCADE;
DROP TABLE IF EXISTS payroll_runs CASCADE;
DROP TABLE IF EXISTS staff_compensation CASCADE;
DROP TABLE IF EXISTS leave_requests CASCADE;
DROP TABLE IF EXISTS attendance_logs CASCADE;
DROP TABLE IF EXISTS staff_schedules CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS room_types CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

-- =====================================================================
-- Tables
-- =====================================================================

-- Organizations (tenants). currency is display-only (see lib/currency.ts).
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users. id IS the Supabase auth.users.id (one real login per member),
-- so there's no separate default — it's always supplied at insert time.
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, email)
);

-- Room classifications. extra_guest_fee is the per-night over-capacity surcharge.
CREATE TABLE room_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  base_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  max_guests INT NOT NULL DEFAULT 2,
  extra_guest_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Physical rooms (inventory).
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  room_type_id UUID REFERENCES room_types(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'cleaning', 'maintenance')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reservations. guest_email is optional (matches guest_phone). guest_count
-- and guest_id_* hold the lead guest's headcount/ID, captured at check-in.
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  guest_email TEXT,
  guest_phone TEXT,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  total_price DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'checked_in', 'checked_out', 'cancelled')),
  guest_count INT,
  guest_id_type TEXT,
  guest_id_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staff work shifts.
CREATE TABLE staff_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  position TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily attendance, one row per (org, staffer, day). Manager/admin-only
-- write (see role model above) — staff cannot log or edit their own
-- attendance, since the shared-terminal model means a self-write is a
-- falsification risk. pay_override drives payroll docking (see Phase C of
-- STAFF_MANAGEMENT_PLAN.md): NULL follows the default rule for `status`,
-- 'paid' forces full pay for the day (e.g. manager allows a paid leave day
-- or backfills a day nobody logged), 'unpaid' forces docking even if
-- present.
CREATE TABLE attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'half_day', 'on_leave')),
  clock_in TIME,
  clock_out TIME,
  pay_override TEXT CHECK (pay_override IN ('paid', 'unpaid')),
  notes TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, log_date)
);

-- Leave/time-off requests. Staff can insert their OWN request (locked to
-- status='pending' by the INSERT policy below, so nobody can self-approve
-- by inserting with a different status) and withdraw it by deleting while
-- still pending; only manager/admin can approve/reject (UPDATE) or delete
-- any row. No 'cancelled' status — withdrawing is a delete, same "correct
-- by remove" discipline as reservation_charges/payments.
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

-- Staff pay rate, append-only like reservation_charges/payments: a rate
-- change is a NEW row with its own effective_from, never an UPDATE of
-- history. "Current" rate = the latest row with effective_from <= today.
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

-- A payroll run for one staffer over one period. base_pay is computed
-- client-side at generation time from staff_compensation + attendance_logs
-- (see STAFF_MANAGEMENT_PLAN.md §6's pay formula) and snapshot is frozen at
-- finalize time — same immutability guarantee as invoices.snapshot.
CREATE TABLE payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  base_pay DECIMAL(10, 2) NOT NULL,
  adjustments_total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  gross_pay DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'paid')),
  snapshot JSONB,
  finalized_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Itemized bonus/deduction lines on a draft run, additive on top of
-- base_pay — same shape as reservation_charges (positive/negative amount,
-- add/remove only).
CREATE TABLE payroll_run_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Maintenance issues (housekeeping tracker).
CREATE TABLE maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Generic audit trail. No FK from entity_id to the source row on purpose,
-- so entries survive deletion of the reservation they describe.
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  -- 'confirm' = a shared-terminal identity confirmation (Stage 4): who
  -- authorized a book / check-in / check-out / payment / invoice action,
  -- written server-side by /api/confirm-identity after verifying the
  -- staffer's password (see components/… IdentityConfirm + that route).
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'confirm')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  summary TEXT,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Itemized folio charges on top of a reservation's room cost. Add/remove
-- only (no UPDATE) — correct a charge by deleting and re-adding.
CREATE TABLE reservation_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('service', 'damage', 'discount', 'tax', 'other')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Priced catalog for quick folio entries. No FK from reservation_charges
-- back to items — a charge captures description/amount at add time, so
-- retiring/repricing an item never rewrites history.
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Additional occupants beyond the lead guest (each with their own ID).
CREATE TABLE reservation_guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  id_type TEXT,
  id_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments received (positive = payment, negative = refund). Add/remove only.
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',       -- cash | card | upi | bank_transfer | other
  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable issued invoices. The folio state is frozen into snapshot JSONB
-- at issue time. No DELETE — a mistake is VOIDed (status change).
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued',     -- issued | paid | void
  snapshot JSONB NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  tax_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, invoice_number)
);

-- Per-(org, month) counter backing race-safe invoice numbers.
CREATE TABLE invoice_counters (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period TEXT NOT NULL,                       -- 'YYYY-MM' (IST)
  last_seq INT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, period)
);

-- Shared-terminal identity confirmation PINs (replaces the old
-- password-based confirm-identity flow — see app/api/confirm-identity).
-- pin_hash is "salt:scryptHash" (lib/pin.ts, Node's built-in crypto, no new
-- dependency) — NEVER a raw PIN. This table has RLS enabled with NO
-- policies at all (same as invoice_counters below): a 4-digit PIN space is
-- brute-forceable offline in well under a second, so it must never be
-- reachable via the anon key even though `users` reads are org-wide.
-- Only service-role API routes (app/api/staff/set-pin, app/api/confirm-
-- identity) ever touch this table.
CREATE TABLE staff_pins (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_rooms_org_id ON rooms(org_id);
CREATE INDEX idx_room_types_org_id ON room_types(org_id);
CREATE INDEX idx_reservations_org_id ON reservations(org_id);
CREATE INDEX idx_reservations_room_id ON reservations(room_id);
CREATE INDEX idx_staff_schedules_org_id ON staff_schedules(org_id);
CREATE INDEX idx_staff_schedules_user_id ON staff_schedules(user_id);
CREATE INDEX idx_attendance_logs_org_user ON attendance_logs(org_id, user_id);
CREATE INDEX idx_attendance_logs_org_date ON attendance_logs(org_id, log_date);
CREATE INDEX idx_leave_requests_org_user ON leave_requests(org_id, user_id);
CREATE INDEX idx_staff_compensation_org_user ON staff_compensation(org_id, user_id);
CREATE INDEX idx_payroll_runs_org_user ON payroll_runs(org_id, user_id);
CREATE INDEX idx_payroll_run_adjustments_org_run ON payroll_run_adjustments(org_id, payroll_run_id);
CREATE INDEX idx_maintenance_logs_org_id ON maintenance_logs(org_id);
CREATE INDEX idx_maintenance_logs_room_id ON maintenance_logs(room_id);
CREATE INDEX idx_audit_logs_org_entity ON audit_logs(org_id, entity_type, entity_id);
CREATE INDEX idx_reservation_charges_org_reservation ON reservation_charges(org_id, reservation_id);
CREATE INDEX idx_payments_org_reservation ON payments(org_id, reservation_id);
CREATE INDEX idx_invoices_org_reservation ON invoices(org_id, reservation_id);
CREATE INDEX idx_staff_pins_org_id ON staff_pins(org_id);

-- ---------------------------------------------------------------------
-- Realtime: REPLICA IDENTITY FULL
-- ---------------------------------------------------------------------
-- lib/useRealtimeRefresh.ts subscribes to postgres_changes filtered by
-- `org_id`. With the default replica identity, an UPDATE/DELETE only ships
-- the primary key in the change payload — so on RLS-enabled tables the
-- `org_id=eq.…` filter (and the RLS SELECT check) can't be evaluated, and
-- those events get silently dropped. Result: INSERTs sync live (full new row
-- is always shipped) but check-in/out, edits, and deletes DON'T until a
-- reload. FULL ships the whole old row, so UPDATE/DELETE sync too.
ALTER TABLE reservations REPLICA IDENTITY FULL;
ALTER TABLE rooms REPLICA IDENTITY FULL;
ALTER TABLE room_types REPLICA IDENTITY FULL;
ALTER TABLE reservation_charges REPLICA IDENTITY FULL;
ALTER TABLE payments REPLICA IDENTITY FULL;
ALTER TABLE staff_schedules REPLICA IDENTITY FULL;
ALTER TABLE attendance_logs REPLICA IDENTITY FULL;
ALTER TABLE leave_requests REPLICA IDENTITY FULL;
ALTER TABLE staff_compensation REPLICA IDENTITY FULL;
ALTER TABLE payroll_runs REPLICA IDENTITY FULL;
ALTER TABLE payroll_run_adjustments REPLICA IDENTITY FULL;
ALTER TABLE users REPLICA IDENTITY FULL;
ALTER TABLE maintenance_logs REPLICA IDENTITY FULL;
ALTER TABLE items REPLICA IDENTITY FULL;
ALTER TABLE invoices REPLICA IDENTITY FULL;
ALTER TABLE reservation_guests REPLICA IDENTITY FULL;
ALTER TABLE audit_logs REPLICA IDENTITY FULL;

-- =====================================================================
-- Helper functions (SECURITY DEFINER so they can read users under RLS)
-- =====================================================================

-- The org_id of the currently authenticated user.
CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID AS $$
  SELECT org_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- The role of the currently authenticated user ('admin'|'manager'|'staff').
-- Returns NULL before the user's own row exists (e.g. mid-setup), which
-- makes every role check below fail closed.
CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =====================================================================
-- Row-Level Security
-- =====================================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_pins ENABLE ROW LEVEL SECURITY;

-- --- organizations -------------------------------------------------
-- Org names aren't sensitive; the auth-only SELECT/INSERT sidesteps the
-- chicken-and-egg of reading/creating the org before the admin's own
-- users row exists during setup. UPDATE (currency & settings) is ADMIN ONLY.
CREATE POLICY "Authenticated can view orgs" ON organizations
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can create an org" ON organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can update their org" ON organizations
  FOR UPDATE USING (id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK (id = current_org_id() AND current_user_role() = 'admin');

-- --- users ---------------------------------------------------------
-- View: any org member. Insert: self-only (setup wizard) — staff accounts
-- are provisioned via the service-role API route, which bypasses RLS.
-- Update/Delete (staff management): manager + admin.
CREATE POLICY "Org members can view org users" ON users
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Users can insert their own profile" ON users
  FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "Managers can update org users" ON users
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete org users" ON users
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

-- --- room_types (inventory config: manager + admin) ----------------
CREATE POLICY "Org members can view room types" ON room_types
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Managers can insert room types" ON room_types
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can update room types" ON room_types
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete room types" ON room_types
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

-- --- rooms (inventory config: manager + admin) ---------------------
-- Direct writes are manager+admin. Staff-driven status changes happen via
-- SECURITY DEFINER paths instead: the room-sync triggers (check-in/out,
-- maintenance) and the mark_room_clean() RPC (housekeeping turnaround).
CREATE POLICY "Org members can view rooms" ON rooms
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Managers can insert rooms" ON rooms
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can update rooms" ON rooms
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete rooms" ON rooms
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

-- --- reservations (all org members: book / edit / delete) ----------
CREATE POLICY "Org members can view reservations" ON reservations
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert reservations" ON reservations
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update reservations" ON reservations
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete reservations" ON reservations
  FOR DELETE USING (org_id = current_org_id());

-- --- staff_schedules (staff management: manager + admin) -----------
CREATE POLICY "Org members can view schedules" ON staff_schedules
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Managers can insert schedules" ON staff_schedules
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can update schedules" ON staff_schedules
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete schedules" ON staff_schedules
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

-- --- attendance_logs (staff management: manager + admin write only) ----
-- Reads stay org-wide (like staff_schedules) — attendance status is less
-- sensitive than pay and visibility helps shift coverage. Staff cannot
-- write at all (see role model comment at top of file).
CREATE POLICY "Org members can view attendance" ON attendance_logs
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Managers can insert attendance" ON attendance_logs
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can update attendance" ON attendance_logs
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete attendance" ON attendance_logs
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

-- --- leave_requests (self-request; manager+admin decide) ---------------
-- Reads org-wide (like schedules/attendance — coverage visibility). Any
-- org member can INSERT their OWN request, locked to status='pending' so
-- nobody (including admin/manager) can insert a pre-approved row. Only
-- manager/admin can UPDATE (approve/reject). DELETE is the requester
-- withdrawing their own still-pending request, or manager/admin cleanup.
CREATE POLICY "Org members can view leave requests" ON leave_requests
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Staff can request their own leave" ON leave_requests
  FOR INSERT WITH CHECK (org_id = current_org_id() AND user_id = auth.uid() AND status = 'pending');
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

-- --- staff_compensation (pay rates: manager+admin write; SELF-OR-MANAGER
-- read — the first deliberate exception to "reads are org-wide" in this
-- app, since salary is per-person sensitive). Append-only: no UPDATE policy
-- at all — correct a rate by inserting a new effective-dated row.
CREATE POLICY "Self or managers can view compensation" ON staff_compensation
  FOR SELECT USING (
    org_id = current_org_id() AND (user_id = auth.uid() OR current_user_role() IN ('admin', 'manager'))
  );
CREATE POLICY "Managers can set compensation" ON staff_compensation
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete compensation" ON staff_compensation
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

-- --- payroll_runs (manager+admin write; self-or-manager read, same
-- sensitivity exception as staff_compensation) --------------------------
CREATE POLICY "Self or managers can view payroll runs" ON payroll_runs
  FOR SELECT USING (
    org_id = current_org_id() AND (user_id = auth.uid() OR current_user_role() IN ('admin', 'manager'))
  );
CREATE POLICY "Managers can insert payroll runs" ON payroll_runs
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can update payroll runs" ON payroll_runs
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
-- Delete is DRAFT-ONLY — once finalized/paid a run is immutable like an
-- invoice (correct via adjustments, not deletion), but nothing is locked
-- in yet at 'draft', so cleaning up a mistaken/duplicate generation is safe.
CREATE POLICY "Managers can delete draft payroll runs" ON payroll_runs
  FOR DELETE USING (
    org_id = current_org_id() AND current_user_role() IN ('admin', 'manager') AND status = 'draft'
  );

-- --- payroll_run_adjustments (itemized bonus/deduction lines on a draft
-- run; same read restriction, joined through the parent run) -----------
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

-- --- maintenance_logs (housekeeping ops: all org members incl. staff) --
CREATE POLICY "Org members can view maintenance" ON maintenance_logs
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert maintenance" ON maintenance_logs
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update maintenance" ON maintenance_logs
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete maintenance" ON maintenance_logs
  FOR DELETE USING (org_id = current_org_id());

-- --- audit_logs (read-only to clients; written only by definer triggers) --
-- Split in two (2026-07-05, Phase C): payroll_run entries carry gross
-- pay/adjustments in their snapshot, so they must NOT be org-wide readable
-- like every other entity_type — that would leak salary data around the
-- staff_compensation/payroll_runs read restriction above via this table.
-- Postgres OR's multiple permissive policies together, so the base policy
-- explicitly excludes 'payroll_run' and a second policy re-admits it only
-- for the run's own staffer or an admin/manager.
CREATE POLICY "Org members can view non-sensitive audit logs" ON audit_logs
  FOR SELECT USING (org_id = current_org_id() AND entity_type <> 'payroll_run');
CREATE POLICY "Self or managers can view payroll audit logs" ON audit_logs
  FOR SELECT USING (
    org_id = current_org_id() AND entity_type = 'payroll_run' AND (
      current_user_role() IN ('admin', 'manager')
      OR EXISTS (SELECT 1 FROM payroll_runs pr WHERE pr.id = audit_logs.entity_id AND pr.user_id = auth.uid())
    )
  );

-- --- reservation_charges (folio: all org members; add/remove only) --
CREATE POLICY "Org members can view reservation charges" ON reservation_charges
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert reservation charges" ON reservation_charges
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete reservation charges" ON reservation_charges
  FOR DELETE USING (org_id = current_org_id());

-- --- items (catalog config: ADMIN ONLY to write; all can read) -----
CREATE POLICY "Org members can view items" ON items
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Admins can insert items" ON items
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() = 'admin');
CREATE POLICY "Admins can update items" ON items
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = current_org_id() AND current_user_role() = 'admin');
CREATE POLICY "Admins can delete items" ON items
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() = 'admin');

-- --- reservation_guests (check-in ID capture: all org members) -----
CREATE POLICY "Org members can view reservation guests" ON reservation_guests
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert reservation guests" ON reservation_guests
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update reservation guests" ON reservation_guests
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete reservation guests" ON reservation_guests
  FOR DELETE USING (org_id = current_org_id());

-- --- payments (all org members; add/remove only) -------------------
CREATE POLICY "Org members can view payments" ON payments
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert payments" ON payments
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete payments" ON payments
  FOR DELETE USING (org_id = current_org_id());

-- --- invoices (issue: all org members; VOID (update): manager + admin) --
CREATE POLICY "Org members can view invoices" ON invoices
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert invoices" ON invoices
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Managers can update invoices" ON invoices
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

-- --- invoice_counters (no policies: only the definer RPC touches it) --

-- --- staff_pins (no policies: only service-role API routes touch it) --

-- =====================================================================
-- Triggers: audit trail (append-only; all SECURITY DEFINER so they can
-- write audit_logs / rooms regardless of the caller's own grants)
-- =====================================================================

-- Reservations audit: create/delete + status transitions (with room number,
-- guest count on check-in, and a nights-early/late note) + field-diff edits.
CREATE OR REPLACE FUNCTION log_reservation_audit() RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_summary TEXT;
  v_details TEXT;
  v_parts TEXT[] := '{}';
  v_nights_diff INT;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = auth.uid();

  IF TG_OP = 'DELETE' THEN
    v_summary := 'Deleted';
    v_details := 'Room ' || COALESCE((SELECT room_number FROM rooms WHERE id = OLD.room_id), '?')
      || ', ' || to_char(OLD.check_in_date, 'Mon DD') || ' - ' || to_char(OLD.check_out_date, 'Mon DD')
      || ', $' || to_char(OLD.total_price, 'FM999999990.00');
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (OLD.org_id, 'reservation', OLD.id, 'delete', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(OLD), v_summary, v_details);
    RETURN OLD;

  ELSIF TG_OP = 'INSERT' THEN
    v_summary := 'Created';
    v_details := 'Room ' || COALESCE((SELECT room_number FROM rooms WHERE id = NEW.room_id), '?')
      || ', ' || to_char(NEW.check_in_date, 'Mon DD') || ' - ' || to_char(NEW.check_out_date, 'Mon DD')
      || ', $' || to_char(NEW.total_price, 'FM999999990.00');
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'reservation', NEW.id, 'create', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW), v_summary, v_details);
    RETURN NEW;

  ELSE -- UPDATE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      CASE NEW.status
        WHEN 'checked_in' THEN v_summary := 'Checked In';
        WHEN 'checked_out' THEN v_summary := 'Checked Out';
        WHEN 'cancelled' THEN v_summary := 'Cancelled';
        ELSE v_summary := 'Reinstated';
      END CASE;

      v_details := 'Room ' || COALESCE((SELECT room_number FROM rooms WHERE id = NEW.room_id), '?');

      IF NEW.status = 'checked_in' AND NEW.guest_count IS NOT NULL THEN
        v_details := v_details || ' — ' || NEW.guest_count::TEXT
          || CASE WHEN NEW.guest_count = 1 THEN ' guest' ELSE ' guests' END;
      END IF;
      IF NEW.status = 'checked_out' AND NEW.check_out_date IS DISTINCT FROM OLD.check_out_date THEN
        v_nights_diff := OLD.check_out_date - NEW.check_out_date;
        IF v_nights_diff > 0 THEN
          v_details := v_details || ' — ' || v_nights_diff::TEXT
            || CASE WHEN v_nights_diff = 1 THEN ' night early' ELSE ' nights early' END;
        ELSIF v_nights_diff < 0 THEN
          v_details := v_details || ' — ' || abs(v_nights_diff)::TEXT
            || CASE WHEN abs(v_nights_diff) = 1 THEN ' day later than planned' ELSE ' days later than planned' END;
        END IF;
      END IF;

    ELSE
      v_summary := 'Edited';

      IF NEW.room_id IS DISTINCT FROM OLD.room_id THEN
        v_parts := array_append(v_parts, 'Room ' || COALESCE((SELECT room_number FROM rooms WHERE id = OLD.room_id), '?')
          || ' -> ' || COALESCE((SELECT room_number FROM rooms WHERE id = NEW.room_id), '?'));
      END IF;
      IF NEW.check_in_date IS DISTINCT FROM OLD.check_in_date OR NEW.check_out_date IS DISTINCT FROM OLD.check_out_date THEN
        v_parts := array_append(v_parts, to_char(OLD.check_in_date, 'Mon DD') || '-' || to_char(OLD.check_out_date, 'Mon DD')
          || ' -> ' || to_char(NEW.check_in_date, 'Mon DD') || '-' || to_char(NEW.check_out_date, 'Mon DD'));
      END IF;
      IF NEW.total_price IS DISTINCT FROM OLD.total_price THEN
        v_parts := array_append(v_parts, '$' || to_char(OLD.total_price, 'FM999999990.00') || ' -> $' || to_char(NEW.total_price, 'FM999999990.00'));
      END IF;
      IF NEW.guest_name IS DISTINCT FROM OLD.guest_name
        OR NEW.guest_email IS DISTINCT FROM OLD.guest_email
        OR NEW.guest_phone IS DISTINCT FROM OLD.guest_phone THEN
        v_parts := array_append(v_parts, 'Guest details updated');
      END IF;

      IF array_length(v_parts, 1) > 0 THEN
        v_details := array_to_string(v_parts, '; ');
      END IF;
    END IF;

    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'reservation', NEW.id, 'update', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW), v_summary, v_details);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_reservations_audit
AFTER INSERT OR UPDATE OR DELETE ON reservations
FOR EACH ROW EXECUTE FUNCTION log_reservation_audit();

-- Folio charge audit — recorded against the reservation's id so it
-- interleaves with that reservation's own history.
CREATE OR REPLACE FUNCTION log_reservation_charge_audit() RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_amount_str TEXT;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = auth.uid();

  IF TG_OP = 'DELETE' THEN
    v_amount_str := CASE WHEN OLD.amount < 0
      THEN '-$' || to_char(abs(OLD.amount), 'FM999999990.00')
      ELSE '$' || to_char(OLD.amount, 'FM999999990.00') END;
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (OLD.org_id, 'reservation_charge', OLD.reservation_id, 'delete', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(OLD), 'Charge Removed', OLD.description || ' - ' || v_amount_str);
    RETURN OLD;
  ELSE
    v_amount_str := CASE WHEN NEW.amount < 0
      THEN '-$' || to_char(abs(NEW.amount), 'FM999999990.00')
      ELSE '$' || to_char(NEW.amount, 'FM999999990.00') END;
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'reservation_charge', NEW.reservation_id, 'create', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW), 'Charge Added', NEW.description || ' - ' || v_amount_str);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_reservation_charges_audit
AFTER INSERT OR DELETE ON reservation_charges
FOR EACH ROW EXECUTE FUNCTION log_reservation_charge_audit();

-- Payment audit — also recorded against the reservation's id.
CREATE OR REPLACE FUNCTION log_payment_audit() RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_amount_str TEXT;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = auth.uid();

  IF TG_OP = 'DELETE' THEN
    v_amount_str := CASE WHEN OLD.amount < 0
      THEN '-$' || to_char(abs(OLD.amount), 'FM999999990.00')
      ELSE '$' || to_char(OLD.amount, 'FM999999990.00') END;
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (OLD.org_id, 'payment', OLD.reservation_id, 'delete', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(OLD),
      CASE WHEN OLD.amount < 0 THEN 'Refund Removed' ELSE 'Payment Removed' END,
      v_amount_str || ' (' || OLD.method || ')');
    RETURN OLD;
  ELSE
    v_amount_str := CASE WHEN NEW.amount < 0
      THEN '-$' || to_char(abs(NEW.amount), 'FM999999990.00')
      ELSE '$' || to_char(NEW.amount, 'FM999999990.00') END;
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'payment', NEW.reservation_id, 'create', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
      CASE WHEN NEW.amount < 0 THEN 'Refund Issued' ELSE 'Payment Received' END,
      v_amount_str || ' (' || NEW.method || ')');
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_payments_audit
AFTER INSERT OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION log_payment_audit();

-- Attendance audit — logged against the attendance row's own id (no
-- reservation to interleave with; surfaced in Staff's own history list).
CREATE OR REPLACE FUNCTION log_attendance_audit() RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_staff_name TEXT;
  v_summary TEXT;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = auth.uid();

  IF TG_OP = 'DELETE' THEN
    SELECT name INTO v_staff_name FROM users WHERE id = OLD.user_id;
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (OLD.org_id, 'attendance', OLD.id, 'delete', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(OLD),
      'Attendance Record Removed', COALESCE(v_staff_name, 'Unknown') || ' — ' || to_char(OLD.log_date, 'Mon DD, YYYY'));
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT name INTO v_staff_name FROM users WHERE id = NEW.user_id;
    CASE NEW.status
      WHEN 'present' THEN v_summary := 'Marked Present';
      WHEN 'absent' THEN v_summary := 'Marked Absent';
      WHEN 'late' THEN v_summary := 'Marked Late';
      WHEN 'half_day' THEN v_summary := 'Marked Half-Day';
      ELSE v_summary := 'Marked On Leave';
    END CASE;
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'attendance', NEW.id, 'create', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
      v_summary, COALESCE(v_staff_name, 'Unknown') || ' — ' || to_char(NEW.log_date, 'Mon DD, YYYY'));
    RETURN NEW;
  ELSE -- UPDATE
    SELECT name INTO v_staff_name FROM users WHERE id = NEW.user_id;
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'attendance', NEW.id, 'update', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
      'Attendance Corrected', COALESCE(v_staff_name, 'Unknown') || ' — ' || to_char(NEW.log_date, 'Mon DD, YYYY'));
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_attendance_audit
AFTER INSERT OR UPDATE OR DELETE ON attendance_logs
FOR EACH ROW EXECUTE FUNCTION log_attendance_audit();

-- Leave request audit — logged against the request's own id.
CREATE OR REPLACE FUNCTION log_leave_request_audit() RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_staff_name TEXT;
  v_date_range TEXT;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = auth.uid();

  IF TG_OP = 'DELETE' THEN
    SELECT name INTO v_staff_name FROM users WHERE id = OLD.user_id;
    v_date_range := to_char(OLD.start_date, 'Mon DD') || ' - ' || to_char(OLD.end_date, 'Mon DD');
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (OLD.org_id, 'leave_request', OLD.id, 'delete', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(OLD),
      CASE WHEN OLD.status = 'pending' THEN 'Leave Request Withdrawn' ELSE 'Leave Request Removed' END,
      COALESCE(v_staff_name, 'Unknown') || ' — ' || v_date_range);
    RETURN OLD;

  ELSIF TG_OP = 'INSERT' THEN
    SELECT name INTO v_staff_name FROM users WHERE id = NEW.user_id;
    v_date_range := to_char(NEW.start_date, 'Mon DD') || ' - ' || to_char(NEW.end_date, 'Mon DD');
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'leave_request', NEW.id, 'create', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
      'Leave Requested', COALESCE(v_staff_name, 'Unknown') || ' — ' || v_date_range || ' (' || NEW.leave_type || ')');
    RETURN NEW;

  ELSE -- UPDATE (decision)
    SELECT name INTO v_staff_name FROM users WHERE id = NEW.user_id;
    v_date_range := to_char(NEW.start_date, 'Mon DD') || ' - ' || to_char(NEW.end_date, 'Mon DD');
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'leave_request', NEW.id, 'update', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
      CASE WHEN NEW.status = 'approved' THEN 'Leave Approved' WHEN NEW.status = 'rejected' THEN 'Leave Rejected' ELSE 'Leave Request Updated' END,
      COALESCE(v_staff_name, 'Unknown') || ' — ' || v_date_range || COALESCE(' — ' || NEW.review_note, ''));
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_leave_requests_audit
AFTER INSERT OR UPDATE OR DELETE ON leave_requests
FOR EACH ROW EXECUTE FUNCTION log_leave_request_audit();

-- Payroll run audit — logged against the run's own id. Read access to
-- these specific rows is restricted (see the split audit_logs SELECT
-- policies above) since the snapshot/amounts are salary data.
CREATE OR REPLACE FUNCTION log_payroll_run_audit() RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_staff_name TEXT;
  v_period TEXT;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = auth.uid();

  IF TG_OP = 'DELETE' THEN
    SELECT name INTO v_staff_name FROM users WHERE id = OLD.user_id;
    v_period := to_char(OLD.period_start, 'Mon DD') || ' - ' || to_char(OLD.period_end, 'Mon DD, YYYY');
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (OLD.org_id, 'payroll_run', OLD.id, 'delete', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(OLD),
      'Payroll Run Deleted', COALESCE(v_staff_name, 'Unknown') || ' — ' || v_period);
    RETURN OLD;

  ELSIF TG_OP = 'INSERT' THEN
    SELECT name INTO v_staff_name FROM users WHERE id = NEW.user_id;
    v_period := to_char(NEW.period_start, 'Mon DD') || ' - ' || to_char(NEW.period_end, 'Mon DD, YYYY');
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'payroll_run', NEW.id, 'create', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
      'Payroll Run Created', COALESCE(v_staff_name, 'Unknown') || ' — ' || v_period);
    RETURN NEW;

  ELSE -- UPDATE
    SELECT name INTO v_staff_name FROM users WHERE id = NEW.user_id;
    v_period := to_char(NEW.period_start, 'Mon DD') || ' - ' || to_char(NEW.period_end, 'Mon DD, YYYY');
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'finalized' THEN
      INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
      VALUES (NEW.org_id, 'payroll_run', NEW.id, 'update', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
        'Payroll Finalized', COALESCE(v_staff_name, 'Unknown') || ' — ' || v_period);
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'paid' THEN
      INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
      VALUES (NEW.org_id, 'payroll_run', NEW.id, 'update', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
        'Payroll Marked Paid', COALESCE(v_staff_name, 'Unknown') || ' — ' || v_period);
    ELSE
      INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
      VALUES (NEW.org_id, 'payroll_run', NEW.id, 'update', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
        'Payroll Run Updated', COALESCE(v_staff_name, 'Unknown') || ' — ' || v_period);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_payroll_runs_audit
AFTER INSERT OR UPDATE OR DELETE ON payroll_runs
FOR EACH ROW EXECUTE FUNCTION log_payroll_run_audit();

-- =====================================================================
-- Triggers: room-status sync (SECURITY DEFINER — update rooms even when
-- the change is driven by a staff member with no direct rooms write grant)
-- =====================================================================

-- reservation -> checked_in : room 'occupied'; -> checked_out/cancelled : 'cleaning'.
CREATE OR REPLACE FUNCTION sync_room_status_on_reservation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'checked_in' THEN
    UPDATE rooms SET status = 'occupied'
      WHERE id = NEW.room_id AND status <> 'maintenance';
  ELSIF NEW.status IN ('checked_out', 'cancelled') THEN
    UPDATE rooms SET status = 'cleaning'
      WHERE id = NEW.room_id AND status = 'occupied';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_reservations_sync_room
AFTER INSERT OR UPDATE ON reservations
FOR EACH ROW EXECUTE FUNCTION sync_room_status_on_reservation();

-- room-linked open/in_progress issue -> room 'maintenance'; resolving the
-- last open issue hands a 'maintenance' room back to 'cleaning'.
CREATE OR REPLACE FUNCTION sync_room_status_on_maintenance() RETURNS TRIGGER AS $$
DECLARE
  v_room_id UUID := COALESCE(NEW.room_id, OLD.room_id);
BEGIN
  IF v_room_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.status IN ('open', 'in_progress') THEN
    UPDATE rooms SET status = 'maintenance'
      WHERE id = NEW.room_id AND status <> 'occupied';
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM maintenance_logs
    WHERE room_id = v_room_id
      AND status <> 'completed'
      AND id <> COALESCE(NEW.id, OLD.id)
  ) THEN
    UPDATE rooms SET status = 'cleaning'
      WHERE id = v_room_id AND status = 'maintenance';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_maintenance_sync_room
AFTER INSERT OR UPDATE OR DELETE ON maintenance_logs
FOR EACH ROW EXECUTE FUNCTION sync_room_status_on_maintenance();

-- =====================================================================
-- RPCs
-- =====================================================================

-- Housekeeping turnaround (cleaning -> available). Staff have no direct
-- rooms UPDATE grant (that's manager/admin, for inventory config), so this
-- SECURITY DEFINER function lets any org member complete a clean while the
-- org check keeps it tenant-safe. Only flips a room that's actually
-- 'cleaning' — never overrides occupied/maintenance.
CREATE OR REPLACE FUNCTION mark_room_clean(p_room UUID) RETURNS VOID AS $$
BEGIN
  UPDATE rooms SET status = 'available'
    WHERE id = p_room
      AND org_id = current_org_id()
      AND status = 'cleaning';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Race-safe date-based invoice numbers: INV-YYYY-MM-NNNN, sequential per
-- org per calendar month (IST). The atomic ON CONFLICT ... RETURNING is the
-- one deliberate deviation from the app's sequential-Supabase-call style.
CREATE OR REPLACE FUNCTION next_invoice_number(p_org UUID)
RETURNS TEXT AS $$
DECLARE
  v_period TEXT := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');
  v_seq INT;
BEGIN
  INSERT INTO invoice_counters (org_id, period, last_seq)
  VALUES (p_org, v_period, 1)
  ON CONFLICT (org_id, period)
  DO UPDATE SET last_seq = invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN 'INV-' || v_period || '-' || lpad(v_seq::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================================
-- Accounts / Financials (operating expenses)
-- =====================================================================
-- The expense side of the P&L. Revenue is derived on the fly from existing
-- reservations + reservation_charges (accrual, by check_in_date), and staff
-- cost from payroll_runs — so this table holds ONLY operating expenses
-- (utilities, supplies, rent, marketing, ...), never salaries, which would
-- double-count payroll. Reads are restricted to admin/manager (financial
-- data; the whole Accounts section is a manager/owner concern) — the first
-- read-restricted table outside payroll. No audit trigger (deliberate, like
-- staff_compensation) so amounts stay off the org-wide audit feed;
-- recorded_by + created_at cover provenance.
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'utilities', 'supplies', 'maintenance', 'marketing',
    'rent', 'food_beverage', 'commissions', 'other'
  )),
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  vendor TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'upi', 'bank_transfer', 'other')),
  notes TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expenses_org_date ON expenses(org_id, expense_date);
ALTER TABLE expenses REPLICA IDENTITY FULL;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Reads AND writes are admin/manager only — unlike most tables, staff can't
-- read expenses at all (same sensitivity treatment as payroll).
CREATE POLICY "Managers can view expenses" ON expenses
  FOR SELECT USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can insert expenses" ON expenses
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can update expenses" ON expenses
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete expenses" ON expenses
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
