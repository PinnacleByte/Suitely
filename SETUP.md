# Suitely - Setup Guide

## Quick Start (10 minutes)

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Create a new project (name it anything, e.g., "hotel-app")
3. Wait for it to initialize (~2 minutes)

### 2. Get Credentials
1. In Supabase, go to **Settings** → **API**
2. Copy the following:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **Anon Key** (the public one)
   - **service_role Key** (the secret one — server-only, never expose to the browser)

### 3. Configure Auth Settings
1. In Supabase, go to **Authentication** (Sign In / Providers, or Settings, depending on dashboard version)
2. Turn **on** "Allow new users to sign up"
3. Turn **off** "Confirm email" — Phase 1 has no email service, so sign-ups must return a usable session immediately. (If you can't find this toggle, use the dashboard's search/command palette and type "confirm email".)

### 4. Set Environment Variables
1. In the project root, copy `.env.local.example` to `.env.local` and fill in:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
NEXT_PUBLIC_SETUP_ENABLED=true
```
- `SUPABASE_SERVICE_ROLE_KEY` powers staff account provisioning (`app/api/staff/create`) and must never be prefixed with `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_SETUP_ENABLED` gates the public `/setup` wizard so it can't be left open in production. Set it to `true` to run first-time setup, then flip it back to `false` once your hotel exists.

### 5. Initialize Database
1. In Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy all content from `database.sql` in this project
4. Paste into the SQL editor and click **Run**
5. Wait for tables to be created ✓

`database.sql` is **self-contained and re-runnable**: it opens with a `DROP TABLE IF EXISTS … CASCADE` reset block, then recreates every table, index, RLS policy, trigger, and function — so running the whole file always gives you a clean, correct schema (including role-based RLS). ⚠ Because of the reset, **running it wipes all app data** — only do that against a project whose data you're willing to lose. It does **not** delete Supabase Auth accounts (`auth.users`); if you re-run setup with the same admin email you'll get a "user already registered" error, so either use a fresh email or delete the old login under **Authentication → Users** first.

### 6. Enable Realtime (live sync)
The app uses Supabase Realtime so a booking/check-in on one screen shows up on the others without a reload. Turn it on:
1. Supabase dashboard → **Database → Publications**
2. Open the `supabase_realtime` publication and add the app tables (`reservations`, `rooms`, `room_types`, `reservation_charges`, `payments`, `staff_schedules`, `users`, `maintenance_logs`, `items`, `invoices`, `reservation_guests`, `audit_logs`).

The schema already sets `REPLICA IDENTITY FULL` on those tables (so *updates and deletes* propagate, not just inserts). If you ever drop/recreate tables, remember the publication membership is lost and must be re-added.

### 7. Start Development Server
```bash
npm run dev
```
Note: if you add or change anything in `.env.local` while the dev server is already running, restart it (`Ctrl+C` then `npm run dev` again) — Next.js does not hot-reload environment variables.

Visit `http://localhost:3000` and click "First Time Setup" to create your admin login and your hotel!

---

## Project Structure

```
.
├── app/                          # Next.js pages
│   ├── dashboard/                 # Main dashboard pages (auth-guarded)
│   │   ├── reservations/          # List (search/filter) + New/Edit wizards
│   │   │   ├── [id]/              # Per-booking detail (Folio/Guests/History tabs)
│   │   │   └── activity/          # Audit/activity log + date-filter calendar
│   │   ├── rooms/                 # Room & room type management
│   │   ├── housekeeping/          # Cleaning queue + maintenance tracker
│   │   ├── items/                 # Priced items catalog
│   │   ├── invoices/              # Issued-invoice list (search + status filter)
│   │   ├── settings/              # Hub: Items/Invoices/Activity Log/Staff + currency
│   │   ├── staff/                 # Staff & scheduling (add/edit/delete)
│   │   └── page.tsx               # Dashboard home
│   ├── login/                     # Shared login (admin + staff)
│   ├── setup/                     # Initial setup wizard (env-flag gated)
│   ├── api/staff/create/          # Service-role staff provisioning route
│   └── page.tsx                   # Landing page
├── components/                   # Reusable React components
│   ├── DashboardNav.tsx           # Navigation bar
│   ├── QuickCheckInOut.tsx        # Navbar check-in/out dropdowns
│   ├── CheckInDialog.tsx          # Check-in wizard
│   ├── CheckoutDialog.tsx         # Check-out wizard
│   ├── ReservationFolio.tsx       # Folio + payments/balance + issue/void invoice + print
│   ├── ReservationGuests.tsx      # Guest ID viewer/editor
│   ├── ItemGrid.tsx               # Shared item-catalog picker
│   ├── ActivityCalendar.tsx       # Month-grid activity date filter
│   └── ServiceWorkerRegister.tsx  # PWA service worker (production only)
├── lib/
│   ├── supabase.ts                # Browser Supabase client
│   ├── supabaseAdmin.ts           # Server-only service-role client
│   ├── AuthContext.tsx            # Session/profile context (+ localStorage mirror)
│   ├── ConfirmDialog.tsx          # Promise-based confirm/alert dialog
│   ├── useRealtimeRefresh.ts      # Supabase Realtime refetch hook
│   ├── currency.ts                # Per-org currency + formatMoney
│   ├── printInvoice.ts            # Snapshot-driven invoice print
│   ├── formatDate.ts              # IST timestamp formatting
│   └── types.ts                   # TypeScript type definitions
├── database.sql                  # Full schema (clean, re-runnable, role-based RLS)
├── public/sw.js                  # PWA service worker
└── .env.local.example            # Environment template
```

---

## Core Features

### ✅ Implemented
- **Multi-tenancy**: Support multiple hotels with data isolation (RLS)
- **Role-based access (RLS-enforced)**: admin / manager / staff each get a different write scope (reads stay open to any org member) — see the permission matrix in [CLAUDE.md](CLAUDE.md#multi-tenancy-model)
- **Auth**: Supabase Auth logins — one shared `/login` for hotel admins and staff, role read from the `users` row
- **Billing**: record payments/refunds with a live balance, and issue immutable numbered invoices (frozen snapshot, void-not-delete)
- **Per-org currency**: each hotel picks its display currency (`lib/currency.ts`)
- **Live data sync**: Supabase Realtime keeps open pages/tabs current without a reload
- **Installable PWA**: add-to-home-screen with an offline fallback
- **Room Management**:
  - Room types (with base price, max guests, description, per-night extra-guest fee)
  - Individual rooms (linked to types)
  - Room status tracking (available, occupied, cleaning, maintenance) — kept in sync automatically by check-in/out and maintenance triggers
- **Reservations**:
  - Create, view, and manage guest reservations via a booking wizard
  - Multi-step Check-In wizard: occupancy count (with automatic over-capacity surcharge), optional guest ID capture
  - Multi-step Check-Out wizard: actual departure date (with automatic early-checkout credit), optional item charges
  - Itemized guest folio (room charge + charges from a priced items catalog or custom entries) with a printable receipt
  - Per-reservation guest ID viewer/editor (lead + additional occupants)
- **Housekeeping & Maintenance**: cleaning queue for post-checkout turnaround, and a maintenance issue tracker that automatically takes a room out of service and hands it back
- **Items Catalog**: staff-managed priced list for quick folio charges
- **Audit Trail**: Every reservation and folio-charge create/edit/delete is recorded with a human-readable description (who + what + when), visible per-reservation and in a full activity log with a date-filter calendar — survives even after the reservation is deleted
- **Staff Management**:
  - Add staff members with roles (admin, manager, staff) and a real login
  - Create shift schedules
  - Assign positions and notes
- **Dashboard**: Overview of key metrics, with actionable arrivals/departures

---

## Database Schema

### Tables
- `organizations` - Hotel/tenant info
- `users` - Staff members (`id` is the Supabase Auth user id)
- `rooms` - Individual rooms
- `room_types` - Room classifications, incl. per-night extra-guest fee
- `reservations` - Guest bookings, incl. occupancy count and lead guest ID
- `reservation_charges` - Itemized folio charges (services, discounts, surcharges)
- `reservation_guests` - Additional occupants beyond the lead guest, with ID
- `payments` - Money received against a reservation (negative = refund)
- `invoices` - Immutable issued invoices (frozen snapshot, void-not-delete)
- `invoice_counters` - Per-(org, month) sequence backing race-safe invoice numbers
- `items` - Staff-managed priced catalog for quick folio charges
- `audit_logs` - Create/update/delete trail (reservations + folio charges + payments)
- `staff_schedules` - Work schedules
- `maintenance_logs` - Maintenance tracking

All tables include Row-Level Security (RLS) scoped to the authenticated user's organization (`org_id = current_org_id()`). **Writes are additionally role-scoped** via a `current_user_role()` helper (admin / manager / staff); reads stay open to any org member. See the matrix in [CLAUDE.md](CLAUDE.md#multi-tenancy-model).

---

## How to Use

### 1. First Time Setup
- Visit homepage → Click "First Time Setup"
- Create your own admin login (name, email, password)
- Enter your hotel name and create the organization
- System ready! ✓

### 2. Add Room Types
- Dashboard → Rooms → "+ New Room Type"
- Define price, guest capacity, description, and (optionally) a per-night extra-guest fee

### 3. Add Rooms
- Dashboard → Rooms → "+ New Room"
- Assign to a room type
- Track by room number

### 4. Add Items (Optional)
- Dashboard → Settings → Items → "+ New Item"
- Priced extras (minibar, amenities) staff can quickly add to a guest's folio

### 5. Add Staff
- Dashboard → Settings → Staff → "+ Add Staff"
- Assign role, email, and a temporary password — share the password with them directly (no email invites in Phase 1)

### 6. Create Schedules
- Dashboard → Settings → Staff → "+ New Schedule"
- Assign staff to shifts with positions

### 7. Manage Reservations
- Dashboard → Reservations → "+ New Reservation"
- Link guest to room and dates
- Use the **Check in** / **Check out** buttons (on the reservation row, the Dashboard, or the navbar) to run guests through the check-in/check-out wizards
- Click "Folio" for the itemized bill, "Guests" for occupant IDs, "History" for that reservation's audit trail, or Settings → Activity Log for the full org-wide log

### 8. Housekeeping (Ongoing)
- Dashboard → Housekeeping to work the cleaning queue and track maintenance issues

---

## Next Steps

**Raised, not yet built:**
- [ ] Guest profiles / repeat-guest recognition
- [ ] Occupancy/ADR/RevPAR dashboard reporting (revenue + outstanding balance exist)
- [ ] Visual room/date availability chart
- [ ] Password-reset flow
- [ ] Configurable tax rate (billing Phase C — slot reserved on invoices)

*(Done since earlier drafts: reservation search/filter, role-based permission enforcement, billing/payments/invoices, per-org currency, live data sync, PWA.)*

**Phase 3+:**
- [ ] Guest self-service booking portal
- [ ] Email/SMS notifications
- [ ] Payment integration (Stripe)
- [ ] Advanced reporting & analytics
- [ ] OTA integrations (Booking.com, Airbnb)
- [ ] Mobile app
- [ ] Client-specific customization layer

---

## Troubleshooting

### "Environment variables not found"
- Make sure `.env.local` exists in project root
- Restart dev server: `npm run dev`

### "Connection to Supabase failed"
- Check URL and anon key are correct (no typos, trailing spaces)
- Verify Supabase project is active

### "Tables not found"
- Make sure you ran the SQL from `database.sql` in Supabase
- Check in Supabase dashboard that tables exist in "Tables" section

### "column ... does not exist" or "function ... does not exist"
- Your Supabase project is on an older schema. Since `database.sql` is now self-contained and re-runnable, just re-run the whole file (⚠ it resets all app data). Common culprits: `mark_room_clean`/`current_user_role` missing → role-RLS section not applied.

### "My code change / setup screen didn't take effect" (dev)
- The **PWA service worker** is caching stale assets. It's disabled in dev now, but if you were running an older build, clear it once: DevTools → **Application → Clear site data**, then reload. A dev-server restart alone won't fix it. (See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).)

### Setup page says "self-service setup is currently unavailable"
- Set `NEXT_PUBLIC_SETUP_ENABLED=true` in `.env.local` and **restart** the dev server (env vars don't hot-reload).

### Realtime: changes don't show on other tabs/screens without a reload
- Enable the tables in Database → **Publications** (Step 6). Also ensure they have `REPLICA IDENTITY FULL` (the schema sets this; re-run `database.sql` if unsure) — without it, updates/deletes don't propagate even when inserts do.

### "Email signups are disabled"
- In Supabase Authentication settings, turn on "Allow new users to sign up"

### "Account created, but no session was returned"
- In Supabase Authentication settings, turn off "Confirm email"

### "Data not showing"
- Make sure you went through the Setup wizard first
- Check that your organization ID is in localStorage (F12 DevTools) — it's set automatically after login

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for more.

---

## Deployment

When ready to deploy:
1. Push to GitHub
2. Deploy to Vercel (auto-connects with Next.js)
3. Set environment variables in Vercel dashboard, including `SUPABASE_SERVICE_ROLE_KEY` (server-only)
4. Done! Your app is live

**Free Tier Limits:**
- Supabase: 500MB database, 2GB bandwidth/month
- Vercel: 100GB bandwidth/month
- Both have generous free tiers for small projects

---

## Support

For questions:
- Check database.sql for schema details
- Review components/ for UI patterns
- Modify app/ pages to add new features
