-- =====================================================================
-- Accounts / Financials — operating expenses
-- Additive migration for an already-deployed database. Non-destructive:
-- creates ONE new table (expenses) with its index + RLS. No existing data
-- is touched or deleted, and no existing policy/trigger is changed.
--
-- Source of truth: CLAUDE.md's "Accounts / Financials" section. Run this
-- whole file once in the Supabase SQL Editor.
--
-- AFTER running: add `expenses` to the Realtime publication
--   Database → Publications → supabase_realtime → toggle `expenses` on
-- or expense edits won't sync live across tabs (silent no-op — see the
-- realtime gotcha in CLAUDE.md).
-- =====================================================================

-- Operating expenses only — the expense side of the P&L. Revenue is derived
-- on the fly from reservations + reservation_charges (accrual), and staff
-- cost from payroll_runs, so this table never holds salaries (that would
-- double-count payroll). Reads restricted to admin/manager (financial data);
-- no audit trigger, matching staff_compensation, to keep amounts off the
-- org-wide audit feed.
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
