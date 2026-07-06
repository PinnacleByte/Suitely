-- Adds the ability to delete a DRAFT payroll run (finalized/paid runs stay
-- immutable, same as invoices — only 'draft' can be removed). Non-destructive:
-- adds one policy and replaces the audit trigger function. Run once.

CREATE POLICY "Managers can delete draft payroll runs" ON payroll_runs
  FOR DELETE USING (
    org_id = current_org_id() AND current_user_role() IN ('admin', 'manager') AND status = 'draft'
  );

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

DROP TRIGGER IF EXISTS trg_payroll_runs_audit ON payroll_runs;
CREATE TRIGGER trg_payroll_runs_audit
AFTER INSERT OR UPDATE OR DELETE ON payroll_runs
FOR EACH ROW EXECUTE FUNCTION log_payroll_run_audit();
