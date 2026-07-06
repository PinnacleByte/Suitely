-- Adds staff_pins, replacing the old password-based shared-terminal
-- identity confirmation (app/api/confirm-identity) with a 4-digit PIN each
-- staffer sets via Settings -> Staff. Non-destructive: adds one new table,
-- no existing table is touched. Run once.
--
-- pin_hash is "salt:scryptHash" (see lib/pin.ts, Node's built-in crypto —
-- no new dependency), never a raw PIN. RLS is enabled with NO policies at
-- all (same pattern as invoice_counters in database.sql) — a 4-digit PIN
-- space is brute-forceable offline in well under a second, so this must
-- never be reachable via the anon key even though `users` reads are
-- org-wide. Only service-role API routes touch this table.

CREATE TABLE staff_pins (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_pins_org_id ON staff_pins(org_id);

ALTER TABLE staff_pins ENABLE ROW LEVEL SECURITY;
-- No policies: only service-role API routes (app/api/staff/set-pin,
-- app/api/confirm-identity) ever touch this table.
