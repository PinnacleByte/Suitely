# Suitely - Troubleshooting Guide

## Table of Contents
1. [Setup Issues](#setup-issues)
2. [Login & Auth Issues](#login--auth-issues)
3. [Display Issues](#display-issues)
4. [Data Issues](#data-issues)
5. [Database Issues](#database-issues)
6. [Check-In / Check-Out / Folio Issues](#check-in--check-out--folio-issues)
7. [Getting Help](#getting-help)

---

## Setup Issues

### "Can't resolve '@supabase/supabase-js'"

**Error:** Module not found

**Cause:** Supabase package not installed

**Solution:**
```bash
npm install @supabase/supabase-js
npm run dev
```

---

### "Environment variables not found"

**Error:** Can't connect to Supabase

**Cause:** `.env.local` file is missing or incorrect

**Solution:**
1. Create `.env.local` in project root:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

2. **Check for:**
   - No extra spaces or quotes
   - URL starts with `https://`
   - No trailing slashes
   - Correct domain: `supabase.com`

3. **Restart dev server (required, not optional):**
```bash
Ctrl+C
npm run dev
```
Next.js only reads `.env.local` when the server starts — editing the file while `npm run dev` is already running has no effect until you restart it. If you add/change a variable and things still don't work, this is the first thing to check.

4. **Refresh browser:** F5

---

### "Failed to load resource: net::ERR_NAME_NOT_RESOLVED"

**Error:** Browser can't reach Supabase

**Cause:**
- Wrong Supabase URL
- Network issue
- DNS blocking (Pi-hole, etc.)

**Solution:**

**Step 1:** Verify URL
- Go to [Supabase Dashboard](https://supabase.com)
- Settings → API
- Copy Project URL exactly (watch for trailing spaces)
- Update `.env.local`

**Step 2:** Test connectivity
- Open new browser tab
- Visit your Supabase URL directly
- Should show Supabase homepage (not "page not found")

**Step 3:** Check network
- Disable VPN/proxy
- If using Pi-hole: Whitelist `*.supabase.com`
- Check internet connection

**Step 4:** Clear cache
- F12 → Application → Clear Storage
- Refresh page (F5)

---

### "401 Unauthorized" Error

**Error:** e.g. `POST /rest/v1/reservations 401 (Unauthorized)`

**Cause:** Row-Level Security (RLS) policies require a logged-in user whose `users` row has a matching `org_id` — this usually means you're not signed in, or your session expired.

**Solution:**
1. Go to `/login` and sign back in
2. If you're not sure you have an account yet, run `/setup` first (for a new hotel) or ask your admin to add you as staff
3. If the problem persists for a *specific* table only, check that the RLS policies from `database.sql` were applied correctly — see [database.sql](database.sql) for the current policies (they're scoped to `org_id = current_org_id()`, not open to everyone)

**Do not** re-run the old `USING (true)` / "Anyone can..." policies to work around this — those were removed on purpose because they let any anonymous request read or write any hotel's data. If you're stuck, re-check the RLS section of `database.sql` instead of loosening it.

---

## Login & Auth Issues

### "Email signups are disabled"

**Cause:** The Supabase project has "Allow new users to sign up" turned off.

**Solution:**
1. Supabase dashboard → Authentication (Sign In / Providers, or Settings)
2. Turn **on** "Allow new users to sign up"
3. Try `/setup` again

---

### "Account created, but no session was returned"

**Cause:** "Confirm email" is turned on, so Supabase won't issue a session until the user clicks a confirmation link — but Phase 1 has no email service to send that link.

**Solution:**
1. Supabase dashboard → Authentication → find the Email provider settings
2. Turn **off** "Confirm email" (sometimes worded "Enable email confirmations"). If you can't find it, use the dashboard's search/command palette and type "confirm email".
3. Try `/setup` again

---

### "Failed to create staff member" / blank error after adding staff

**Cause:** Usually the `SUPABASE_SERVICE_ROLE_KEY` env var isn't loaded — either it's missing from `.env.local`, or it was added *after* the dev server was already running (see the "Environment variables not found" restart note above).

**Solution:**
1. Confirm `SUPABASE_SERVICE_ROLE_KEY` is in `.env.local` (copy it from Supabase → Settings → API → `service_role` key)
2. Restart the dev server: `Ctrl+C` then `npm run dev`
3. Try adding the staff member again
4. If it still fails, check the terminal running `npm run dev` for the actual error (the browser error is often generic)

---

### Forgot the admin or staff password

There's no "forgot password" email flow in Phase 1. To reset a password without email:
1. Supabase dashboard → **Authentication → Users**
2. Find the account by email
3. Use the dashboard's password reset action to set a new password directly (no email required)

Or, if it's fine to lose the test data, wipe and start over:
```sql
TRUNCATE organizations CASCADE;
```
This clears the app's tables but **does not** delete the Supabase Auth account itself — if you want that gone too, delete it from Authentication → Users as well, otherwise you'll have a stray login with no hotel attached.

---

## Display Issues

### "Buttons or text are hard to see"

**Solution:**
1. **Refresh page:** F5
2. **Check browser zoom:** Ctrl+0 (reset to 100%)
3. **Try different browser**

The app is dark-themed by design (dark backgrounds, light text) — if something looks inverted or washed out, it's more likely a rendering glitch than the intended look. A hard refresh usually fixes it.

---

### "Page layout looks broken"

**Issue:** Elements misaligned, weird spacing

**Solution:**
1. **Hard refresh:** Ctrl+Shift+R (or Cmd+Shift+R on Mac)
2. **Clear browser cache:** F12 → Application → Clear Storage → Refresh
3. **Restart dev server:**
```bash
Ctrl+C
npm run dev
```

---

## Data Issues

### "Rooms don't appear in reservation dropdown"

**Issue:** Created rooms but can't select them when making reservations

**Cause:** Rooms list not loaded or not yet created

**Solution:**

**Step 1:** Verify rooms exist
1. Go to **Rooms** tab
2. Scroll to **Rooms** section
3. Do you see room cards? (e.g., "#101 Suite - available")

**Step 2:** If no rooms show
1. Create a room type first:
   - Click **+ New Room Type**
   - Fill all fields
   - Click **Create Room Type**

2. Create a room:
   - Click **+ New Room**
   - Select the room type from dropdown
   - Enter room number
   - Click **Create Room**

**Step 3:** Refresh the form
1. Go to **Reservations** tab
2. Click **+ New Reservation**
3. Room dropdown should reload and show your rooms

**Step 4:** If still not showing
- Check browser console (F12 → Console) for errors
- Try hard refresh (Ctrl+Shift+R)
- Restart dev server

---

### "Error creating a room"

**Issue:** Room creation fails silently

**Solution:**

1. **Check console for errors:**
   - F12 → Console tab
   - Look for red error messages
   - Share them with developer

2. **Verify required fields:**
   - ✅ Room Type is selected (dropdown has a value)
   - ✅ Room Number is filled in
   - ✅ Room Type dropdown shows options

3. **Try different room number:**
   - Room numbers must be unique per hotel
   - If "101" fails, try "102"

4. **Check Supabase directly:**
   - Go to Supabase Dashboard
   - Tables → rooms
   - Manually verify no duplicate room numbers

---

### "Data not appearing after creating it"

**Issue:** Created something but it doesn't show in the list

**Solution:**

1. **Refresh the page:** F5

2. **Reload the section:**
   - Click another tab (e.g., Dashboard)
   - Click back to the tab (e.g., Rooms)

3. **Check Supabase directly:**
   - Supabase Dashboard → Tables
   - Look for your data in the table
   - If it's there but not showing in app: app bug
   - If it's not there: data wasn't saved (check RLS — see 401 section above)

4. **Check browser console:**
   - F12 → Console
   - Look for error messages when creating data

---

### "Can't select room type in room creation"

**Issue:** Room Type dropdown is empty

**Cause:** No room types created yet

**Solution:**
1. Go to **Rooms** section
2. Scroll up to **Room Types**
3. Click **+ New Room Type**
4. Create at least one room type
5. Then try creating a room again

---

### Reservation audit trail / timestamps look wrong

**Issue:** History or Activity Log timestamps seem off by several hours

**Cause:** Older `created_at` columns were `TIMESTAMP` (no time zone), which could display incorrectly depending on the viewer's browser locale. This has been fixed — all timestamp columns are now `TIMESTAMPTZ`, and the app formats them explicitly in IST via `lib/formatDate.ts`.

**Solution:** If you're still seeing this on an existing project, run the timezone migration section near the end of [database.sql](database.sql) (the block of `ALTER TABLE ... TYPE TIMESTAMPTZ ...` statements) in the Supabase SQL Editor.

---

## Database Issues

### "Tables not found" or "No data shows"

**Issue:** Database empty or tables don't exist

**Cause:** SQL schema not run in Supabase

**Solution:**

1. **Open Supabase Dashboard**
2. **Go to SQL Editor**
3. **Click New Query**
4. **Copy from [database.sql](database.sql)** - all of it
5. **Paste into Supabase SQL Editor**
6. **Click Run**
7. **Wait for completion** (should say "Success")

If you get errors:
- Copy the error message
- Share with developer
- Don't try to fix it yourself

---

### "Can't connect to Supabase"

**Issue:** Connection timeout, can't reach database

**Cause:**
- Network issue
- Supabase project not active
- URL is wrong

**Solution:**

1. **Check Supabase status:**
   - Visit https://status.supabase.com
   - All green? ✓ Good
   - Any red? Wait for fix

2. **Verify URL in .env.local:**
   - Open `.env.local`
   - Copy URL from Supabase Settings → API
   - Verify no typos

3. **Test manually:**
   - Open browser console (F12)
   - Paste: `fetch('https://your-url/rest/v1/organizations')`
   - Should get a response (not "not found")

4. **Restart everything:**
   ```bash
   Ctrl+C
   npm run dev
   ```

---

### "SQL query fails when run in Supabase"

**Issue:** Error when trying to create tables

**Cause:** Database already has tables (trying to create duplicates)

**Solution:**

**If tables already exist (OK):**
- Just skip that part
- Run only the newer sections you haven't applied yet (check the comments in [database.sql](database.sql) — each major addition is clearly delimited, e.g. "Phase 2: Real auth...")

**If want fresh database:**
```sql
-- Drop all tables (CAREFUL - deletes all data!)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS maintenance_logs CASCADE;
DROP TABLE IF EXISTS staff_schedules CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS room_types CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
```
This does not delete Supabase Auth accounts (`auth.users`) — clear those separately from Authentication → Users if you want a truly clean slate.

Then run full [database.sql](database.sql) again.

---

## Check-In / Check-Out / Folio Issues

### "column reservations.guest_count does not exist" (or guest_id_type / guest_id_number)

**Cause:** The occupancy + guest ID capture migration (the last section of `database.sql`) hasn't been run against this Supabase project yet — it's a separate, more recent addition than the base schema.

**Solution:**
1. Open [database.sql](database.sql) and find the comment `-- Check-in occupancy + guest ID capture...` near the end of the file
2. Copy from that comment to the end of the file
3. Run it in the Supabase SQL Editor
4. See [CLAUDE.md](CLAUDE.md#outstanding-manual-steps-run-this-next) for the full list of what may still be pending

---

### "relation reservation_charges does not exist" / "relation items does not exist" / "relation reservation_guests does not exist"

**Cause:** Same as above — one of the incrementally-appended sections of `database.sql` (folio, items catalog, or guest capture) hasn't been run yet.

**Solution:** Same as above — check [CLAUDE.md](CLAUDE.md#outstanding-manual-steps-run-this-next) for exactly which section is missing, and run only that section (not the whole file — see the [Database Issues](#sql-query-fails-when-run-in-supabase) note above about re-running already-applied SQL).

---

### Check-in wizard shows a surcharge I didn't expect

**Cause:** The room type's **Extra Guest Fee** (Rooms → edit the room type) is greater than 0, and the entered guest count exceeds that room type's **Max Guests**. This is intentional — it's a per-night surcharge, automatically added to the folio.

**Solution:** If this room type shouldn't charge for extra guests, edit it (Rooms tab) and set **Extra Guest Fee** to 0.

---

### Editing guest count or dates after check-in didn't change the folio total

**Cause:** By design — the extra-guest surcharge and the early-checkout credit are calculated **once**, when the check-in/check-out wizard is confirmed. Editing `guest_count` afterward (via the Guests panel) or the dates (via the reservation's Edit form) does not retroactively recalculate folio charges.

**Solution:** Adjust the folio manually — open **Folio** on the reservation and use **+ Add Charge → Custom** to add or remove the difference (use a negative amount for a credit).

---

## Browser Console Errors

### How to Find Errors

1. **Open Console:**
   - Windows: F12
   - Mac: Cmd+Option+J

2. **Look for red text** - these are errors

3. **Red errors look like:**
   ```
   ❌ Failed to fetch
   ❌ POST .../reservations 401
   ❌ TypeError: rooms is undefined
   ```

4. **Share the full error text with developer**

---

### Common Error Messages

**"rooms is undefined"**
- Rooms didn't load from database
- Solution: Refresh page (F5)

**"Cannot read property 'id'"**
- Data structure problem
- Solution: Restart dev server

**"net::ERR_NAME_NOT_RESOLVED"**
- Can't reach Supabase
- Solution: Check URL and network (see [Setup Issues](#setup-issues))

**"Unexpected end of JSON input" (from `/api/staff/create`)**
- The API route crashed before returning a response — almost always the missing/stale `SUPABASE_SERVICE_ROLE_KEY` issue above
- Solution: See [Login & Auth Issues](#login--auth-issues) → "Failed to create staff member"

---

## Advanced Debugging

### Check Network Requests

1. **Open DevTools:** F12
2. **Go to Network tab**
3. **Perform an action** (e.g., create a room)
4. **Look for requests to supabase.com**
5. **Check status codes:**
   - 200-299: ✅ Success
   - 400-499: ❌ Client error
   - 500-599: ❌ Server error

### Check Application State

1. **Open DevTools:** F12
2. **Go to Application tab**
3. **Expand Local Storage**
4. **Look for orgId** - should have a value after logging in
5. If empty: Log out and log back in (it's set automatically from your profile, not manually)

### Check Network Connection

1. **Open DevTools:** F12
2. **Go to Console tab**
3. Paste: `fetch('https://google.com').then(r => console.log('OK')).catch(e => console.log('No network'))`
4. **Result:**
   - "OK" = Internet working
   - "No network" = Check connection

---

## Still Stuck?

**Before asking for help, collect:**
1. ✅ **Browser console errors** (F12 → Console)
2. ✅ **The dev server terminal output** (especially for API route errors)
3. ✅ **What you were doing** when it broke
4. ✅ **Screenshots** of the error
5. ✅ **Steps to reproduce** it

**Then:**
- Check [SETUP.md](SETUP.md) - might be setup issue
- Check [USER_GUIDE.md](USER_GUIDE.md) - might be usage question
- Check [CLAUDE.md](CLAUDE.md) - might be architecture question
- Ask developer with collected info above

---

## Tips for Staying Ahead of Issues 💡

1. **Refresh often:** F5 clears most display issues
2. **Check console:** F12 catches errors early
3. **Verify before submitting:** Double-check all fields
4. **Clear cache:** Hard refresh (Ctrl+Shift+R) if things look wrong
5. **Restart dev server:** When in doubt, and *always* after editing `.env.local`

---

**Last Updated:** 2026-07-02
**Version:** 3.0
