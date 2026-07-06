-- =====================================================================
-- Advanced Staff Management — Phase C (Compensation & Payroll)
-- Additive migration for an already-deployed database. Non-destructive:
-- creates three new tables and replaces ONE existing RLS policy on
-- audit_logs. No existing data is touched or deleted.
--
-- Source of truth: CLAUDE.md's "Outstanding Manual Steps" section
-- (lines ~411-546 as of 2026-07-05) and STAFF_MANAGEMENT_PLAN.md §5.
-- Run this whole file once in the Supabase SQL Editor.
-- =====================================================================

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

CREATE TABLE payroll_run_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_compensation_org_user ON staff_compensation(org_id, user_id);
CREATE INDEX idx_payroll_runs_org_user ON payroll_runs(org_id, user_id);
CREATE INDEX idx_payroll_run_adjustments_org_run ON payroll_run_adjustments(org_id, payroll_run_id);

ALTER TABLE staff_compensation REPLICA IDENTITY FULL;
ALTER TABLE payroll_runs REPLICA IDENTITY FULL;
ALTER TABLE payroll_run_adjustments REPLICA IDENTITY FULL;

ALTER TABLE staff_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Self or managers can view compensation" ON staff_compensation
  FOR SELECT USING (
    org_id = current_org_id() AND (user_id = auth.uid() OR current_user_role() IN ('admin', 'manager'))
  );
CREATE POLICY "Managers can set compensation" ON staff_compensation
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can delete compensation" ON staff_compensation
  FOR DELETE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

CREATE POLICY "Self or managers can view payroll runs" ON payroll_runs
  FOR SELECT USING (
    org_id = current_org_id() AND (user_id = auth.uid() OR current_user_role() IN ('admin', 'manager'))
  );
CREATE POLICY "Managers can insert payroll runs" ON payroll_runs
  FOR INSERT WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));
CREATE POLICY "Managers can update payroll runs" ON payroll_runs
  FOR UPDATE USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

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

CREATE OR REPLACE FUNCTION log_payroll_run_audit() RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_staff_name TEXT;
  v_period TEXT;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    SELECT name INTO v_staff_name FROM users WHERE id = NEW.user_id;
    v_period := to_char(NEW.period_start, 'Mon DD') || ' - ' || to_char(NEW.period_end, 'Mon DD, YYYY');
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot, summary, details)
    VALUES (NEW.org_id, 'payroll_run', NEW.id, 'create', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW),
      'Payroll Run Created', COALESCE(v_staff_name, 'Unknown') || ' — ' || v_period);
    RETURN NEW;
  ELSE
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
AFTER INSERT OR UPDATE ON payroll_runs
FOR EACH ROW EXECUTE FUNCTION log_payroll_run_audit();

-- ---------------------------------------------------------------------
-- Critical part: replace the audit_logs SELECT policy. Without this,
-- payroll_run audit entries (which carry salary figures in their
-- snapshot) would stay readable by every org member, defeating the point
-- of restricting staff_compensation/payroll_runs reads above.
-- ---------------------------------------------------------------------
DROP POLICY "Org members can view audit logs" ON audit_logs;

CREATE POLICY "Org members can view non-sensitive audit logs" ON audit_logs
  FOR SELECT USING (org_id = current_org_id() AND entity_type <> 'payroll_run');
CREATE POLICY "Self or managers can view payroll audit logs" ON audit_logs
  FOR SELECT USING (
    org_id = current_org_id() AND entity_type = 'payroll_run' AND (
      current_user_role() IN ('admin', 'manager')
      OR EXISTS (SELECT 1 FROM payroll_runs pr WHERE pr.id = audit_logs.entity_id AND pr.user_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- After running the above, one manual (non-SQL) step remains:
-- Supabase Dashboard → Database → Publications → add these three tables
-- to supabase_realtime: staff_compensation, payroll_runs,
-- payroll_run_adjustments. Without it the Payroll page loads fine but
-- never live-updates across tabs/terminals.
-- ---------------------------------------------------------------------
