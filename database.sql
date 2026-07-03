-- Organizations table (multi-tenancy)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, email)
);

-- Room types table
CREATE TABLE room_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  base_price DECIMAL(10, 2) NOT NULL,
  max_guests INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rooms table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'cleaning', 'maintenance')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, room_number)
);

-- Reservations table
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  total_price DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'checked_in', 'checked_out', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staff schedules table
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

-- Maintenance logs table
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

-- Row-level security policies
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;

-- Organizations: users can see their own org
CREATE POLICY "Users can view their org" ON organizations
  FOR SELECT USING (true);

-- Users: users can see other users in their org
CREATE POLICY "Users can view org members" ON users
  FOR SELECT USING (true);

-- Rooms: users can see rooms in their org
CREATE POLICY "Users can view org rooms" ON rooms
  FOR SELECT USING (true);

-- Room types: users can see room types in their org
CREATE POLICY "Users can view room types" ON room_types
  FOR SELECT USING (true);

-- Reservations: users can see reservations in their org
CREATE POLICY "Users can view reservations" ON reservations
  FOR SELECT USING (true);

-- Staff schedules: users can see schedules in their org
CREATE POLICY "Users can view schedules" ON staff_schedules
  FOR SELECT USING (true);

-- Maintenance logs: users can see maintenance in their org
CREATE POLICY "Users can view maintenance" ON maintenance_logs
  FOR SELECT USING (true);

-- INSERT policies (allow creation of records)
CREATE POLICY "Anyone can create orgs" ON organizations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can add users" ON users
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can add room types" ON room_types
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can add rooms" ON rooms
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can create reservations" ON reservations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can create schedules" ON staff_schedules
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can create maintenance" ON maintenance_logs
  FOR INSERT WITH CHECK (true);

-- UPDATE policies (allow modifications)
CREATE POLICY "Anyone can update orgs" ON organizations
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can update users" ON users
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can update room types" ON room_types
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can update rooms" ON rooms
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can update reservations" ON reservations
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can update schedules" ON staff_schedules
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can update maintenance" ON maintenance_logs
  FOR UPDATE USING (true) WITH CHECK (true);

-- DELETE policies (allow record deletion)
CREATE POLICY "Anyone can delete orgs" ON organizations
  FOR DELETE USING (true);

CREATE POLICY "Anyone can delete users" ON users
  FOR DELETE USING (true);

CREATE POLICY "Anyone can delete room types" ON room_types
  FOR DELETE USING (true);

CREATE POLICY "Anyone can delete rooms" ON rooms
  FOR DELETE USING (true);

CREATE POLICY "Anyone can delete reservations" ON reservations
  FOR DELETE USING (true);

CREATE POLICY "Anyone can delete schedules" ON staff_schedules
  FOR DELETE USING (true);

CREATE POLICY "Anyone can delete maintenance" ON maintenance_logs
  FOR DELETE USING (true);

-- Indexes for performance
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_rooms_org_id ON rooms(org_id);
CREATE INDEX idx_room_types_org_id ON room_types(org_id);
CREATE INDEX idx_reservations_org_id ON reservations(org_id);
CREATE INDEX idx_reservations_room_id ON reservations(room_id);
CREATE INDEX idx_staff_schedules_org_id ON staff_schedules(org_id);
CREATE INDEX idx_staff_schedules_user_id ON staff_schedules(user_id);
CREATE INDEX idx_maintenance_logs_org_id ON maintenance_logs(org_id);
CREATE INDEX idx_maintenance_logs_room_id ON maintenance_logs(room_id);

-- =====================================================================
-- Phase 2: Real auth (hotel admin + staff logins) + reservation audit trail
-- =====================================================================
-- BREAKING CHANGE: any organizations/users rows created via the old
-- passwordless setup wizard have no matching auth.users row and will be
-- rejected by the new foreign key below. Since Phase 1 had no auth at all,
-- clear existing test data before applying this section:
--   TRUNCATE organizations CASCADE;
-- then recreate the hotel through the updated /setup wizard.

-- Link the users table to Supabase Auth: users.id IS the auth.users.id.
ALTER TABLE users
  ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Generic audit log. No FK from entity_id to reservations(id) on purpose,
-- so a row here survives even after the reservation itself is deleted.
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_org_entity ON audit_logs(org_id, entity_type, entity_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper: the org_id of the currently authenticated user.
CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID AS $$
  SELECT org_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Trigger: records every create/update/delete on reservations, capturing
-- the acting user (via auth.uid()) regardless of which app code path
-- performed the change. Runs as SECURITY DEFINER so it can insert into
-- audit_logs even though staff have no direct INSERT grant there.
CREATE OR REPLACE FUNCTION log_reservation_audit() RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = auth.uid();

  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot)
    VALUES (OLD.org_id, 'reservation', OLD.id, 'delete', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot)
    VALUES (NEW.org_id, 'reservation', NEW.id, 'create', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW));
    RETURN NEW;
  ELSE
    INSERT INTO audit_logs(org_id, entity_type, entity_id, action, actor_user_id, actor_name, snapshot)
    VALUES (NEW.org_id, 'reservation', NEW.id, 'update', auth.uid(), COALESCE(v_actor_name, 'Unknown'), to_jsonb(NEW));
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_reservations_audit
AFTER INSERT OR UPDATE OR DELETE ON reservations
FOR EACH ROW EXECUTE FUNCTION log_reservation_audit();

-- Replace every permissive Phase 1 policy with real org-scoped access.

DROP POLICY "Users can view their org" ON organizations;
DROP POLICY "Anyone can create orgs" ON organizations;
DROP POLICY "Anyone can update orgs" ON organizations;
DROP POLICY "Anyone can delete orgs" ON organizations;
-- Org names aren't sensitive; USING (auth.uid() IS NOT NULL) sidesteps the
-- chicken-and-egg problem of reading the just-created org before the
-- admin's own users row exists yet.
CREATE POLICY "Authenticated users can view orgs" ON organizations
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can create an org" ON organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY "Users can view org members" ON users;
DROP POLICY "Anyone can add users" ON users;
DROP POLICY "Anyone can update users" ON users;
DROP POLICY "Anyone can delete users" ON users;
CREATE POLICY "Org members can view org users" ON users
  FOR SELECT USING (org_id = current_org_id());
-- Self-insert only (setup wizard). Staff rows are provisioned through the
-- service-role API route instead, which bypasses RLS entirely.
CREATE POLICY "Users can insert their own profile" ON users
  FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "Org members can update org users" ON users
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete org users" ON users
  FOR DELETE USING (org_id = current_org_id());

DROP POLICY "Users can view org rooms" ON rooms;
DROP POLICY "Anyone can add rooms" ON rooms;
DROP POLICY "Anyone can update rooms" ON rooms;
DROP POLICY "Anyone can delete rooms" ON rooms;
CREATE POLICY "Org members can view rooms" ON rooms
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert rooms" ON rooms
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update rooms" ON rooms
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete rooms" ON rooms
  FOR DELETE USING (org_id = current_org_id());

DROP POLICY "Users can view room types" ON room_types;
DROP POLICY "Anyone can add room types" ON room_types;
DROP POLICY "Anyone can update room types" ON room_types;
DROP POLICY "Anyone can delete room types" ON room_types;
CREATE POLICY "Org members can view room types" ON room_types
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert room types" ON room_types
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update room types" ON room_types
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete room types" ON room_types
  FOR DELETE USING (org_id = current_org_id());

DROP POLICY "Users can view reservations" ON reservations;
DROP POLICY "Anyone can create reservations" ON reservations;
DROP POLICY "Anyone can update reservations" ON reservations;
DROP POLICY "Anyone can delete reservations" ON reservations;
CREATE POLICY "Org members can view reservations" ON reservations
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert reservations" ON reservations
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update reservations" ON reservations
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete reservations" ON reservations
  FOR DELETE USING (org_id = current_org_id());

DROP POLICY "Users can view schedules" ON staff_schedules;
DROP POLICY "Anyone can create schedules" ON staff_schedules;
DROP POLICY "Anyone can update schedules" ON staff_schedules;
DROP POLICY "Anyone can delete schedules" ON staff_schedules;
CREATE POLICY "Org members can view schedules" ON staff_schedules
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert schedules" ON staff_schedules
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update schedules" ON staff_schedules
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete schedules" ON staff_schedules
  FOR DELETE USING (org_id = current_org_id());

DROP POLICY "Users can view maintenance" ON maintenance_logs;
DROP POLICY "Anyone can create maintenance" ON maintenance_logs;
DROP POLICY "Anyone can update maintenance" ON maintenance_logs;
DROP POLICY "Anyone can delete maintenance" ON maintenance_logs;
CREATE POLICY "Org members can view maintenance" ON maintenance_logs
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert maintenance" ON maintenance_logs
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update maintenance" ON maintenance_logs
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete maintenance" ON maintenance_logs
  FOR DELETE USING (org_id = current_org_id());

-- audit_logs: readable by org members, writable only by the trigger above
-- (SECURITY DEFINER bypasses RLS for its own inserts) — no client policy
-- grants INSERT/UPDATE/DELETE.
CREATE POLICY "Org members can view audit logs" ON audit_logs
  FOR SELECT USING (org_id = current_org_id());

-- =====================================================================
-- Fix: timestamp columns were TIMESTAMP (no time zone). Supabase's Postgres
-- runs in UTC, and the PostgREST API returns these without a 'Z'/offset
-- suffix, so browsers parse them as local time instead of UTC — timestamps
-- displayed in the app end up off by the viewer's UTC offset (e.g. 5:30
-- hours early for viewers in India). TIMESTAMPTZ stores/returns the
-- correct absolute instant; run this once against the already-created
-- tables (new tables created from the CREATE TABLE statements above
-- already use TIMESTAMPTZ). The `AT TIME ZONE 'UTC'` cast is safe because
-- the existing naive values were always written by NOW() while the
-- database's own time zone is UTC.
ALTER TABLE organizations ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE room_types ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE rooms ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE reservations ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE staff_schedules ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE maintenance_logs ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE maintenance_logs ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING completed_at AT TIME ZONE 'UTC';
ALTER TABLE audit_logs ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- =====================================================================
-- Check-in / check-out workflow: keep a room's live status in sync with
-- its reservations so the front desk never has to flip room status by
-- hand. Implemented as a trigger (not app code) so it fires no matter how
-- the reservation's status changes — the quick-action buttons, the edit
-- form's status dropdown, a future booking API, or a direct SQL edit all
-- funnel through here. SECURITY DEFINER so it can update rooms even though
-- the change is initiated by staff whose grants are org-scoped by RLS.
--
--   reservation -> checked_in            : room becomes 'occupied'
--   reservation -> checked_out/cancelled : room goes to 'cleaning'
--
-- Guard rails: a 'maintenance' room is never auto-occupied, and a room is
-- only sent to 'cleaning' if it was actually 'occupied' — so cancelling a
-- future booking (room still 'available') or checking out a room that's
-- since been put under maintenance won't be clobbered.
CREATE OR REPLACE FUNCTION sync_room_status_on_reservation() RETURNS TRIGGER AS $$
BEGIN
  -- Nothing to do if the status didn't actually change.
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

-- =====================================================================
-- Housekeeping / maintenance workflow: keep a room's status in sync with
-- its maintenance issues, the same trigger-driven way reservations do it.
-- A room-linked issue takes the room out of service; resolving the last
-- open issue on a room hands it back to housekeeping.
--
--   issue open/in_progress (room-linked) : room -> 'maintenance'
--   issue completed (no others open)     : room 'maintenance' -> 'cleaning'
--
-- Guard rails: an 'occupied' room is never yanked out from under a guest,
-- and a room is only handed back if it was actually 'maintenance' and no
-- other unresolved issue still references it. Completing the "cleaning"
-- handoff (cleaning -> available) is done by housekeeping, not here.
CREATE OR REPLACE FUNCTION sync_room_status_on_maintenance() RETURNS TRIGGER AS $$
DECLARE
  v_room_id UUID := COALESCE(NEW.room_id, OLD.room_id);
BEGIN
  -- Nothing to sync for issues not tied to a specific room.
  IF v_room_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- New/ongoing issue: pull the room out of service (unless a guest is in it).
  IF TG_OP <> 'DELETE' AND NEW.status IN ('open', 'in_progress') THEN
    UPDATE rooms SET status = 'maintenance'
      WHERE id = NEW.room_id AND status <> 'occupied';
    RETURN NEW;
  END IF;

  -- Issue resolved or deleted: if no other unresolved issue references this
  -- room, return it to housekeeping for a turnaround.
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
-- Itemized folio: incidental charges on top of a reservation's room cost
-- (reservations.total_price), e.g. minibar, damage, service fees, or a
-- manual discount (negative amount). Deliberately additive rather than a
-- restructure of total_price — the booking wizard and edit form keep
-- computing/editing the room cost exactly as before; a reservation's full
-- folio total is total_price + SUM(reservation_charges.amount).
-- Line items are add/remove only (no edit-in-place), so there's no UPDATE
-- policy — correcting a charge means deleting it and adding a new one.
CREATE TABLE reservation_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('service', 'damage', 'discount', 'tax', 'other')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reservation_charges_org_reservation ON reservation_charges(org_id, reservation_id);

ALTER TABLE reservation_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view reservation charges" ON reservation_charges
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert reservation charges" ON reservation_charges
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete reservation charges" ON reservation_charges
  FOR DELETE USING (org_id = current_org_id());

-- =====================================================================
-- Items catalog: staff-managed price list (extra water bottle, dental
-- kit, etc.) used to quickly add priced folio charges instead of typing
-- a description/amount by hand every time. Deliberately has no FK from
-- reservation_charges back to items — a charge's description/amount is
-- captured at the moment it's added (same "survives the source changing"
-- philosophy as audit_logs), so retiring or repricing an item never
-- rewrites history. Price edits only affect future selections.
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view items" ON items
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert items" ON items
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update items" ON items
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete items" ON items
  FOR DELETE USING (org_id = current_org_id());

-- =====================================================================
-- Richer activity descriptions: audit_logs.summary is a short label for
-- the Action column (e.g. "Checked Out", "Edited"), audit_logs.details
-- spells out specifics (e.g. "Room 101 -> 102", "3 nights early - $40.00
-- credited"). Rows written before this migration have both NULL; the UI
-- falls back to the plain action verb for those. Computed inside the
-- trigger (not app code) so it's correct no matter which code path wrote
-- the change, same as the rest of the audit trail.
ALTER TABLE audit_logs ADD COLUMN summary TEXT;
ALTER TABLE audit_logs ADD COLUMN details TEXT;

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

      IF NEW.status = 'checked_out' AND NEW.check_out_date IS DISTINCT FROM OLD.check_out_date THEN
        v_nights_diff := OLD.check_out_date - NEW.check_out_date;
        IF v_nights_diff > 0 THEN
          v_details := v_nights_diff::TEXT
            || CASE WHEN v_nights_diff = 1 THEN ' night early' ELSE ' nights early' END;
        ELSIF v_nights_diff < 0 THEN
          v_details := abs(v_nights_diff)::TEXT
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

-- Extend the audit trail to folio charges, using the same trigger-driven
-- approach as reservations. entity_id is the *reservation's* id (not the
-- charge's own id) so a charge's activity interleaves naturally with its
-- reservation's own history, both in the per-row History panel and the
-- full Activity Log. Only INSERT/DELETE matter here — charges are
-- add/remove only, per reservation_charges' own no-UPDATE-policy design.
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

-- =====================================================================
-- Fix: status-change activity (Checked In / Checked Out / Cancelled /
-- Reinstated) was leaving details NULL unless it was also an early/late
-- checkout, so most rows just showed the badge with no context. Room
-- number is genuinely useful there (skim the log without cross-
-- referencing the Guest column) — always include it, then append the
-- early/late-checkout note when relevant.
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

-- =====================================================================
-- Check-in occupancy + guest ID capture. room_types.extra_guest_fee is a
-- per-night surcharge rate staff configure once; reservations.guest_count
-- and the two guest_id_* columns hold the *lead* guest's headcount/ID,
-- captured at check-in (nullable — unknown until then). reservation_guests
-- holds every *additional* occupant beyond the lead guest, each with their
-- own name + ID, since a room can sleep more than one person.
--
-- The surcharge charge itself is computed and inserted by the check-in
-- wizard's own client code (like CheckoutDialog's early-checkout credit),
-- not a trigger — it's tied to one deliberate user action, not an
-- invariant that must hold no matter which code path touches the row.
--
-- No audit trigger on reservation_guests: ID numbers are sensitive, and
-- reservations' own audit snapshot already captures guest_count via
-- to_jsonb(NEW) without exposing per-guest ID numbers in the activity feed.
ALTER TABLE room_types ADD COLUMN extra_guest_fee DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE reservations ADD COLUMN guest_count INT;
ALTER TABLE reservations ADD COLUMN guest_id_type TEXT;
ALTER TABLE reservations ADD COLUMN guest_id_number TEXT;

CREATE TABLE reservation_guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  id_type TEXT,
  id_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reservation_guests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view reservation guests" ON reservation_guests
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert reservation guests" ON reservation_guests
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can update reservation guests" ON reservation_guests
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete reservation guests" ON reservation_guests
  FOR DELETE USING (org_id = current_org_id());

-- Follow-up to log_reservation_audit(): include the guest count on check-in,
-- same "append a small fix rather than rewrite" pattern as the earlier
-- room-number fix.
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

-- =====================================================================
-- Per-org currency. Each hotel picks the currency its prices display in
-- (see lib/currency.ts for the supported codes). Existing rows default to
-- USD so nothing breaks; the setup wizard sets it for new orgs and admins
-- can change it from /dashboard/settings. This only affects display —
-- amounts are still stored as plain DECIMALs everywhere. (The '$' literals
-- baked into the audit-log detail strings above are historical text and are
-- intentionally left as-is.)
ALTER TABLE organizations ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';

-- =====================================================================
-- BILLING — PHASE A: Payments
-- Money actually received against a reservation. Additive, like
-- reservation_charges: the folio's amount OWED is
--   total_price + SUM(reservation_charges.amount)
-- and the amount PAID is SUM(payments.amount); balance due is the
-- difference. Add/remove only (no UPDATE policy), mirroring
-- reservation_charges — correct a payment by deleting and re-adding.
-- A refund is simply a negative-amount row (same convention as a
-- discount being a negative charge), not a separate entity.
-- =====================================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,            -- positive = payment, negative = refund
  method TEXT NOT NULL DEFAULT 'cash',      -- cash | card | upi | bank_transfer | other
  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_org_reservation ON payments(org_id, reservation_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view payments" ON payments
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert payments" ON payments
  FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "Org members can delete payments" ON payments
  FOR DELETE USING (org_id = current_org_id());

-- Extend the audit trail to payments, using the same trigger-driven
-- approach as reservation_charges. entity_id is the *reservation's* id
-- (not the payment's own id) so a payment's activity interleaves with
-- its reservation's own history, both in the per-row History panel and
-- the full Activity Log. Only INSERT/DELETE matter — payments are
-- add/remove only, per the no-UPDATE-policy design above. The '$'
-- literals here match the existing charge-audit strings (historical
-- display text; per-org currency is a UI concern, not baked into logs).
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

-- =====================================================================
-- BILLING — PHASE B: Invoices (immutable records)
-- Turns the ephemeral "Print Receipt" into a real document. Issuing an
-- invoice is a deliberate, MANUAL staff action. At issue time we FREEZE
-- the line items + totals + header (guest/room/dates) + the org's
-- currency code into `snapshot` JSONB — same immutability philosophy as
-- audit_logs and the no-FK items->reservation_charges design. Editing or
-- deleting the underlying reservation/charges afterward does NOT change
-- an already-issued invoice. No DELETE — a mistake is VOIDed (a status
-- change), so numbers are never reused and the record survives.
-- =====================================================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,             -- date-based, unique per org (see next_invoice_number)
  status TEXT NOT NULL DEFAULT 'issued',    -- issued | paid | void
  snapshot JSONB NOT NULL,                  -- frozen header + line items + totals + currency
  subtotal DECIMAL(10,2) NOT NULL,          -- denormalized for the list view
  tax_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, invoice_number)
);

CREATE INDEX idx_invoices_org_reservation ON invoices(org_id, reservation_id);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view invoices" ON invoices
  FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "Org members can insert invoices" ON invoices
  FOR INSERT WITH CHECK (org_id = current_org_id());
-- UPDATE only (issued -> paid, issued -> void). No DELETE policy.
CREATE POLICY "Org members can update invoices" ON invoices
  FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- Date-based invoice numbers: INV-YYYY-MM-NNNN, sequential within each
-- org within each calendar month (period), computed in IST to line up
-- with formatIST()/dateIST() so a late-night issue lands in the intended
-- month. This is the ONE place we deviate from the app's "sequential,
-- non-atomic Supabase calls" style: number allocation must be race-safe
-- (two front-desk staff could issue at the same instant), so it goes
-- through this SECURITY DEFINER function + a per-(org, period) counter.
-- The ON CONFLICT ... DO UPDATE ... RETURNING is atomic — no lost or
-- duplicate numbers under concurrency. The UNIQUE(org_id, invoice_number)
-- on invoices is the belt-and-suspenders backstop.
CREATE TABLE invoice_counters (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period TEXT NOT NULL,          -- 'YYYY-MM' (IST)
  last_seq INT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, period)
);
-- RLS on, but no policies: only the SECURITY DEFINER function below (which
-- runs as the table owner, bypassing RLS) ever touches this table.
ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;

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
