# Suitely - Project Context

## Project Overview
**Suitely** is a **Next.js + Supabase** hotel management system designed for:
- **Multi-tenant SaaS**: Same codebase serves multiple hotels via shared database with tenant isolation
- **Generic template**: Customizable for specific clients later
- **Lean startup**: Free tier technology stack, single developer (primary) + 1 co-developer

**Current scope**: Phase 2 is essentially complete — real auth/audit trail, full check-in/check-out workflows, housekeeping & maintenance, an itemized folio with a priced items catalog, occupancy/guest-ID capture, and a richer activity log. A follow-up UX polish pass added: **per-org currency** (each hotel picks its display currency), **reservation search + status filter**, a **styled confirm/alert dialog** (replacing native `window.confirm`/`alert`), a **lucide-react icon set** (replacing decorative emoji), and a **mobile card layout** for the Reservations list. All of `database.sql` is confirmed deployed against the live Supabase project (see [Outstanding Manual Steps](#outstanding-manual-steps) — nothing currently pending).

## Tech Stack
- **Framework**: Next.js 16+ (App Router)
- **Database**: Supabase (PostgreSQL + Auth + Realtime — Realtime is available but not yet used)
- **Frontend**: React 19, TypeScript, Tailwind CSS 4, Framer Motion (subtle transitions), lucide-react (icons)
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

### Payments (folio settlement) — Billing Phase A
- **`payments`**: money actually received against a reservation — the counterpart to the folio's "owed" side. Amount **owed** is `total_price + SUM(reservation_charges.amount)`; amount **paid** is `SUM(payments.amount)`; **balance due** is owed − paid. Columns: `amount`, `method` (`cash`/`card`/`upi`/`bank_transfer`/`other` — a UI option list, not a DB enum), `note`, `paid_at`. **Add/remove only** (no UPDATE policy), mirroring `reservation_charges`; a **refund is a negative-amount row** (same convention as a discount being a negative charge), not a separate entity.
- **Audit**: `log_payment_audit()` trigger (INSERT/DELETE) logs `entity_type = 'payment'` against the **reservation's** id (like `log_reservation_charge_audit()`), so payments interleave in the per-row History expander and the Activity Log. Summaries: `Payment Received`/`Payment Removed`/`Refund Issued`/`Refund Removed`. The History expander and `/activity` queries widened to `entity_type IN ('reservation','reservation_charge','payment')`.
- **Surfaced in the UI**:
  - `components/ReservationFolio.tsx` — under Total it lists each payment (removable) plus a **Balance Due** line (amber when > 0, emerald "Settled" when ≤ 0), and a **"+ Record Payment"** form (amount/method/note). The print receipt gained payment lines + a Balance Due total.
  - `components/CheckoutDialog.tsx` — the Review step has optional payment capture (amount + method, "Pay full total" shortcut). **Note**: its total reflects only *this stay's* room + credit + items being added now — it does **not** load prior charges/deposits, so the field is intentionally not pre-filled with a computed full balance; the Folio panel is the source of truth for the real balance.
  - New-reservation wizard (`app/dashboard/reservations/page.tsx`, Guest Details step) — an **optional booking deposit** (amount + method), written as a `payments` row (`note: 'Booking deposit'`) after the reservation inserts. The reservation insert now uses `.select('id').single()` to get the id for that follow-up write; the deposit write is non-fatal (booking already exists if it fails).
- Non-atomic, consistent with the app's sequential-Supabase-call style. Neither the checkout payment nor the booking deposit is kept in sync if amounts are edited later — correct via the Folio's record/remove. See `BILLING_PLAN.md` for the full billing roadmap (deferred Phase C tax, Phase D reporting).

### Invoices (immutable records) — Billing Phase B
- **`invoices`**: a formal billing document, issued **manually** from the folio (deliberate staff action — no auto-issue on checkout). At issue time the current folio state is **frozen** into `snapshot` JSONB (header: guest/room/dates; `lines` = room charge + each folio charge; `subtotal`/`tax_total`/`total`; `amount_paid`/`balance_due`; **and the org's currency code**). Editing or deleting the underlying reservation/charges/payments afterward does **not** change an issued invoice — same immutability philosophy as `audit_logs` and the no-FK `items`→`reservation_charges` design. `status` is `issued` (or `paid` if the balance was already ≤ 0 at issue) / `void`. **No DELETE** — a mistake is **voided** (a `status` update), so numbers are never reused and the record survives; `invoices` has view/insert/update RLS but no delete policy.
- **Date-based numbers**: `INV-YYYY-MM-NNNN` (e.g. `INV-2026-07-0001`), sequential per org **per calendar month**, computed in **IST** (matches `formatIST`/`dateIST`). Allocation is the **one** place the app deviates from its "sequential non-atomic Supabase calls" style — it must be race-safe, so it goes through the `next_invoice_number(p_org)` **`SECURITY DEFINER`** Postgres function over an `invoice_counters` table (`(org_id, period)` PK) with an atomic `ON CONFLICT DO UPDATE ... RETURNING`. `UNIQUE(org_id, invoice_number)` on `invoices` is the backstop. Called from the client via `supabase.rpc('next_invoice_number', { p_org: orgId })`. `invoice_counters` has RLS enabled with **no policies** — only the definer function (running as owner) touches it.
- **Printing** goes through **`lib/printInvoice.ts`** (`printInvoice(invoice)`), shared by the folio panel and the invoices list. It renders entirely from the **snapshot** (never live data) and formats amounts in the **snapshot's frozen currency** via `formatMoney(n, { currency })` — so a re-print of an old invoice always matches what the guest originally received, even after a later folio or org-currency change. Voided invoices print with a diagonal "VOID" watermark. (`formatMoney` gained an optional `{ currency }` override for exactly this; everyday callers still read the active org currency from localStorage.)
- **Surfaced in the UI**:
  - `components/ReservationFolio.tsx` — an **"Issue Invoice"** action (alongside Add Charge / Record Payment) allocates the number + writes the snapshot; issued invoices list under the folio with **Print** and **Void** (Void uses `useConfirm`, `danger`).
  - **`app/dashboard/invoices/page.tsx`** — org-wide invoice list (number, guest, stay, issued, total, balance, status) with a search box + status filter tabs, following the `overflow-x-auto` card + `min-w-*` table convention. Linked from `/dashboard/settings` (hub), not top-level nav. "Print" per row via the same shared helper.
- This is still tax-free (`tax_total` is always 0) until **Billing Phase C** wires up a configurable rate; the `tax_total` column + snapshot field already reserve the slot so historical invoices keep their original figures when it lands.

### Currency (per-org)
- Each hotel picks its own display currency, stored on `organizations.currency` (a code like `USD`/`INR`/`EUR`; defaults to `USD`). This is **display/formatting only** — all amounts are still stored as plain `DECIMAL`s; changing the currency never rewrites stored values.
- **`lib/currency.ts`** is the single source of truth: a `CURRENCIES` map (code → label/symbol/locale) and `formatMoney(amount, { decimals })` used **everywhere** a price renders (Dashboard, Reservations, Rooms, Items, Folio, both wizards, ItemGrid). It replaced ~10 ad-hoc `` `$${n.toFixed(2)}` `` helpers scattered across those files — don't reintroduce inline `$` formatting. `formatMoney` handles negatives (`-$50.00`, used by folio discounts/credits) and adds thousands-grouping per the currency's locale.
- **How the code reaches every component**: mirrored into `localStorage` (`currency` key) at login by `lib/AuthContext.tsx`, exactly like `orgId` — so `formatMoney` reads it synchronously without threading the org through props. Set at signup by the `/setup` wizard, changeable anytime from `/dashboard/settings` (which also updates localStorage so the change takes effect without a re-login). Falls back to `USD` if unset. `signOut()` clears it alongside `orgId`.
- **Deliberately not per-user or per-reservation** — currency is an org-level setting; there's no historical currency captured on individual charges (a hotel changing currency is expected to be rare/one-time). The `$` literals baked into old `audit_logs` detail strings are historical text and left as-is.

### Confirm / Alert Dialogs
- **`lib/ConfirmDialog.tsx`** is a dark-themed, promise-based replacement for the browser's native `window.confirm`/`window.alert`. `ConfirmProvider` is mounted once in `app/dashboard/layout.tsx`; any dashboard page calls `const { confirm, alert } = useConfirm()` and awaits it: `if (!(await confirm({ title, message, confirmLabel, danger }))) return`.
- Replaced every native dialog in the dashboard (delete reservation/room/room-type/maintenance-issue/item, and the reservation delete-error alert). `danger: true` renders a red confirm button for destructive actions. New destructive actions should use this, not `window.confirm`.

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
- **Revenue snapshot** (three cards, Billing Phase D): (1) this month's revenue from non-cancelled reservations whose `check_in_date` falls in the current IST month; (2) "upcoming confirmed revenue" for future `confirmed` bookings not yet checked in; (3) **Outstanding Balance** — money still owed across active reservations. All three now include **folio charges**, not just `total_price`: the dashboard loads `reservation_charges` + `payments` for the org and computes `folioTotal(r) = total_price + Σ charges`; revenue uses `folioTotal`, and outstanding = `Σ max(0, folioTotal − payments)` (only reservations with a positive balance — an overpaid/deposit-heavy booking is a credit, not a receivable). This closes the former "revenue ignores folio charges" gap. Still no ADR/RevPAR/occupancy KPIs.
- **Staff on shift today**: `staff_schedules` rows where `shift_date` equals `todayIST()`, joined against `users` for names.
- **Quick Actions**: links to Reservations, Rooms, Housekeeping, Items, and Staff (icons via lucide-react).
- Prices everywhere go through `formatMoney` from `lib/currency.ts` (the org's configured currency) — don't hardcode a `$` prefix or a one-off format on any page. The dashboard's revenue figures use `formatMoney(n, { decimals: 0 })` for whole-currency display.

### Rooms Page Organization
`app/dashboard/rooms/page.tsx` groups the Rooms section by room type (section header per `room_types` row, rooms sorted numerically by `room_number` within each), with a status filter tab row (All/Available/Occupied/Cleaning/Maintenance, each showing a live count) above it. Rooms whose `room_type_id` doesn't match any current room type render under an "Other Rooms" fallback group rather than being hidden. Room types now also carry `extra_guest_fee` (per-night surcharge rate) alongside `base_price`/`max_guests`/`description`.

### Reservations Page Organization
`app/dashboard/reservations/page.tsx` has a **search box** (matches guest name, email, or room number) and a **status filter tab row** (All / Confirmed / Checked in / Checked out / Cancelled, each with a live count) above the list. Both filter the already-loaded `reservations` array client-side into `filteredReservations` (fine at current volume — revisit with pagination if an org grows to thousands). A filtered-to-empty result shows its own "No reservations match…" message, distinct from the "No reservations yet" empty state.
- **Two layouts, one data path**: a desktop `<table>` (`hidden md:block`, still `overflow-x-auto` + `min-w-180`) and a **mobile stacked-card list** (`md:hidden`) below the `md` breakpoint. The per-row action buttons and the active expand panel (Folio/Guests/History) are rendered by two shared in-component helpers — `renderActions(res)` and `renderPanel(res)` — reused by both layouts so they can't drift. Add new row actions/panels in those helpers, not inline in one layout.

### Navigation
Top nav (`components/DashboardNav.tsx`): **Dashboard · Reservations · Rooms · Housekeeping · Settings**, plus the `QuickCheckInOut` dropdowns and the profile/logout section. `/dashboard/settings` is a hub page linking to **Items**, **Invoices**, **Activity Log**, and **Staff** — these were top-level nav tabs originally, moved out to declutter the primary nav (per explicit request). Items, Invoices, and Staff pages each have a "← Back to Settings" link; Activity Log kept its pre-existing "← Back to Reservations" link since that's still its more useful context.

**Mobile nav**: below the `md` breakpoint (768px) the inline links + user/logout collapse into a hamburger drawer (`NAV_LINKS` array drives both the desktop row and the drawer so they can't drift), while `QuickCheckInOut` stays in the top bar — Check In/Out are the highest-frequency front-desk actions and their count badges need to stay one tap away.

### Responsive / Mobile
The whole dashboard is expected to hold the viewport on any device (verified down to phone widths). Conventions used throughout, worth matching on new pages:
- **Data tables** (`activity`, `staff`, `items`) live in an `overflow-x-auto` card with a `min-w-*` on the `<table>` — they scroll horizontally within their card rather than pushing the page wider than the screen. Don't wrap a wide table in `overflow-hidden` (clips the Actions column instead of letting it scroll). The **Reservations** page goes further: its table is desktop-only (`hidden md:block`) and switches to a stacked-card layout on mobile (see Reservations Page Organization) — the model to follow if `activity`/`staff`/`items` ever outgrow horizontal scroll on phones.
- **Page/section header toolbars** that pair a heading with an action button use `flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center` so the button drops below the title on mobile instead of colliding with it.
- **Page titles** are `text-3xl sm:text-4xl` (not a bare `text-4xl`); the dashboard's "Welcome to {org}" also carries `wrap-break-word` for long single-token org names.
- **Grids/forms** use `md:grid-cols-*` (single column on mobile) — already the norm.
- **Modals** (`CheckInDialog`/`CheckoutDialog`, and the `ConfirmDialog`) are `w-full max-w-lg`/`max-w-sm` on a `px-4` backdrop with `max-h-[85vh] overflow-y-auto`; the `QuickCheckInOut` dropdowns are `w-80 max-w-[calc(100vw-1.5rem)]` so they never exceed a narrow viewport.
- The old rough edge (Folio/Guests/History expanders side-scrolling inside the Reservations table on a phone) is **resolved** — the mobile card layout renders those panels full-width inside each card.

## Key Files

### Database
- `database.sql` - Full schema (run once in Supabase SQL editor; new sections are appended, not rewritten in place). All sections confirmed deployed — see [Outstanding Manual Steps](#outstanding-manual-steps) (nothing currently pending)
  - Tables: `organizations`, `users`, `rooms`, `room_types`, `reservations`, `staff_schedules`, `maintenance_logs`, `audit_logs`, `reservation_charges`, `items`, `reservation_guests`, `payments`, `invoices`, `invoice_counters`
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
- `app/dashboard/invoices/page.tsx` - Issued-invoice list (search + status filter, per-row print)
- `app/dashboard/settings/page.tsx` - Hub linking to Items, Invoices, Activity Log, Staff; also hosts the org **display-currency** picker
- `app/dashboard/staff/page.tsx` - Staff members + scheduling
- `app/api/staff/create/route.ts` - Service-role staff account provisioning

### Components
- `components/DashboardNav.tsx` - Top navigation bar
- `components/QuickCheckInOut.tsx` - Navbar quick check-in/out dropdowns
- `components/CheckInDialog.tsx` - Check-in wizard (occupancy, guest IDs, review)
- `components/CheckoutDialog.tsx` - Check-out wizard (departure date, items, review)
- `components/ReservationFolio.tsx` - Itemized folio panel (charges + payments/balance) + print receipt + issue/void invoices
- `components/ReservationGuests.tsx` - Lead + additional guest ID viewer/editor
- `components/ItemGrid.tsx` - Shared item-catalog picker (qty steppers)
- `components/ActivityCalendar.tsx` - Month-grid date filter for the Activity Log

### Utilities
- `lib/supabase.ts` - Supabase client singleton (anon key, browser)
- `lib/supabaseAdmin.ts` - Service-role client, lazy-loaded, server-only (`app/api/**` only)
- `lib/AuthContext.tsx` - Session/profile React context (also mirrors `orgId` + `currency` into localStorage at login)
- `lib/ConfirmDialog.tsx` - `ConfirmProvider` + `useConfirm()` — promise-based dark-themed confirm/alert (mounted in the dashboard layout)
- `lib/currency.ts` - `CURRENCIES` map + `formatMoney()` (optional `{ currency }` override for printing invoices in their frozen code); the single money-formatting helper for the whole app (per-org currency)
- `lib/printInvoice.ts` - `printInvoice(invoice)` — renders an invoice's frozen snapshot to a print window (shared by folio + invoices list)
- `lib/types.ts` - TypeScript interfaces for all entities (`Organization` carries `currency`; `Payment`, `Invoice`/`InvoiceSnapshot` for billing)
- `lib/formatDate.ts` - `formatIST()` for timestamp display, `todayIST()`/`dateIST()` (YYYY-MM-DD) for comparing/grouping against DATE columns without UTC/local off-by-one bugs

## Outstanding Manual Steps

**Nothing pending.** As of the latest session, the entire `database.sql` file — including the guest occupancy + ID capture migration and the per-org `organizations.currency` column (the final appended section) — is confirmed deployed against the live Supabase project.

When you **add** a new migration in a future session, remember the pattern that has held throughout: `database.sql` is appended-to incrementally and is **not safely re-runnable** as a whole (`ALTER TABLE ... ADD COLUMN` / `CREATE TABLE` aren't idempotent here — no `IF NOT EXISTS`). Run only the new section in the Supabase SQL editor; if it errors because it was already applied, that's the signal it's already done. Symptom of a forgotten migration is a confusing "column does not exist" error in the browser console.

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
organizations (tenants — incl. currency)
  ├── users (staff — id IS auth.users.id)
  ├── rooms (inventory)
  │   └── room_types (classifications, incl. extra_guest_fee)
  ├── reservations (bookings — incl. guest_count, guest_id_type/number)
  │   ├── audit_logs (create/update/delete trail, entity_type-scoped)
  │   ├── reservation_charges (folio: itemized costs, add/remove only)
  │   ├── reservation_guests (additional occupants beyond the lead guest)
  │   ├── payments (money received; add/remove only, negative = refund)
  │   └── invoices (immutable issued documents; snapshot JSONB, void not delete)
  ├── items (priced catalog for quick folio charges)
  ├── staff_schedules (shifts)
  ├── maintenance_logs (tracking)
  └── invoice_counters (per-(org, month) sequence for invoice numbers)
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
- ❌ No guest self-service booking
- ❌ No payment processing
- ❌ No integrations (OTA, email, SMS)
- ❌ No occupancy/ADR/RevPAR reporting — dashboard shows revenue + outstanding balance (now folio-inclusive, Billing Phase D) but no ADR/RevPAR/occupancy KPIs
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

### Phase 2.5 — done this session
- [x] Reservation search/filter (search box + status filter tabs)
- [x] Reservations mobile card layout (stacked cards below `md`)
- [x] Per-org currency setting
- [x] Styled confirm/alert dialog (replaced native `window.confirm`/`alert`)
- [x] lucide-react icon set (replaced decorative emoji)

### Phase 2.5 candidates (raised, not yet built)
- [ ] Guest profiles / repeat-guest recognition
- [ ] Occupancy/ADR/RevPAR dashboard KPIs (revenue figures already include folio charges + an outstanding-balance card, Billing Phase D)
- [ ] Visual room/date availability chart
- [ ] Role-based RLS enforcement
- [ ] Password-reset flow

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
3. Verify Supabase tables/columns exist (a "column does not exist" error means a `database.sql` section wasn't run — see Outstanding Manual Steps; currently nothing is pending, but this is the usual cause when it happens)
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

**Last Updated**: 2026-07-03 (content), UX polish pass — per-org currency (`lib/currency.ts`), reservation search/filter, styled confirm/alert dialog (`lib/ConfirmDialog.tsx`), lucide-react icons, and the Reservations mobile card layout. All `database.sql` migrations confirmed deployed.
**Maintained By**: Primary developer + 1 co-developer
