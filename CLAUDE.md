# Suitely - Project Context

## Project Overview
**Suitely** is a **Next.js + Supabase** hotel management system designed for:
- **Multi-tenant SaaS**: Same codebase serves multiple hotels via shared database with tenant isolation
- **Generic template**: Customizable for specific clients later
- **Lean startup**: Free tier technology stack, single developer (primary) + 1 co-developer

**Current scope**: Phase 2 is essentially complete — real auth/audit trail, full check-in/check-out workflows, housekeeping & maintenance, an itemized folio with a priced items catalog, occupancy/guest-ID capture, and a richer activity log. **See [Outstanding Manual Steps](#outstanding-manual-steps-run-this-next) before doing anything else in a new session** — the last two migrations in `database.sql` are not confirmed deployed yet.

## Tech Stack
- **Framework**: Next.js 16+ (App Router)
- **Database**: Supabase (PostgreSQL + Auth + Realtime — Realtime is available but not yet used)
- **Frontend**: React 19, TypeScript, Tailwind CSS 4, Framer Motion (subtle transitions)
- **Auth**: Supabase Auth (email/password) — one shared `/login` page for both hotel admins and staff
- **Theme**: Dark mode only (no light mode/toggle)
- **Hosting**: Vercel (Next.js native)
- **Free tier**: No paid services yet

## Architecture

### Multi-Tenancy Model
- **Shared database** with `org_id` column on all tables
- **Row-Level Security (RLS)**: Supabase policies isolate data per tenant via `current_org_id()`, derived from the authenticated user's `users` row (`auth.uid()`)
- **Organization storage**: Hotel info saved in `organizations` table
- **Org ID in localStorage**: Tracks which hotel the user is using (populated from the logged-in user's profile, not set manually)
- **No role enforcement in RLS**: `users.role` (admin/manager/staff) is captured and shown in the UI, but every RLS policy only checks org membership — any authenticated org member can perform any write (delete a reservation, add a folio discount, delete another staff member's schedule). Deliberate known gap, not an oversight.

### Auth Model
- `users.id` **is** the Supabase Auth `auth.users.id` (not a separate directory row) — one real login per staff member/admin.
- **Hotel admin**: created via the `/setup` wizard (admin account first, then the hotel/org, since RLS requires an authenticated user to insert into `organizations`).
- **Staff**: provisioned by an admin/manager from `/dashboard/staff`, via `app/api/staff/create` using the Supabase **service role key** server-side (client-side `signUp` would replace the admin's own session).
- Route protection is a client-side guard in `app/dashboard/layout.tsx` (no middleware) — the real security boundary is RLS, not the guard.
- **No password-reset UI** — Supabase Auth supports it, but there's no frontend for it yet. A locked-out user currently needs manual intervention via the Supabase dashboard (Authentication → Users).

### Audit Trail
- Generic `audit_logs` table (`entity_type`, `entity_id`, `action`, `actor_user_id`, `actor_name`, `snapshot` JSONB, `summary`, `details`) covers both `reservations` and `reservation_charges`, via two Postgres triggers — not application code. No FK from `entity_id` to the source row, so entries survive deletion.
- `summary`/`details` are computed **inside the trigger**, not diffed client-side, so they're correct no matter which code path made the change:
  - `log_reservation_audit()` (on `reservations`): `Created` / `Deleted` (with room, dates, price), `Checked In` / `Checked Out` / `Cancelled` / `Reinstated` (status transitions — includes room number, guest count on check-in, and a nights-early/late note on early/late checkout), or `Edited` (a diff of whatever changed: room, dates, price, or "Guest details updated").
  - `log_reservation_charge_audit()` (on `reservation_charges`): `Charge Added` / `Charge Removed`, recorded against the **reservation's** id (not the charge's own id) so it interleaves with that reservation's own history. Only INSERT/DELETE — charges are add/remove only, no UPDATE policy.
  - **No audit trigger on `reservation_guests`** (deliberate) — guest ID numbers are sensitive PII; logging them into a generic activity feed would be bad practice. Only `reservations.guest_count` shows up in the audit trail (via the reservation's own snapshot), not per-guest ID numbers.
- Surfaced in the UI via:
  - A per-row "History" expander on `/dashboard/reservations` (queries both `entity_type IN ('reservation', 'reservation_charge')` for that reservation's id).
  - A full `/dashboard/reservations/activity` page — merged, chronological, with an `ActivityCalendar` sidebar (month grid, dots on days with recorded activity, click a day to filter). All logs are loaded once and filtered client-side — fine at current scale, but the first thing to revisit if a single org accumulates years of history (see Known Limitations).
- Timestamps are `TIMESTAMPTZ` and displayed via `lib/formatDate.ts`'s `formatIST()` helper (staff are in India). `dateIST()` does the same conversion for grouping timestamps by IST calendar day (used by the activity calendar).

### Check-In / Check-Out Workflow
Both directions are full multi-step wizard dialogs, not one-click actions — every entry point (Reservations table, Dashboard's "Arriving Today"/"Departing Today", and the navbar's Quick Check In/Out) opens the same dialog, so behavior is identical regardless of where staff start it.

- **`components/CheckInDialog.tsx`** (3 steps: Occupancy → Guest IDs → Review):
  1. Staff enters how many guests are staying. The room type's `max_guests` is shown for context; if the count exceeds it, a live preview shows the surcharge that will be added (`room_types.extra_guest_fee` per night × excess guests × nights of the stay).
  2. Optional ID capture — a "lead guest" ID (stored directly on `reservations.guest_id_type`/`guest_id_number`) plus one card per additional occupant (name + ID, stored in `reservation_guests`). Nothing here is required; front desk can check someone in before ID is handed over.
  3. Review & confirm: sets `status = 'checked_in'`, `guest_count`, and the lead guest's ID; inserts `reservation_guests` rows for any additional guest with a non-blank name; inserts the surcharge as a `reservation_charges` row (`category: 'service'`) if applicable.
  - `components/ReservationGuests.tsx` is the standalone panel (toggle: "Guests", next to Folio/History on the Reservations table) for viewing or adding/editing/removing guest IDs **after** check-in — the natural complement to step 2 being optional.
- **`components/CheckoutDialog.tsx`** (3 steps: Departure → Items → Review):
  1. Staff confirms the *actual* departure date (defaults to today, editable). This matters beyond display: the booking wizard's overlap check treats any non-cancelled reservation as occupying its room through `check_out_date`, so an early departure with a stale future date would keep blocking rebookings for nights the guest actually vacated. If the date is earlier than the original `check_out_date`, a live preview shows the prorated credit (`total_price ÷ original nights × unused nights`).
  2. Optional: add catalog items (minibar, etc.) the guest used, via `ItemGrid` (see Items Catalog below).
  3. Review & confirm: sets `status = 'checked_out'` and the real `check_out_date`; inserts the early-checkout credit as a `reservation_charges` row (`category: 'discount'`, negative amount) if applicable; inserts item charges (`category: 'service'`).
- **Room status is kept in sync by a DB trigger** (`sync_room_status_on_reservation()`), not by either dialog — `checked_in` → room `occupied`; `checked_out`/`cancelled` → room `cleaning` (never overrides `maintenance`; never flips a room to `cleaning` unless it was actually `occupied`). This fires on any code path that changes a reservation's status, not just the wizards.
- Neither wizard is atomic (no DB transaction) — sequential Supabase calls, consistent with the rest of the app's style. The surcharge/credit are computed **once**, at confirm time; editing `guest_count` or dates afterward does **not** retroactively adjust the folio — staff correct it manually via the Folio/Guests panels if needed.
- `components/QuickCheckInOut.tsx` (navbar): two dropdown buttons — Check In defaults to today's confirmed arrivals with a count badge, plus a search box that reaches any confirmed reservation (for early/backlog check-ins); Check Out defaults to everyone currently checked in (not date-gated, since a guest can leave any day), with a count badge showing guests scheduled to depart *today* specifically. Selecting a guest from either opens the same `CheckInDialog`/`CheckoutDialog` used everywhere else. This component fetches its own reservations/rooms data independently (no shared global state anywhere in the app), so if you check someone in/out from the navbar while sitting on Dashboard or Reservations, that page's own list won't refresh until you navigate away and back.

### Folio & Items Catalog
- **`reservation_charges`**: itemized costs on top of a reservation's room cost (`reservations.total_price`), e.g. minibar, damage, service fees, or a manual discount (negative amount). Deliberately additive — `total_price` still drives the booking wizard, price auto-calc, and edit form exactly as before; a reservation's full folio total is `total_price + SUM(reservation_charges.amount)`. Add/remove only (no UPDATE policy) — correcting a charge means deleting it and adding a new one.
- **`items`**: a staff-managed price list (name + price) for quick, priced folio entries instead of typing a description/amount by hand. Deliberately **no FK** from `reservation_charges` back to `items` — a charge's description/amount is captured at the moment it's added, so retiring or repricing an item never rewrites history (same philosophy as `audit_logs`).
- **`components/ItemGrid.tsx`**: the shared picker — a grid of catalog items with a quantity stepper each. Reused in `CheckoutDialog`'s Items step and in `ReservationFolio`'s "From Catalog" charge mode.
- **`components/ReservationFolio.tsx`** (toggle: "Folio", on the Reservations table): shows the room charge + all itemized charges + grand total. "+ Add Charge" offers two modes — **From Catalog** (default; `ItemGrid`, batch-add multiple items at once) and **Custom** (free-text description/category/signed amount, for anything not in the catalog). "Print Receipt" opens a small, self-contained popup window (guest, room, dates, itemized charges, total, IST timestamp) and triggers the browser's print dialog — no PDF library; the browser's own "Save as PDF" option covers that case.
- `/dashboard/items` — CRUD page for the catalog (table view: name, price, edit/delete). Reachable from `/dashboard/settings`, not a top-level nav tab.

### Housekeeping & Maintenance
- `/dashboard/housekeeping` has two sections:
  - **Cleaning Queue**: every room with `status = 'cleaning'` (i.e., checked out and not yet turned around), with a one-click "Mark clean" → `available`, and a "Report issue" shortcut per room.
  - **Maintenance Tracker**: create an issue (title, description, optional room link, priority) → `open`; advance through `in_progress` → `completed` (stamps `completed_at`), or `Reopen`/`Delete`. Completed issues collapse into a `<details>` section.
- **`sync_room_status_on_maintenance()`** trigger: a room-linked `open`/`in_progress` issue takes the room to `status = 'maintenance'` (unless it's currently `occupied` — never pulls a room out from under a guest). Resolving/deleting the **last** unresolved issue on a room hands it to `cleaning` (not straight to `available` — it still needs a housekeeping pass).
- The Rooms page's `maintenance`-status room cards show the actual open issue (or a count, if several) with a link to Housekeeping — not just a bare status badge.

### Data Flow
1. User runs setup wizard → Creates their admin login, then the organization
2. Organization ID stored in localStorage (via `lib/AuthContext.tsx` after login)
3. All queries filter by `org_id` automatically, enforced again by RLS
4. Every page fetches its own data independently on mount — there is no shared/global client state anywhere in the app (not even between the navbar's `QuickCheckInOut` and the page it's rendered on top of). This is consistent throughout, but means an action taken from one component doesn't refresh another component's already-loaded list.
5. Future: Support multiple organizations per user account

### Dashboard Widgets
`app/dashboard/page.tsx` is a real operations dashboard, not just a stats/checklist page:
- **Room status breakdown**: counts for all four `Room['status']` values (available/occupied/cleaning/maintenance), not just "occupied".
- **Arrivals/departures today**: reservations where `check_in_date`/`check_out_date` equals `todayIST()`, excluding cancelled. Both lists are actionable — "Check in" / "Check out" buttons open `CheckInDialog`/`CheckoutDialog` directly from the dashboard.
- **Revenue snapshot**: this month's revenue from non-cancelled reservations whose `check_in_date` falls in the current IST month, plus a separate "upcoming confirmed revenue" figure for future `confirmed` bookings not yet checked in. **Note**: this still sums `reservations.total_price` only — it does not include folio charges (items, surcharges, discounts), a known gap not yet closed.
- **Staff on shift today**: `staff_schedules` rows where `shift_date` equals `todayIST()`, joined against `users` for names.
- **Quick Actions**: links to Reservations, Rooms, Housekeeping, Items, and Staff.
- Prices are shown with a plain `$` prefix everywhere (Reservations, Rooms, Dashboard, Items) — the app has no currency setting, so don't introduce a different currency format on just one page.

### Rooms Page Organization
`app/dashboard/rooms/page.tsx` groups the Rooms section by room type (section header per `room_types` row, rooms sorted numerically by `room_number` within each), with a status filter tab row (All/Available/Occupied/Cleaning/Maintenance, each showing a live count) above it. Rooms whose `room_type_id` doesn't match any current room type render under an "Other Rooms" fallback group rather than being hidden. Room types now also carry `extra_guest_fee` (per-night surcharge rate) alongside `base_price`/`max_guests`/`description`.

### Navigation
Top nav (`components/DashboardNav.tsx`): **Dashboard · Reservations · Rooms · Housekeeping · Settings**, plus the `QuickCheckInOut` dropdowns and the profile/logout section. `/dashboard/settings` is a hub page linking to **Items**, **Activity Log**, and **Staff** — these were top-level nav tabs originally, moved out to declutter the primary nav (per explicit request). Items and Staff pages each have a "← Back to Settings" link; Activity Log kept its pre-existing "← Back to Reservations" link since that's still its more useful context.

**Mobile nav**: below the `md` breakpoint (768px) the inline links + user/logout collapse into a hamburger drawer (`NAV_LINKS` array drives both the desktop row and the drawer so they can't drift), while `QuickCheckInOut` stays in the top bar — Check In/Out are the highest-frequency front-desk actions and their count badges need to stay one tap away.

### Responsive / Mobile
The whole dashboard is expected to hold the viewport on any device (verified down to phone widths). Conventions used throughout, worth matching on new pages:
- **Data tables** (`reservations`, `activity`, `staff`, `items`) live in an `overflow-x-auto` card with a `min-w-*` on the `<table>` — they scroll horizontally within their card rather than pushing the page wider than the screen. Don't wrap a wide table in `overflow-hidden` (clips the Actions column instead of letting it scroll).
- **Page/section header toolbars** that pair a heading with an action button use `flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center` so the button drops below the title on mobile instead of colliding with it.
- **Page titles** are `text-3xl sm:text-4xl` (not a bare `text-4xl`); the dashboard's "Welcome to {org}" also carries `wrap-break-word` for long single-token org names.
- **Grids/forms** use `md:grid-cols-*` (single column on mobile) — already the norm.
- **Modals** (`CheckInDialog`/`CheckoutDialog`) are `w-full max-w-lg` on a `px-4` backdrop with `max-h-[85vh] overflow-y-auto`; the `QuickCheckInOut` dropdowns are `w-80 max-w-[calc(100vw-1.5rem)]` so they never exceed a narrow viewport.
- One known rough edge (see Phase 2.5): expanding Folio/Guests/History on the Reservations table on a phone renders the panel inside the `min-w-180` table row, so it scrolls horizontally with the table.

## Key Files

### Database
- `database.sql` - Full schema (run once in Supabase SQL editor; new sections are appended, not rewritten in place — **see [Outstanding Manual Steps](#outstanding-manual-steps-run-this-next)**, the last two sections are not confirmed deployed)
  - Tables: `organizations`, `users`, `rooms`, `room_types`, `reservations`, `staff_schedules`, `maintenance_logs`, `audit_logs`, `reservation_charges`, `items`, `reservation_guests`
  - RLS policies for data isolation (org-scoped, not `USING (true)`) — no role-based restrictions
  - Trigger-based: audit logging (reservations + reservation_charges), room status sync (from reservations + from maintenance_logs)
  - Indexes for performance

### Core App Pages
- `app/page.tsx` - Landing page with setup instructions
- `app/login/page.tsx` - Shared login (admin + staff)
- `app/setup/page.tsx` - First-time setup wizard (creates admin login, then org)
- `app/dashboard/layout.tsx` - Auth guard + shared nav for all dashboard pages
- `app/dashboard/page.tsx` - Operations dashboard (room status, today's arrivals/departures, revenue, staff on shift, quick links)
- `app/dashboard/reservations/page.tsx` - Guest booking management + per-row Folio/Guests/History panels
- `app/dashboard/reservations/activity/page.tsx` - Full reservation + folio-charge activity log, with a date-filter calendar
- `app/dashboard/rooms/page.tsx` - Room types + rooms, grouped by type with a status filter; maintenance rooms link to their open issue
- `app/dashboard/housekeeping/page.tsx` - Cleaning queue + maintenance issue tracker
- `app/dashboard/items/page.tsx` - Priced items catalog CRUD
- `app/dashboard/settings/page.tsx` - Hub linking to Items, Activity Log, Staff
- `app/dashboard/staff/page.tsx` - Staff members + scheduling
- `app/api/staff/create/route.ts` - Service-role staff account provisioning

### Components
- `components/DashboardNav.tsx` - Top navigation bar
- `components/QuickCheckInOut.tsx` - Navbar quick check-in/out dropdowns
- `components/CheckInDialog.tsx` - Check-in wizard (occupancy, guest IDs, review)
- `components/CheckoutDialog.tsx` - Check-out wizard (departure date, items, review)
- `components/ReservationFolio.tsx` - Itemized folio panel + print receipt
- `components/ReservationGuests.tsx` - Lead + additional guest ID viewer/editor
- `components/ItemGrid.tsx` - Shared item-catalog picker (qty steppers)
- `components/ActivityCalendar.tsx` - Month-grid date filter for the Activity Log

### Utilities
- `lib/supabase.ts` - Supabase client singleton (anon key, browser)
- `lib/supabaseAdmin.ts` - Service-role client, lazy-loaded, server-only (`app/api/**` only)
- `lib/AuthContext.tsx` - Session/profile React context
- `lib/types.ts` - TypeScript interfaces for all entities
- `lib/formatDate.ts` - `formatIST()` for timestamp display, `todayIST()`/`dateIST()` (YYYY-MM-DD) for comparing/grouping against DATE columns without UTC/local off-by-one bugs

## Outstanding Manual Steps (run this next!)

`database.sql` is appended-to incrementally, and **not every section has been confirmed run against the live Supabase project yet**. If resuming this project in a new session, check this first — the app's code assumes all of it is applied, and things will fail confusingly (missing column errors) otherwise.

**Confirmed deployed** (per explicit user confirmation / a working screenshot during the session that built them): everything through roughly line 656 of `database.sql` — the Phase 2 auth/audit base, the TIMESTAMPTZ fix, the check-in/check-out room-sync trigger, the maintenance/housekeeping room-sync trigger, the itemized folio (`reservation_charges`) + items catalog, and the richer `audit_logs.summary`/`details` columns + `log_reservation_charge_audit()` trigger.

**Not confirmed deployed** — run these two sections (from the comment `-- Fix: status-change activity...` near line 656, through the end of the file) in the Supabase SQL editor before relying on:
1. The room-number-in-details fix to `log_reservation_audit()` (cosmetic only — Checked In/Out entries showing the room number).
2. **The guest occupancy + ID capture migration** — `room_types.extra_guest_fee`, `reservations.guest_count`/`guest_id_type`/`guest_id_number`, the new `reservation_guests` table + RLS, and the matching `log_reservation_audit()` patch. **`CheckInDialog` and `ReservationGuests` will error without this** — it's the last feature built this session and hasn't been exercised against a live database yet.

`database.sql` sections are **not safely re-runnable** as a whole (`ALTER TABLE ... ADD COLUMN` and `CREATE TABLE` aren't idempotent here — no `IF NOT EXISTS`), so don't just re-paste the entire file. Run the specific pending section(s) only, and if something errors because it was already applied, that's the signal it's already done.

## Customization Points

### For Current Client (Boutique Hotel)
Later: Add client-specific features in:
- `/app/clients/[clientSlug]/` - Client-specific pages
- Database: Add `client_customization` table for per-client settings
- Components: Create client-specific component variants

### For Future Clients
- Copy this codebase as template
- Run setup wizard with new org name
- Customize branding (logo, colors, features) per org

## Database Structure (Simplified)

```
organizations (tenants)
  ├── users (staff — id IS auth.users.id)
  ├── rooms (inventory)
  │   └── room_types (classifications, incl. extra_guest_fee)
  ├── reservations (bookings — incl. guest_count, guest_id_type/number)
  │   ├── audit_logs (create/update/delete trail, entity_type-scoped)
  │   ├── reservation_charges (folio: itemized costs, add/remove only)
  │   └── reservation_guests (additional occupants beyond the lead guest)
  ├── items (priced catalog for quick folio charges)
  ├── staff_schedules (shifts)
  └── maintenance_logs (tracking)
```

All foreign keys cascade on delete (except `audit_logs.entity_id`, deliberately unlinked so it survives deletion). All queries include `org_id` filter, enforced by RLS.

## Environment Setup
Required in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```
`SUPABASE_SERVICE_ROLE_KEY` is server-only (no `NEXT_PUBLIC_` prefix) and powers `app/api/staff/create`.

Also required in the Supabase dashboard (Authentication settings):
- "Allow new users to sign up" → **on**
- "Confirm email" → **off** (no email service in Phase 1, so signups must return a session immediately)

See SETUP.md for step-by-step instructions.

## Development Workflow

### Starting Development
```bash
npm run dev
```
Visits `http://localhost:3000`

Note: `.env.local` changes require a dev server restart — Next.js doesn't hot-reload env vars.

### Adding Features
1. Add table/fields to `database.sql` (test in Supabase) — append a new section, don't edit an already-deployed one
2. Update `lib/types.ts` with new TypeScript types
3. Create page in `app/dashboard/feature/page.tsx`
4. Use `supabase.from('table').select()` for queries
5. Include `org_id` filter in all queries (RLS also enforces this, but keep it explicit)

### Testing Multi-Tenancy
1. Create two orgs via `/setup` with two different admin logins
2. Log in as each and verify data isolation (org A can't see org B's data)

### Lint Note
`npx eslint` currently reports a project-wide, pre-existing pattern in nearly every page/component: a `useEffect` calling a `loadData`-style function declared later in the same file (`react-hooks` "accessed before declared") plus two `setState`-in-effect warnings on the price auto-calc logic in `app/dashboard/reservations/page.tsx`. These predate this session's work and are consistent throughout the codebase (not something to "fix" incidentally while touching a file) — `npx tsc --noEmit` is the reliable signal for whether a change actually broke something.

## Known Limitations (Phase 2, honestly assessed)

- ❌ No role-based enforcement — `users.role` is UI-only, not RLS-enforced (see Multi-Tenancy Model above)
- ❌ No password-reset / forgot-password UI
- ❌ No search/filter on the Reservations table (fine at current data volume)
- ❌ No guest self-service booking
- ❌ No payment processing
- ❌ No integrations (OTA, email, SMS)
- ❌ No occupancy/ADR/RevPAR reporting — dashboard shows raw revenue only, and that figure doesn't include folio charges
- ❌ No guest profiles / repeat-guest recognition — every reservation stores a fresh `guest_name`/`email`/`phone`, no persistent guest entity across stays
- ❌ No visual room/date availability chart ("tape chart") — staff infer availability from the reservations table + the booking wizard's overlap check
- ❌ No mobile app
- ❌ No client-specific customization yet
- ❌ Every page loads its full table contents client-side with no pagination/date filtering (`.select('*').eq('org_id', orgId)` everywhere) — deliberately deferred (few clients right now), but the first thing to fix if that changes, especially the Activity Log and Reservations pages
- ❌ Folio surcharges/credits are computed once at wizard-confirm time, not kept in sync if `guest_count` or dates are edited afterward
- ❌ No shared/global client state — an action from one component (e.g. navbar quick check-in) doesn't refresh another already-rendered page's data

## Next Phases

### Phase 2: Polish & Client Customization — essentially complete
- [x] Auth (email/password, hotel admin + staff)
- [x] Reservation audit trail (extended to folio charges too)
- [x] Check-in/check-out workflows
- [x] Housekeeping task management
- [x] Maintenance tracking UI
- [x] Advanced room status history (activity log summary/details + calendar filter)

### Phase 2.5 candidates (raised, not yet built)
- [ ] Guest profiles / repeat-guest recognition
- [ ] Occupancy/ADR/RevPAR dashboard KPIs (and make revenue figures include folio charges)
- [ ] Visual room/date availability chart
- [ ] Role-based RLS enforcement
- [ ] Password-reset flow
- [ ] Reservation search/filter
- [ ] Reservations mobile card layout — below `md`, render the reservations list (and its Folio/Guests/History expanders) as stacked cards instead of the horizontally-scrolling table, so phone users don't side-scroll a 7-column table + wide expand panels

### Phase 3: Public Features
- [ ] Guest booking portal
- [ ] Email/SMS notifications
- [ ] Payment gateway (Stripe)
- [ ] Basic analytics

### Phase 4: Advanced
- [ ] OTA integrations
- [ ] Mobile apps (React Native)
- [ ] Advanced reporting
- [ ] Client-specific feature flags

## Code Guidelines

### Components
- Keep components simple and focused
- Use TypeScript for all new files
- Reuse DashboardNav for consistent header
- Dark theme only — no light mode variants needed on new components
- Prefer a small amount of accepted duplication (e.g. each wizard/page has its own `nightsBetween`/`loadData` helper) over premature shared abstractions — this matches the codebase's existing style; don't extract a "shared utils" file for something used in only two places

### Pages
- Use 'use client' at top for client-side features
- Always filter by `org_id` from localStorage
- Handle loading/error states
- Server-only secrets (service role key) only ever used inside `app/api/**` route handlers, never imported into a client component

### Database
- Use Supabase client from `lib/supabase.ts`
- Always include `org_id` in queries
- Use `.select('*')` not `.*` in queries
- Timestamp columns should be `TIMESTAMPTZ`, never bare `TIMESTAMP`
- Business logic that must hold **regardless of code path** (audit logging, room status sync) belongs in a trigger; logic tied to **one specific user action** (surcharge/credit calculation in the check-in/checkout wizards) belongs in that wizard's own client code — don't conflate the two patterns

## Common Tasks

**Add a new feature:**
1. Design in `lib/types.ts`
2. Add table schema to `database.sql`
3. Run SQL in Supabase
4. Create page in `app/dashboard/feature/page.tsx`
5. Add navigation link in `components/DashboardNav.tsx` (or `/dashboard/settings` if it's a less-frequently-used admin feature)

**Fix a bug:**
1. Reproduce with specific org_id
2. Check browser console for errors
3. Verify Supabase tables exist (see Outstanding Manual Steps above — this is the most likely cause of a "column does not exist" error right now)
4. Check org_id filter is applied

**Deploy:**
1. Push to GitHub
2. Vercel auto-deploys from main
3. Set env vars in Vercel dashboard (including `SUPABASE_SERVICE_ROLE_KEY`)
4. Test database connection

## Useful Supabase URLs
- Docs: https://supabase.com/docs
- SQL Editor: Project Dashboard → SQL Editor
- Table Browser: Project Dashboard → Tables
- API Docs: Project Dashboard → API Docs

## Git Strategy
- Commit often with descriptive messages
- Branch for new features (feature/name)
- Keep `main` deployable
- Don't commit `.env.local` (use .env.local.example)

---

**Last Updated**: 2026-07-03 (content), session work through mobile/responsive pass (hamburger nav + viewport-safe tables/headers/modals)
**Maintained By**: Primary developer + 1 co-developer
