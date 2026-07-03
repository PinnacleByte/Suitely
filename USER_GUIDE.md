# Suitely - User Guide

## Quick Navigation

- **Setup**: See [SETUP.md](SETUP.md) to initialize the app
- **Developer Guide**: See [CLAUDE.md](CLAUDE.md) for architecture & development
- **Troubleshooting**: See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues

---

## Overview

Welcome to Suitely! This guide walks you through using each feature of the app.

**Top navigation:**
- 📊 **Dashboard** - Overview of your hotel, with actionable arrivals/departures
- 📅 **Reservations** - Manage guest bookings, folios, guest IDs, and history
- 🏠 **Rooms** - Manage room inventory
- 🧹 **Housekeeping** - Cleaning queue + maintenance issues
- ⚙️ **Settings** - Items catalog, Activity Log, and Staff management

Plus two quick-action buttons on the navbar itself: **Check In** and **Check Out**, usable from any page.

---

## Logging In 🔐

Suitely uses one shared login page for everyone — the account decides what you can do, not the login form.

- **Hotel admin**: created once, during `/setup`, along with the hotel itself.
- **Staff**: created by an admin from Settings → Staff, who shares a temporary password with them directly (there's no email invite system yet).

Go to `/login`, enter your email and password, and you'll land on the dashboard. Use the **Log out** button in the top-right of the navigation bar to end your session.

---

## Dashboard

**Location:** Home page after login

The dashboard is a real operations view, not just a checklist. It shows:
- **Room Status** - Live counts of Available, Occupied, Cleaning, and Maintenance rooms
- **Arriving Today / Departing Today** - Guests checking in or out today, with their room number, and a **Check in** / **Check out** button right on the list — no need to leave the dashboard
- **Revenue This Month** - Total from confirmed/checked-in/checked-out stays starting this month (room price only — doesn't yet include folio charges like minibar or surcharges)
- **Upcoming Confirmed Revenue** - Total from confirmed future bookings not yet checked in
- **Staff on Shift Today** - Who's scheduled to work today and their position, from the Staff page's schedules
- **Quick Actions** - Links to Reservations, Rooms, Housekeeping, Items, and Staff

All the "today" figures use IST (India Standard Time), regardless of what timezone your own device is set to.

**Use it to:**
- Get a quick read on what needs attention right now (who's arriving/leaving today, is anything overdue for cleaning)
- Check a guest in or out without navigating anywhere else

---

## Check-In & Check-Out ✅

Checking a guest in or out opens a short wizard — from **any** of these three places, and they all behave identically:
- The **Check In** / **Check Out** button on the navbar (works from any page, with a search box to find a specific guest)
- The **Arriving Today** / **Departing Today** lists on the Dashboard
- The **Check in** / **Check out** button on a reservation's row in the Reservations table

### Checking a Guest In

1. **Occupancy** — enter how many guests are staying in the room. The room type's max capacity is shown for reference. If you enter more than the room sleeps, you'll see a preview of the extra-guest surcharge that will be added to the folio (configured per room type — see [Room Management](#room-management-)).
2. **Guest IDs** *(optional)* — you can enter an ID type (e.g. "Aadhaar", "Passport") and number for the lead guest, plus a name + ID for each additional occupant. None of this is required to complete check-in — you can add it later (see [Managing Guest IDs](#managing-guest-ids)).
3. **Review & Confirm** — shows everything you entered plus the surcharge (if any), then confirms. The room automatically flips to "Occupied."

### Checking a Guest Out

1. **Departure** — confirm the actual date the guest is leaving (defaults to today, but you can change it — e.g. if they left a day early or you're logging a late checkout). If it's earlier than the original checkout date, you'll see a preview of the credit that will be applied for the unused nights.
2. **Items** *(optional)* — add anything the guest used from your items catalog (minibar, etc.), with a quantity for each.
3. **Review & Confirm** — shows the full breakdown (room charge, any early-checkout credit, any items) and the total, then confirms. The room automatically flips to "Cleaning" so housekeeping knows it needs turning around.

---

## Reservations 📅

### Creating a Reservation

**Steps:**
1. Go to **Reservations** tab
2. Click **+ New Reservation**
3. Follow the wizard: dates → room type → room → guest details
4. Fill in guest details:
   - **Guest Name** - e.g., "John Doe"
   - **Email** - Guest's email
   - **Phone** - Guest's phone number
   - **Total Price** - Auto-calculated from the nightly rate and length of stay (editable)
5. Click **Confirm Reservation**

### Viewing Reservations

All reservations appear in a table showing:
- Guest name & email
- Room number
- Check-in/Check-out dates
- Total price
- Status (Confirmed/Checked In/Checked Out/Cancelled), color-coded

Each row has a row of small links: **Check in**/**Check out** (when applicable — see above), **Edit**, **Delete**, **Folio**, **Guests**, **History**.

### Guest Folio 🧾

Click **Folio** on any reservation to see its itemized bill: the room charge, plus any additional charges (minibar, damage, discounts, surcharges), and a running total.

- **+ Add Charge** lets you either pick from your **Items** catalog (with a quantity for each) or enter a **Custom** charge (a free-text description, a category, and an amount — use a negative amount for a discount).
- **Remove** a charge if it was added by mistake.
- **Print Receipt** opens a clean, printable summary in a new window — use your browser's print dialog, or choose "Save as PDF" if the guest wants a digital copy.

### Managing Guest IDs

Click **Guests** on any reservation to view or edit ID information — whether or not you filled it in during check-in.
- Edit the lead guest's ID type/number and click **Save**.
- **+ Add Guest** to record an additional occupant's name and ID.
- **Edit** or **Remove** any additional guest.

### Audit Trail 📜

Every reservation you create, edit, check in/out, or delete — and every folio charge you add or remove — is automatically logged with a plain-language description, your name, and the exact time (shown in IST). For example: "Checked Out — Room 204 · 2 nights early," or "Charge Added — Minibar x2 – $6.00."

- **Per-reservation history**: click **History** on any row to see everything that's happened to that specific reservation (including its folio charges).
- **Full activity log**: go to **Settings → Activity Log** to see everything across your whole hotel, including reservations that have since been deleted. Use the **calendar on the left** to jump to a specific day — days with recorded activity have a dot; click one to filter, or **Show all** to go back to the full list.

---

## Room Management 🏠

### Room Types (Setup First!)

Before adding rooms, create room types. A room type is a category like "Standard Room", "Deluxe Suite", etc.

**Steps to Create a Room Type:**
1. Go to **Rooms** tab
2. Click **+ New Room Type**
3. Fill in:
   - **Type Name** - e.g., "Standard Room"
   - **Description** - e.g., "Comfortable room with double bed"
   - **Base Price** - e.g., 100 (per night)
   - **Max Guests** - e.g., 2
   - **Extra Guest Fee** *(optional)* - a per-night charge automatically added to the folio if a guest count entered at check-in exceeds Max Guests. Leave at 0 if you don't want to charge for this.
4. Click **Create Room Type**

You'll see the room type appear as a card showing name, max guests, base price, and the extra-guest fee (if set).

### Adding Rooms

Once you have room types, add individual rooms.

**Steps to Create a Room:**
1. Go to **Rooms** tab
2. Scroll to **Rooms** section
3. Click **+ New Room**
4. Fill in:
   - **Room Number** - e.g., "101" or "201" (must be unique)
   - **Room Type** - Select from dropdown
5. Click **Create Room**

Rooms are grouped into sections by room type, sorted by room number within each section. Each room card shows the room number and status. A **maintenance**-status room also shows what issue is affecting it, with a link straight to Housekeeping.

Above the room list, a row of filter tabs (**All / Available / Occupied / Cleaning / Maintenance**, each with a live count) lets you narrow the view.

**Room Statuses:**
- 🟢 **Available** - Ready for guests
- 🔵 **Occupied** - Guest is currently staying
- 🟡 **Cleaning** - Checked out, waiting on housekeeping
- 🔴 **Maintenance** - Room needs repair

Room status changes **automatically** as guests check in/out and as maintenance issues are opened/resolved — you generally shouldn't need to change it by hand.

---

## Housekeeping & Maintenance 🧹

**Location:** Housekeeping tab

### Cleaning Queue

Every room currently in "Cleaning" status (i.e., a guest just checked out) appears here. Click **Mark clean** once the room is turned around, and it becomes "Available" again. If housekeeping finds a problem while cleaning, click **Report issue** right from that room's card.

### Maintenance Tracker

- **+ Report Issue** to log a problem — a title, description, optional linked room, and priority (Low/Medium/High). If you link a room, it's automatically taken out of service (set to "Maintenance") unless a guest is currently in it.
- Move an issue through **Start** (In Progress) → **Complete**. Completing the last open issue on a room automatically returns it to "Cleaning" so housekeeping can do a final pass before it's available again.
- **Reopen** a completed issue, or **Delete** one that was logged in error.
- Completed issues collapse into a "Completed" section so the active list stays focused.

---

## Items Catalog 🧴

**Location:** Settings → Items

A priced list of things staff can quickly add to a guest's folio — minibar items, extra amenities, kits, etc. — instead of typing a description and amount by hand every time.

**Steps to Add an Item:**
1. Go to **Settings → Items**
2. Click **+ New Item**
3. Enter a **Name** (e.g., "Extra Water Bottle") and **Price**
4. Click **Create Item**

Edit the price anytime — it only affects future selections, not charges already added to a guest's folio. Deleting an item doesn't affect any past folio charges either, since a charge's description and amount are captured at the moment it's added.

Items you add here show up in the **Check-Out wizard's Items step** and in a reservation's **Folio → Add Charge → From Catalog**.

---

## Staff Management 👥

**Location:** Settings → Staff

### Adding Staff Members

Adding a staff member creates a **real login** for them, not just a directory entry.

**Steps:**
1. Go to **Settings → Staff**
2. Click **+ Add Staff**
3. Fill in:
   - **Name** - Full name
   - **Email** - Staff email (this is their login)
   - **Temporary Password** - At least 6 characters — share this with the staff member directly (in person, text, etc.). There's no email invite system in this version.
   - **Role** - Select role:
     - **Staff** - Front desk, housekeeping, etc.
     - **Manager** - Supervises staff
     - **Admin** - Full access to system
4. Click **Add Staff Member**

Staff members appear in a table with name, email, and role. They can now sign in at `/login` with the email and password you gave them.

> **Note:** Roles are currently informational — every signed-in staff member can access and edit everything in the hotel's account (create/edit/delete reservations, folios, rooms, etc.), regardless of whether they're marked Staff, Manager, or Admin. Keep that in mind when deciding who gets an account.

### Creating Schedules

Assign staff members to work shifts.

**Steps:**
1. Go to **Settings → Staff**
2. Click **+ New Schedule**
3. Fill in:
   - **Staff Member** - Select from dropdown
   - **Shift Date** - Date of the shift
   - **Start Time** - When shift starts (e.g., 08:00)
   - **End Time** - When shift ends (e.g., 16:00)
   - **Position** - Job for that shift (e.g., "Front Desk", "Housekeeping")
   - **Notes** - Optional notes
4. Click **Create Schedule**

Schedules appear in a table showing staff name, position, date, and times.

---

## Data Input Tips 💡

### Text Fields (Names, Emails, etc.)

- **Light gray/white text is normal** on the dark input fields — click in the field and type
- **Placeholder text** is dimmer gray - disappears when you type

### Number Fields (Prices, Guest Count)

- **Base Price / Extra Guest Fee** - Currency amounts (e.g., 100, 150.50)
- **Max Guests / Occupancy** - Whole numbers only (e.g., 2, 4, 6)
- **Total Price** - Reservation cost (e.g., 300 for 3-night stay)
- **Folio charge amounts** - Use a negative number (e.g., -10) for a discount

### Date Fields

- **Click the calendar icon** or type directly
- Format: MM/DD/YYYY
- Check-out must be after check-in

### Time Fields

- **For schedules** - Format: HH:MM (24-hour)
- Example: 08:00 (8am), 14:30 (2:30pm), 22:00 (10pm)

### Dropdown Lists

- **Click to open** the dropdown
- **Select an option** from the list
- Some dropdowns only show available options (e.g., rooms show status)

---

## Troubleshooting Common Issues 🔧

### Issue: Rooms don't appear in reservation dropdown
1. **Create rooms first** - Go to Rooms → Add a room
2. **Select a room type** - Make sure you created a room type first
3. **Refresh the page** - F5
4. **Open the form again** - Click "+ New Reservation" to reload the list

### Issue: Error says "room_type_id is required"
- **Create a room type first** before adding rooms
- Go to Rooms → + New Room Type

### Issue: Check-in wizard or Guests panel shows an error
- This usually means a database migration from the current development session hasn't been applied yet — see [CLAUDE.md](CLAUDE.md#outstanding-manual-steps-run-this-next) if you're the developer, or ask them.

### Issue: Can't log in
- Double-check your email and password
- If you're a staff member, confirm your admin actually created your account and gave you the right password
- If you're the admin and forgot your password, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for how to reset it via the Supabase dashboard

### Issue: Can't find the database
- Check **SETUP.md** → Make sure you ran the SQL in Supabase
- Verify environment variables in `.env.local`

### Issue: "An error occurred" when creating something
- **Check browser console** (F12 → Console)
- Look for red error messages
- See **TROUBLESHOOTING.md** for detailed solutions

---

## Best Practices ✓

### Room Management
- ✅ Create room types before rooms
- ✅ Use consistent numbering (101, 102, 201, etc.)
- ✅ Keep descriptions accurate
- ✅ Set an Extra Guest Fee on room types where overcrowding is a real cost, so it's applied automatically instead of remembered manually

### Reservations & Folios
- ✅ Check-out date must be after check-in
- ✅ Total price should match your rate × nights
- ✅ Keep guest emails current for communications
- ✅ Prefer catalog items over custom charges when possible — keeps pricing consistent hotel-wide

### Check-In / Check-Out
- ✅ Enter the real guest count at check-in, even if it matches capacity — it's what the surcharge calculation and future reporting rely on
- ✅ Use the actual departure date at checkout, even for early departures — it's what frees the room up for new bookings on those nights

### Staff
- ✅ Use clear job titles (Front Desk, Housekeeping, Manager)
- ✅ Assign shifts in advance
- ✅ Use notes for special instructions
- ✅ Share temporary passwords securely (in person or a private message, not written down publicly)

---

## Keyboard Shortcuts ⌨️

- **F5** - Refresh page (fixes display issues)
- **F12** - Open developer console (for debugging)
- **Tab** - Move between form fields
- **Enter** - Submit forms

---

## Getting Help 🆘

**For setup issues:** See [SETUP.md](SETUP.md)

**For common problems:** See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

**For development:** See [CLAUDE.md](CLAUDE.md)

**In the browser:**
- Press **F12** to open console
- Look for red error messages
- Share these with developer

---

## What's Coming Next 🚀

**Raised, not yet built:**
- Guest profiles / repeat-guest recognition
- Occupancy/ADR/RevPAR reporting on the dashboard
- A visual room/date availability chart
- Enforcing staff roles (currently informational only)
- Self-service password reset
- Search/filter on the Reservations table

**Phase 3+ Features:**
- Guest self-service booking
- Email/SMS notifications
- Payment processing
- Booking integrations
- Analytics & reporting

---

**Version:** 3.0 (Phase 2: Check-in/out, Folios, Housekeeping, Occupancy & Guest IDs)
**Last Updated:** 2026-07-02
