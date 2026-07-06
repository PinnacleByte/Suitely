# Billing & Invoicing — Design Plan (historical)

> **Status (2026-07-05): Phases A, B, and D are BUILT and shipped; Phase C (tax) is deferred.** This doc is kept as the design record — the per-phase "✅ BUILT" notes below are accurate; the surrounding prose is the original proposal.
> **Two original assumptions no longer hold** (see [CLAUDE.md](CLAUDE.md) for current truth):
> 1. *"Org-scoped RLS only, no role checks"* (§2, §4.1) — the app now has **role-based RLS** (admin/manager/staff). Billing tables: everyone can issue invoices/record payments; **voiding an invoice is manager/admin only**.
> 2. *"append new sections to `database.sql`, run only the new section"* (below, and §7) — `database.sql` was since **rebuilt into a single clean, re-runnable file** (drop + recreate). New changes edit it in place and you re-run the whole thing.

## 1. Problem statement

Today's "billing" is really just a **folio of what's owed**:

- Room cost lives on `reservations.total_price`.
- `reservation_charges` (add/remove only) holds incidentals / discounts / a manual `tax` line.
- "Print Receipt" is generated **on the fly** from live data in a popup — no number, no issue date, and it silently changes if the reservation or its charges are later edited/deleted.

Three things are missing to make this real:

1. **No record of money received** — there is no payments concept, so the folio only ever shows an amount *owed*, never *paid* or a *balance due*. You can print a receipt for a guest who has paid nothing.
2. **No immutable invoice** — the receipt is ephemeral, so it can't be an accounting/tax record.
3. **No tax model** — `tax` is a manual free-text charge, not a configurable rate.

## 2. Guiding principles (keep consistent with the existing codebase)

- **Additive, never rewrite `total_price`.** Same discipline as `reservation_charges`: the room price stays authoritative; everything new sits alongside it.
- **Snapshot for immutability.** Same philosophy as `audit_logs` and the deliberate no-FK from `reservation_charges` → `items`: once an invoice is *issued*, its line items + totals are captured into JSONB so later edits/deletes/currency changes never rewrite history.
- **Org-scoped RLS only**, `org_id = current_org_id()`, no role checks (matches every other table — the known, deliberate gap).
- **`TIMESTAMPTZ` everywhere**, displayed via `formatIST()`; money via `formatMoney` from `lib/currency.ts` — never a hardcoded `$`.
- **No premature abstractions.** A little accepted duplication (each dialog has its own `nightsBetween`/`loadData`) is fine.
- **Non-atomic sequential Supabase calls** are the house style — acceptable here too, *except* invoice-number allocation, which must be race-safe (see §4.2).

---

## 3. Phase A — Payments ✅ BUILT (2026-07-03)

The single biggest gap and the smallest change. Shipped: `payments` table + RLS + `log_payment_audit()` trigger (migration deployed), `Payment` type, folio Total/Paid/Balance Due + record/remove, a payment capture step on the checkout wizard's Review step, an optional booking-deposit entry point in the New Reservation wizard, and `'payment'` folded into the History expander + Activity Log queries/badges. Verified with `npx tsc --noEmit`.

### 3.1 Schema (`payments`)

```sql
-- ============================================================
-- PAYMENTS — money actually received against a reservation.
-- Additive, like reservation_charges: the folio's amount OWED is
-- (total_price + SUM(reservation_charges.amount)); amount PAID is
-- SUM(payments.amount); balance due is owed - paid.
-- ============================================================
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
```

- **Add/remove only** (no UPDATE policy), mirroring `reservation_charges` — correct a payment by deleting and re-adding.
- Refunds are just negative-amount rows (mirrors how discounts are negative charges).
- `method` kept as free-ish TEXT (like `reservation_charges.category`) — a small fixed option list in the UI, not a DB enum, so adding a method later needs no migration.

### 3.2 Audit trail

Optional but recommended for parity: extend the audit story to payments. Two choices —
- **(a)** a `log_payment_audit()` trigger on `payments` (INSERT/DELETE), `entity_type = 'payment'`, recorded against the **reservation's** id so it interleaves in the per-row History expander (exactly how `log_reservation_charge_audit()` already does it); **or**
- **(b)** skip it for Phase A.

Recommendation: **(a)** — money movement is precisely what an audit trail is for, and the pattern already exists to copy. The activity page + History expander queries would widen to `entity_type IN ('reservation','reservation_charge','payment')`.

### 3.3 Types (`lib/types.ts`)

```ts
export type Payment = {
  id: string
  org_id: string
  reservation_id: string
  amount: number
  method: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'other'
  note: string | null
  paid_at: string
  created_at: string
}
```

### 3.4 UI touchpoints

- **`components/ReservationFolio.tsx`** — the main change:
  - Load `payments` alongside `charges`.
  - Under the existing **Total** line, add **Paid** and **Balance Due** rows (Balance Due in amber when > 0, green/"Settled" when ≤ 0). `formatMoney` throughout.
  - A **"+ Record Payment"** control (amount, method dropdown, optional note) next to "+ Add Charge", and each payment row gets a "Remove" like charges do.
  - Print receipt gains a **Paid / Balance** line at the bottom (from the snapshot once invoices land — see Phase B).
- **`components/CheckoutDialog.tsx`** — insert a **Payment** step (or fold into Review): show the computed grand total and let staff record the settling payment at checkout. Keep it optional (front desk may settle separately), consistent with the wizard's other optional steps.
- **`app/dashboard/page.tsx`** — later: an "Outstanding balances" widget becomes trivial once payments exist (see Phase D).

**Effort:** ~half a day. New table + RLS, one type, folio additions, one checkout step, optional audit trigger.

---

## 4. Phase B — Invoices as immutable records ✅ BUILT (2026-07-03)

Turns the ephemeral receipt into a real document with a stable number and a frozen snapshot. Shipped: `invoices` + `invoice_counters` tables, `next_invoice_number()` `SECURITY DEFINER` fn (migration deployed); `Invoice`/`InvoiceSnapshot` types; `formatMoney` currency override; `lib/printInvoice.ts` (snapshot-driven print, VOID watermark); folio Issue Invoice / list / Print / Void; `app/dashboard/invoices` list page (search + status filter) linked from Settings. Manual issue only; `tax_total` reserved but always 0 pending Phase C. Verified with `npx tsc --noEmit`.

### 4.1 Schema (`invoices`)

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,             -- date-based, unique per org (see 4.2)
  status TEXT NOT NULL DEFAULT 'issued',    -- issued | paid | void
  snapshot JSONB NOT NULL,                  -- frozen line items + totals + guest/room/date header
  subtotal DECIMAL(10,2) NOT NULL,          -- denormalized for list views / reporting
  tax_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, invoice_number)
);

CREATE INDEX idx_invoices_org_reservation ON invoices(org_id, reservation_id);
-- RLS: view/insert/update (for status void→paid) with org_id = current_org_id(); no delete.
```

- **`snapshot` freezes** the room charge + every `reservation_charges` line + tax + the guest/room/dates header **at issue time**. Editing/deleting the underlying reservation or charges afterward does **not** change an issued invoice — that's the whole point.
- **No delete** — voiding is a status change (`void`), so numbers are never reused and the record survives (same reasoning as `audit_logs`).
- `status` moves `issued → paid` when Balance Due (from Phase A payments) hits zero — computed in the UI, optionally auto-stamped.

### 4.2 Date-based invoice numbers (the one race-sensitive piece)

Chosen format: **`INV-YYYY-MM-NNNN`** — e.g. `INV-2026-07-0001`, sequential **within each org, within each month**. Readable, resets its counter each period, still monotonic.

Because two front-desk staff could issue at the same instant, allocation must be atomic — this is the **one** place we deviate from the app's "sequential non-atomic calls" style. Use a small counters table + a `SECURITY DEFINER` Postgres function:

```sql
CREATE TABLE invoice_counters (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period TEXT NOT NULL,          -- 'YYYY-MM'
  last_seq INT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, period)
);
ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;  -- no policies; only the SECURITY DEFINER fn touches it

CREATE OR REPLACE FUNCTION next_invoice_number(p_org UUID)
RETURNS TEXT AS $$
DECLARE
  v_period TEXT := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');  -- IST, matches formatIST()
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
```

- The `ON CONFLICT ... DO UPDATE ... RETURNING` is atomic — no lost/duplicate numbers under concurrency.
- Called from the client at issue time: `supabase.rpc('next_invoice_number', { p_org: orgId })`, then insert the invoice with the returned number.
- Period is computed in **IST** to line up with `formatIST()`/`dateIST()` so a late-night issue lands in the intended calendar month.
- The `UNIQUE (org_id, invoice_number)` on `invoices` is the belt-and-suspenders backstop.

### 4.3 Types + UI

```ts
export type Invoice = {
  id: string
  org_id: string
  reservation_id: string
  invoice_number: string
  status: 'issued' | 'paid' | 'void'
  snapshot: Record<string, unknown>
  subtotal: number
  tax_total: number
  total: number
  issued_at: string
  created_at: string
}
```

- **Folio panel:** "Print Receipt" becomes **"Issue Invoice"** (allocates a number, writes the snapshot) + **"Print"** (renders from the *snapshot*, not live data). Show the invoice number/status once issued; a **"Void"** action for mistakes.
- **New page `app/dashboard/invoices/page.tsx`** (linked from Settings, like Items/Staff): list of invoices — number, guest, date, total, status, paid/outstanding — with search/filter mirroring the Reservations page conventions (`overflow-x-auto` card + `min-w-*`, or the mobile card layout if it gets busy).
- Print HTML reuses the existing popup approach in `ReservationFolio.handlePrintReceipt`, fed from `invoice.snapshot` instead of live props.

**Effort:** ~1–1.5 days (schema + counter fn + issue/void flow + list page + snapshot-driven print).

---

## 5. Phase C — Configurable tax

- Add `organizations.tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0` and `organizations.tax_label TEXT NOT NULL DEFAULT 'Tax'` (e.g. "GST", "VAT"), set on `/setup` and editable on `/dashboard/settings` — exactly like the `currency` column was added (`ALTER TABLE ... ADD COLUMN`, mirrored to localStorage by `AuthContext` if the UI needs it synchronously).
- Tax becomes a **computed line** in the folio/invoice (`taxable_subtotal × rate`), not a manual `reservation_charges` row. Decide: tax on room + services, but **not** on discounts/credits — spell this out in the folio subtotal math.
- Retire the manual `tax` category from the "Custom charge" form (or keep it for edge cases; recommend keeping but de-emphasizing).
- The invoice snapshot already carries `tax_total` (§4.1), so historical invoices keep their original rate even if the org later changes it — same immutability guarantee as currency.

**Effort:** ~half a day, mostly folio/invoice math + a settings field.

---

## 6. Phase D — Reporting catch-up (closes known gaps) ✅ BUILT (2026-07-03)

Pure client-side aggregation on the dashboard (no migration). Shipped:

- **Revenue includes folio charges** — the dashboard now loads `reservation_charges` + `payments` and computes `folioTotal(r) = total_price + Σ charges`; both revenue figures use it (closes the CLAUDE.md gap).
- **Outstanding Balance card** — `Σ max(0, folioTotal − payments)` across active reservations, with a count of how many are owing (positive-balance only; overpayment/deposit is a credit, not a receivable).

Verified with `npx tsc --noEmit`. A dedicated Accounts Receivable / unpaid-invoices view was **not** built at the time (the dashboard card + the `/dashboard/invoices` status filter cover the need for now); revisit if AR aging is wanted. ADR/RevPAR/occupancy KPIs remain out of scope.

> **Update (2026-07-05):** a full **Accounts / Financials (P&L)** section was later built at `/dashboard/accounts` (managers/admins) — categorized accrual revenue (matching this dashboard definition) + operating expenses + auto-derived payroll, weekly/monthly charts, and a printable statement. See CLAUDE.md's "Accounts / Financials" section. Tax (Phase C) is still deferred; the statement's tax slot ties into `invoices.tax_total` when it lands.

---

## 7. Suggested build order & migration discipline

1. **Phase A — Payments** (table + RLS + optional audit trigger + folio/checkout UI). Highest impact, lowest risk.
2. **Phase B — Invoices** (table + `invoice_counters` + `next_invoice_number` fn + issue/void + list page + snapshot print).
3. **Phase C — Tax** (org columns + computed line).
4. **Phase D — Reporting** (dashboard math + outstanding widget).

Each phase is an **appended** `database.sql` section, run **only that new section** in the Supabase SQL editor (the file is not idempotent — no `IF NOT EXISTS`). Symptom of a forgotten migration is a "column/relation does not exist" console error. After deploy, update **Outstanding Manual Steps** and the relevant CLAUDE.md sections.

## 8. Decisions (resolved 2026-07-03)

1. **Deposits at booking — YES.** Record a deposit/advance when a reservation is *created*, not only at checkout. Adds an optional payment entry point to the booking wizard (`app/dashboard/reservations/page.tsx`), writing a `payments` row. Same table, extra entry point.
2. **Refunds — negative payment rows.** No distinct `refund` entity; a refund is a negative-amount `payments` row (matches the discount/credit pattern).
3. **Tax — PENDING.** GST specifics unclear; user to confirm the tax base later. **Phase C is on hold** until then. Phases A/B/D do not depend on it — build them first. (When it lands, the `invoices.tax_total` column + snapshot already reserve a place for it.)
4. **Invoices — MANUAL issue.** No auto-issue on checkout; issuing an invoice is a deliberate staff action (avoids numbering churn on corrections).
5. **Payments audit — TRIGGER it.** Ship `log_payment_audit()` with Phase A (`entity_type = 'payment'`, recorded against the reservation's id, INSERT/DELETE), and widen the History expander + activity page queries to include `'payment'`.

### Net effect on build order
Phase A (Payments, **with** audit trigger + booking-wizard deposit entry point) → Phase B (Invoices, manual issue) → **Phase C (Tax) deferred pending §8.3** → Phase D (Reporting).
