# 🛎️ Suitely

A modern, open-source hotel management system built with **Next.js** and **Supabase**.

Manage reservations, check-in/check-out, housekeeping, guest folios, and staff schedules for boutique hotels and larger properties.

## Features ✨

- **📅 Reservation Management** - Create, search/filter, and manage guest bookings via a step-by-step booking wizard, plus a focused per-booking **detail page** (`/dashboard/reservations/[id]`) with Folio / Guests / History tabs
- **✅ Check-In / Check-Out Workflows** - Multi-step wizards from every entry point (Reservations, Dashboard, or the navbar): occupancy + optional guest ID capture at check-in (with an automatic over-capacity surcharge), and departure date + item charges + early-checkout credit at check-out
- **🧾 Itemized Guest Folios** - Room charge plus itemized incidentals (minibar, damage, discounts) from a staff-managed items catalog, with a one-click printable receipt
- **💳 Billing** - Record **payments** (and refunds) against a folio with a live Balance Due / Refund Due, and issue **immutable, numbered invoices** (frozen snapshot, void-not-delete) with their own list page and print
- **💱 Per-Org Currency** - Each hotel picks its own display currency; a single `formatMoney` helper formats every price
- **🧹 Housekeeping & Maintenance** - A cleaning queue for turning rooms around after checkout, and a maintenance issue tracker that automatically takes a room out of service and hands it back
- **🏠 Room Management** - Track room types (incl. per-night extra-guest fees), availability, and status
- **👥 Staff Management** - Add/**edit/delete** team members and shift schedules (real per-member logins), plus **attendance** (daily roll call + log), **leave requests** (staff self-request, manager approve/reject), and **compensation & payroll** (append-only pay rates, draft→finalized→paid runs with immutable payslip snapshots and print)
- **📈 Accounts / Financials** *(managers/admins)* - A real **profit & loss** section (`/dashboard/accounts`): categorized revenue (accrual, matching the dashboard) and expenses (operating costs + auto-derived payroll), net profit/loss, **weekly/monthly charts**, and a **printable financial statement**
- **🔐 Real Auth + Role-Based Access** - Supabase Auth logins for hotel admins and staff, with **DB-enforced (RLS) roles**: admin / manager / staff each get a different write scope
- **🕵️ Shared-Terminal Accountability** - On a shared front-desk login, booking / check-in / check-out / payment / invoice each require the acting staffer to confirm their **password**, attributing the action to the real person in the audit trail
- **📜 Rich Audit Trail** - Every reservation, folio-charge, and payment change is logged with a human-readable description (who, what, when) — survives even after the record is deleted, with a calendar-based date filter
- **⚡ Live Data Sync** - Supabase Realtime keeps every open page/tab current — a booking or check-in made on one screen shows up on the others without a reload
- **📱 Installable PWA** - Add-to-home-screen support with an offline fallback (service worker; caching is production-only, self-disabling on localhost)
- **📊 Dashboard** - Front-desk operations board: occupancy glance strip, actionable arrivals/departures, staff on shift, a staff attendance & pay glance, and a manager-only financials section (folio-inclusive revenue + outstanding balance)
- **🔒 Multi-Tenant** - Support multiple hotels with one codebase, isolated via Row-Level Security
- **🌙 Dark Mode** - Dark theme throughout, with subtle animations and a styled confirm/alert dialog

## Quick Start 🚀

### Prerequisites
- Node.js 18+
- Supabase account (free tier available at [supabase.com](https://supabase.com))

### Installation

1. **Clone & Install**
```bash
npm install
```

2. **Set Up Supabase**
   - Create a free account at [supabase.com](https://supabase.com)
   - Create a new project
   - Copy Project URL, Anon Key, and **service role key** from Settings → API
   - In Authentication settings: turn **on** "Allow new users to sign up" and turn **off** "Confirm email" (Phase 1 has no email service)

3. **Configure Environment**
   - Copy `.env.local.example` to `.env.local`
   - Add your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

4. **Initialize Database**
   - Go to Supabase SQL Editor
   - Create new query
   - Copy all content from `database.sql` and run it. The file is **self-contained and re-runnable** — it drops and recreates every table, so running the whole thing gives you a clean schema with role-based RLS. ⚠ That reset is **destructive** (wipes all app data); it does not touch Supabase Auth accounts (`auth.users`).
   - **Enable Realtime**: Database → **Publications** → add the app tables to `supabase_realtime` (needed for live sync). The schema already sets `REPLICA IDENTITY FULL` on those tables so updates/deletes propagate too.

5. **Enable the setup wizard** (first run only)
   - The public `/setup` wizard is gated behind an env flag so it can't be left open in production. Set `NEXT_PUBLIC_SETUP_ENABLED=true` in `.env.local` to use it, then flip it back to `false` once your hotel exists. (Restart the dev server after changing it — env vars don't hot-reload.)

6. **Start Development**
```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000), then go to `/setup` to create your hotel admin login and first hotel.

## Documentation 📚

- **[SETUP.md](SETUP.md)** - Step-by-step setup instructions
- **[USER_GUIDE.md](USER_GUIDE.md)** - How to use every feature
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues & solutions
- **[CLAUDE.md](CLAUDE.md)** - Architecture & development guide

## Tech Stack 🛠️

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Framer Motion, lucide-react
- **Backend**: Supabase (PostgreSQL + Realtime), REST API
- **Auth**: Supabase Auth (email/password) — shared login for hotel admins and staff, role-based RLS
- **PWA**: Installable with an offline fallback (hand-rolled service worker, production only)
- **Hosting**: Vercel (recommended)

## Project Structure

```
├── app/                          # Next.js pages
│   ├── dashboard/                 # Main app pages (auth-guarded layout)
│   │   ├── reservations/          # List (search/filter) + New/Edit wizards
│   │   │   ├── [id]/              # Per-booking detail (Folio/Guests/History tabs)
│   │   │   └── activity/          # Audit/activity log + date-filter calendar
│   │   ├── rooms/                 # Room types + rooms
│   │   ├── housekeeping/          # Cleaning queue + maintenance tracker
│   │   ├── items/                 # Priced items catalog
│   │   ├── invoices/              # Issued-invoice list (search + status filter)
│   │   ├── accounts/              # Accounts / P&L (revenue, expenses, charts, statement)
│   │   ├── payroll/               # Compensation rates + payroll runs
│   │   ├── settings/              # Hub: Accounts/Items/Invoices/Activity Log/Staff/Payroll + currency
│   │   └── staff/                 # Staff + schedules + attendance + leave requests
│   ├── login/                     # Shared login (admin + staff)
│   ├── setup/                     # Initial setup wizard (env-flag gated)
│   ├── api/staff/create/          # Service-role staff provisioning
│   ├── api/confirm-identity/      # Shared-terminal password verification + attribution
│   └── page.tsx                   # Landing page
├── components/                   # Reusable React components
│   ├── DashboardNav.tsx           # Top navigation bar
│   ├── QuickCheckInOut.tsx        # Navbar check-in/out dropdowns
│   ├── CheckInDialog.tsx          # Check-in wizard
│   ├── CheckoutDialog.tsx         # Check-out wizard
│   ├── ReservationFolio.tsx       # Folio + payments/balance + issue/void invoice + print
│   ├── ReservationGuests.tsx      # Guest ID viewer/editor
│   ├── ItemGrid.tsx               # Shared item-catalog picker
│   ├── ActivityCalendar.tsx       # Month-grid activity date filter
│   └── ServiceWorkerRegister.tsx  # PWA service worker (production only)
├── lib/
│   ├── supabase.ts                # Browser client + getFreshAccessToken()
│   ├── supabaseAdmin.ts           # Server-only service-role client
│   ├── AuthContext.tsx            # Session/profile context (+ localStorage mirror)
│   ├── ConfirmDialog.tsx          # Promise-based confirm/alert dialog
│   ├── IdentityConfirm.tsx        # Shared-terminal identity gate (password confirm)
│   ├── useRealtimeRefresh.ts      # Supabase Realtime refetch hook
│   ├── currency.ts                # Per-org currency + formatMoney
│   ├── accounts.ts                # P&L math (revenue/expense/statement/trend)
│   ├── payroll.ts                 # Pay-computation formula (shared)
│   ├── printInvoice.ts            # Snapshot-driven invoice print
│   ├── printPayslip.ts            # Snapshot-driven payslip print
│   ├── printStatement.ts          # On-demand P&L statement print
│   ├── formatDate.ts              # IST timestamp formatting
│   └── types.ts                   # TypeScript definitions
├── database.sql                  # Full schema (clean, re-runnable, role-based RLS)
├── migrations/                   # Standalone additive migrations for a live DB
└── public/
    ├── sw.js                      # PWA service worker (self-destructs on localhost)
    └── ...                        # Static assets
```

## Usage Example

### Create a Reservation

```typescript
import { supabase } from '@/lib/supabase'

const orgId = localStorage.getItem('orgId')

await supabase
  .from('reservations')
  .insert([{
    org_id: orgId,
    room_id: '...',
    guest_name: 'John Doe',
    guest_email: '',          // optional
    check_in_date: '2026-07-15',
    check_out_date: '2026-07-18',
    total_price: 300,
    status: 'confirmed'
  }])
```

Creating this reservation while signed in is automatically recorded in the audit trail (via a database trigger) — no extra code required. See [CLAUDE.md](CLAUDE.md) for more examples.

## Roadmap 🗺️

### Phase 1 ✅ (Complete)
- ✅ Multi-tenant architecture
- ✅ Room & reservation management
- ✅ Staff & scheduling
- ✅ Basic dashboard

### Phase 2 ✅ (Complete)
- ✅ Real auth (hotel admin + staff logins)
- ✅ Reservation + folio + payment audit trail
- ✅ Check-in/check-out workflows (with occupancy surcharge & guest ID capture)
- ✅ Itemized guest folios + items catalog
- ✅ Housekeeping task management
- ✅ Maintenance tracking

### Phase 2.5 ✅ (Complete)
- ✅ Reservation search/filter + mobile card layout
- ✅ Per-org currency
- ✅ Styled confirm/alert dialog, lucide-react icons
- ✅ Billing: payments + immutable invoices (Stripe not integrated — this is manual record-keeping)
- ✅ Reservations list + per-booking detail page
- ✅ Live data sync (Supabase Realtime)
- ✅ Installable PWA
- ✅ **Role-based permission enforcement (RLS)** — admin / manager / staff
- ✅ **Shared-terminal identity confirmation** on the 5 accountable actions

### Advanced Staff Management ✅ (Complete)
- ✅ Attendance (daily roll call + log)
- ✅ Leave requests (staff self-request; manager approve/reject)
- ✅ Compensation & payroll (append-only rates, draft→finalized→paid runs, immutable payslips)

### Accounts / Financials ✅ (Complete)
- ✅ `expenses` table + P&L page (`/dashboard/accounts`, managers/admins)
- ✅ Accrual revenue + cash-received/outstanding; auto-derived payroll expense
- ✅ Weekly/monthly charts + printable financial statement

### Still Raised (not yet built)
- [ ] Guest profiles / repeat-guest recognition
- [ ] Occupancy/ADR/RevPAR reporting (revenue, outstanding balance, and a P&L exist; no ADR/RevPAR)
- [ ] Visual room/date availability chart ("tape chart")
- [ ] Password-reset / forgot-password flow
- [ ] Configurable tax rate (billing Phase C — slot reserved on invoices)
- [ ] Edit/delete a finalized payslip (immutable by design today — deferred)

### Phase 3 (Future)
- [ ] Guest self-service booking
- [ ] Email/SMS notifications
- [ ] Payment **processing** / gateway (Stripe)
- [ ] OTA integrations (Booking.com, Airbnb)
- [ ] Advanced reporting & analytics
- [ ] Native mobile app (React Native)

## Deployment 🌐

### Deploy to Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Set environment variables in Vercel dashboard (including `SUPABASE_SERVICE_ROLE_KEY`, kept server-only)
4. Deploy!

**Free tier:**
- Vercel: 100GB bandwidth/month
- Supabase: 500MB database, 2GB bandwidth/month

### Other Hosting Options
- Netlify
- AWS Amplify
- Self-hosted on any VPS

## Database Schema

| Table | Purpose |
|-------|---------|
| `organizations` | Hotel info (tenants), incl. display currency |
| `users` | Staff members (real Supabase Auth logins), incl. role |
| `rooms` | Physical rooms |
| `room_types` | Room classifications, incl. per-night extra-guest fee |
| `reservations` | Guest bookings, incl. occupancy count and lead guest ID |
| `reservation_charges` | Itemized folio charges (services, discounts, surcharges) |
| `reservation_guests` | Additional occupants beyond the lead guest, with ID |
| `payments` | Money received against a reservation (negative = refund) |
| `invoices` | Immutable issued invoices (frozen snapshot, void-not-delete) |
| `invoice_counters` | Per-(org, month) sequence backing race-safe invoice numbers |
| `items` | Staff-managed priced catalog for quick folio charges |
| `audit_logs` | Create/update/delete + identity-confirm trail (reservations, folio, payments, staff) |
| `staff_schedules` | Work shifts |
| `attendance_logs` | Daily attendance (present/absent/late/half-day/on-leave; manager-write) |
| `leave_requests` | Staff leave requests (self-request; manager approve/reject) |
| `staff_compensation` | Append-only pay-rate history (reads restricted to self + manager) |
| `payroll_runs` | Payroll runs, draft→finalized→paid, immutable snapshot (reads restricted) |
| `payroll_run_adjustments` | Bonus/deduction lines on a draft run |
| `expenses` | Operating expenses for the Accounts P&L (reads restricted to manager/admin) |
| `maintenance_logs` | Maintenance tracking |

All tables include Row-Level Security scoped to the authenticated user's organization. Writes are additionally **role-scoped** (admin / manager / staff) — reads stay open to any org member. See [CLAUDE.md](CLAUDE.md#multi-tenancy-model) for the full permission matrix.

## Troubleshooting

**Having issues?** Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for:
- Setup errors
- Display issues
- Data problems
- Database issues

## Contributing

Contributions are welcome! Areas for improvement:
- Guest portal
- Payment integration
- Advanced reporting
- Mobile app

## License

MIT - Feel free to use this for your projects!

## Support

- 📖 See [USER_GUIDE.md](USER_GUIDE.md) for feature questions
- 🔧 See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues
- 👨‍💻 See [CLAUDE.md](CLAUDE.md) for development questions

## Credits

Built with ❤️ as a modern, open-source hotel management solution.

---

**Getting started?** 👉 Follow [SETUP.md](SETUP.md) first!

**Want to learn the features?** 👉 Read [USER_GUIDE.md](USER_GUIDE.md)

**Running into issues?** 👉 Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
