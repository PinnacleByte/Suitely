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
1. In the project root, create `.env.local` file:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```
`SUPABASE_SERVICE_ROLE_KEY` powers staff account provisioning (`app/api/staff/create`) and must never be prefixed with `NEXT_PUBLIC_`.

### 5. Initialize Database
1. In Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy all content from `database.sql` in this project
4. Paste into the SQL editor and click **Run**
5. Wait for tables to be created ✓

**Resuming an existing project?** `database.sql` grows incrementally — new sections get appended as features are added, and not every section may have been run against your project yet. Check [CLAUDE.md](CLAUDE.md#outstanding-manual-steps-run-this-next) for exactly what's pending before assuming everything is applied. Re-pasting the *entire* file isn't safe once some of it has already run (table/column creation isn't written to be re-run) — run only the missing section(s).

### 6. Start Development Server
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
│   │   ├── reservations/          # Reservation management + folios/guests/history
│   │   │   └── activity/          # Audit/activity log + date-filter calendar
│   │   ├── rooms/                 # Room & room type management
│   │   ├── housekeeping/          # Cleaning queue + maintenance tracker
│   │   ├── items/                 # Priced items catalog
│   │   ├── settings/              # Hub linking Items/Activity Log/Staff
│   │   ├── staff/                 # Staff & scheduling
│   │   └── page.tsx               # Dashboard home
│   ├── login/                     # Shared login (admin + staff)
│   ├── setup/                     # Initial setup wizard
│   ├── api/staff/create/          # Service-role staff provisioning route
│   └── page.tsx                   # Landing page
├── components/                   # Reusable React components
│   ├── DashboardNav.tsx           # Navigation bar
│   ├── QuickCheckInOut.tsx        # Navbar check-in/out dropdowns
│   ├── CheckInDialog.tsx          # Check-in wizard
│   ├── CheckoutDialog.tsx         # Check-out wizard
│   ├── ReservationFolio.tsx       # Itemized folio + print receipt
│   ├── ReservationGuests.tsx      # Guest ID viewer/editor
│   ├── ItemGrid.tsx               # Shared item-catalog picker
│   └── ActivityCalendar.tsx       # Month-grid activity date filter
├── lib/
│   ├── supabase.ts                # Browser Supabase client
│   ├── supabaseAdmin.ts           # Server-only service-role client
│   ├── AuthContext.tsx            # Session/profile context
│   ├── formatDate.ts              # IST timestamp formatting
│   └── types.ts                   # TypeScript type definitions
├── database.sql                  # Database schema (run once in Supabase)
└── .env.local.example            # Environment template
```

---

## Core Features

### ✅ Implemented
- **Multi-tenancy**: Support multiple hotels with data isolation (RLS) — not yet role-scoped, see [CLAUDE.md](CLAUDE.md#known-limitations-phase-2-honestly-assessed)
- **Auth**: Supabase Auth logins — one shared `/login` for hotel admins and staff, role read from the `users` row
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
- `items` - Staff-managed priced catalog for quick folio charges
- `audit_logs` - Create/update/delete trail (reservations + folio charges)
- `staff_schedules` - Work schedules
- `maintenance_logs` - Maintenance tracking

All tables include Row-Level Security (RLS) policies scoped to the authenticated user's organization (`org_id = current_org_id()`), not the old `USING (true)` open policies.

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

**Raised, not yet built (see [CLAUDE.md](CLAUDE.md#phase-25-candidates-raised-not-yet-built)):**
- [ ] Guest profiles / repeat-guest recognition
- [ ] Occupancy/ADR/RevPAR dashboard reporting
- [ ] Visual room/date availability chart
- [ ] Role-based permission enforcement
- [ ] Password-reset flow
- [ ] Reservation search/filter

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

### "column ... does not exist" (e.g. guest_count, extra_guest_fee)
- `database.sql` grows incrementally as features are added — this means a pending section hasn't been run yet. See [CLAUDE.md](CLAUDE.md#outstanding-manual-steps-run-this-next) for exactly which section(s) are still pending.

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
