# 🛎️ Suitely

A modern, open-source hotel management system built with **Next.js** and **Supabase**.

Manage reservations, check-in/check-out, housekeeping, guest folios, and staff schedules for boutique hotels and larger properties.

## Features ✨

- **📅 Reservation Management** - Create, view, and manage guest bookings via a step-by-step booking wizard
- **✅ Check-In / Check-Out Workflows** - Multi-step wizards from every entry point (Reservations, Dashboard, or the navbar): occupancy + optional guest ID capture at check-in (with an automatic over-capacity surcharge), and departure date + item charges + early-checkout credit at check-out
- **🧾 Itemized Guest Folios** - Room charge plus itemized incidentals (minibar, damage, discounts) from a staff-managed items catalog, with a one-click printable receipt
- **🧹 Housekeeping & Maintenance** - A cleaning queue for turning rooms around after checkout, and a maintenance issue tracker that automatically takes a room out of service and hands it back
- **🏠 Room Management** - Track room types (incl. per-night extra-guest fees), availability, and status
- **👥 Staff Management** - Manage team members and work schedules
- **🔐 Real Auth** - Supabase Auth logins for hotel admins and individual staff members
- **📜 Rich Audit Trail** - Every reservation and folio-charge change is logged with a human-readable description (who, what, when) — survives even after the record is deleted, with a calendar-based date filter
- **📊 Dashboard** - Live room status, today's arrivals/departures (actionable, not just informational), revenue snapshot, staff on shift
- **🔒 Multi-Tenant** - Support multiple hotels with one codebase, isolated via Row-Level Security
- **🌙 Dark Mode** - Dark theme throughout, with subtle animations

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
   - Copy all content from `database.sql`
   - Run it
   - **Resuming an existing project?** Check [CLAUDE.md](CLAUDE.md#outstanding-manual-steps-run-this-next) — not every section of `database.sql` may have been run against your project yet, and re-running the whole file isn't safe (it isn't fully idempotent).

5. **Start Development**
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

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Framer Motion
- **Backend**: Supabase (PostgreSQL), REST API
- **Auth**: Supabase Auth (email/password) — shared login for hotel admins and staff
- **Hosting**: Vercel (recommended)

## Project Structure

```
├── app/                          # Next.js pages
│   ├── dashboard/                 # Main app pages (auth-guarded layout)
│   │   ├── reservations/
│   │   │   └── activity/          # Audit/activity log + date-filter calendar
│   │   ├── rooms/                 # Room types + rooms
│   │   ├── housekeeping/          # Cleaning queue + maintenance tracker
│   │   ├── items/                 # Priced items catalog
│   │   ├── settings/              # Hub linking Items/Activity Log/Staff
│   │   └── staff/
│   ├── login/                     # Shared login (admin + staff)
│   ├── setup/                     # Initial setup wizard
│   ├── api/staff/create/          # Service-role staff provisioning
│   └── page.tsx                   # Landing page
├── components/                   # Reusable React components
│   ├── DashboardNav.tsx           # Top navigation bar
│   ├── QuickCheckInOut.tsx        # Navbar check-in/out dropdowns
│   ├── CheckInDialog.tsx          # Check-in wizard
│   ├── CheckoutDialog.tsx         # Check-out wizard
│   ├── ReservationFolio.tsx       # Itemized folio + print receipt
│   ├── ReservationGuests.tsx      # Guest ID viewer/editor
│   ├── ItemGrid.tsx               # Shared item-catalog picker
│   └── ActivityCalendar.tsx       # Month-grid activity date filter
├── lib/
│   ├── supabase.ts                # Browser database client
│   ├── supabaseAdmin.ts           # Server-only service-role client
│   ├── AuthContext.tsx            # Session/profile context
│   ├── formatDate.ts              # IST timestamp formatting
│   └── types.ts                   # TypeScript definitions
├── database.sql                  # Database schema
└── public/                       # Static assets
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
    guest_email: 'john@example.com',
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

### Phase 2 ✅ (Essentially Complete)
- ✅ Real auth (hotel admin + staff logins)
- ✅ Reservation + folio audit trail
- ✅ Check-in/check-out workflows (with occupancy surcharge & guest ID capture)
- ✅ Itemized guest folios + items catalog
- ✅ Housekeeping task management
- ✅ Maintenance tracking

### Phase 2.5 (Raised, not yet built)
- [ ] Guest profiles / repeat-guest recognition
- [ ] Occupancy/ADR/RevPAR reporting
- [ ] Visual room/date availability chart
- [ ] Role-based permission enforcement
- [ ] Password-reset flow
- [ ] Reservation search/filter

### Phase 3 (Future)
- [ ] Guest self-service booking
- [ ] Email/SMS notifications
- [ ] Payment processing (Stripe)
- [ ] OTA integrations (Booking.com, Airbnb)
- [ ] Advanced reporting & analytics
- [ ] Mobile app (React Native)

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
| `organizations` | Hotel info (tenants) |
| `users` | Staff members (real Supabase Auth logins) |
| `rooms` | Physical rooms |
| `room_types` | Room classifications, incl. per-night extra-guest fee |
| `reservations` | Guest bookings, incl. occupancy count and lead guest ID |
| `reservation_charges` | Itemized folio charges (services, discounts, surcharges) |
| `reservation_guests` | Additional occupants beyond the lead guest, with ID |
| `items` | Staff-managed priced catalog for quick folio charges |
| `audit_logs` | Create/update/delete trail (reservations + folio charges) |
| `staff_schedules` | Work shifts |
| `maintenance_logs` | Maintenance tracking |

All tables include Row-Level Security scoped to the authenticated user's organization (not yet scoped by staff role — see [CLAUDE.md](CLAUDE.md#known-limitations-phase-2-honestly-assessed)).

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
