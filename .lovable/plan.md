
# Payments on Statements — plan

Add a lightweight "mark paid" workflow on the existing statement pages (coordinator + driver), so once a statement is exported the same list can be used to reconcile who has been paid.

## 1. Database (migration)

Extend `public.jobs` with payment metadata (kept next to the existing `payment_status` / `payment_method` columns so nothing else breaks):

- `paid_at timestamptz` — when marked paid
- `paid_amount numeric(10,2)` — actual received (supports partial)
- `paid_method text` — `cash | bank_transfer | card | other`
- `paid_reference text` — invoice #, txn id, free note
- `paid_by_user_id uuid` — who ticked it
- `paid_by_role text` — `coordinator | driver | admin`
- `driver_paid_at timestamptz`, `driver_paid_amount`, `driver_paid_method`, `driver_paid_reference`, `driver_paid_by_user_id` — driver-side receipt (separate so client-side payment and driver-payout reconciliation don't overwrite each other)

`payment_status` on `jobs` continues to drive UI. When `paid_amount >= price_amount` we flip it to `paid`; a partial payment sets it to `partial` (new enum value); clearing resets to `pending`. Same rule for the driver side via a small computed `driver_payout_status` field (`pending | partial | paid`).

RLS: reuse existing job policies. Add a targeted policy so a driver assigned to a job can UPDATE only their own `driver_paid_*` columns (via a `SECURITY DEFINER` fn that whitelists those columns).

## 2. Server functions (`src/lib/coordinator.functions.ts`, `coordinator-public.functions.ts`)

- `markJobPayment({ job_id, side: "client" | "driver", amount?, method, reference?, paid_at? })` — coordinator/admin only; upserts the correct set of columns and recomputes status.
- `unmarkJobPayment({ job_id, side })` — clears fields, resets status to `pending`.
- `bulkMarkPayment({ job_ids, side, method, paid_at? })` — one-shot "mark all rows on this statement paid in full".
- `driverMarkPayoutReceived({ job_id, method, reference?, amount? })` — driver-only, only their assigned jobs.
- Extend `buildStatement` and `getDriverStatement` DTOs to return the new fields plus a derived `payment` block per row (`{ status, paid_amount, method, reference, paid_at, marked_by }`).

All writes log to `admin_activity_log` (already auto-logged) and add a `trip_map_events` entry `payment_marked` / `payment_cleared` for the audit timeline.

## 3. Coordinator statements UI (`src/routes/_authenticated/coordinator.statements.tsx`)

- New "Payment" column with a status pill: Paid (green) / Partial (amber) / Unpaid (grey), showing method + date on hover.
- Row action: "Mark paid" → small popover with **Amount**, **Method** (select), **Date paid** (defaults today), **Reference** (text). "Save" calls `markJobPayment`.
- If already paid: "Edit payment" / "Mark unpaid".
- Toolbar: checkbox selection column + **Bulk actions** bar → "Mark selected as paid" (asks method + date, applies full amount to each row).
- Filter chip: **Payment**: All / Unpaid / Partial / Paid (uses the existing `payment_status` filter, extended to include `partial`).
- Totals footer split into **Billed / Received / Outstanding**.

## 4. Driver statements UI (`src/routes/_authenticated/coordinator.my-driving.tsx` and the driver PWA statement view under `m.driver.$token`)

- Same Payment column, but the mark-paid dialog updates the `driver_paid_*` side (i.e. "I received payout for this trip").
- Read-only view of the coordinator's client-payment status.
- Bulk "Mark all shown as received" button.

## 5. Exports

Both PDF and CSV exports include:
- New column: **Payment** (`Paid — Cash — 2026-07-14 — INV-402`, or `Unpaid`)
- Footer totals: Billed / Received / Outstanding
- Optional toggle "Split paid vs outstanding" — renders two tables in the same PDF.

## 6. Realtime

Reuse existing `broadcastJobUpdate`; when payment is marked, coordinator + driver views refresh through the existing `jobs` invalidation hooks so both sides see the update within a second.

## Technical notes (for reviewers)

- New migration adds columns + `partial` to the `payment_status` enum + a trigger that keeps `payment_status` in sync with `paid_amount` vs `price_amount`.
- Driver-side column whitelist is enforced by a `SECURITY DEFINER` function `driver_mark_payout(_job, _amount, _method, _ref)` — the RLS UPDATE policy only allows drivers to call that fn, not free-form updates.
- No changes to trip/dispatch/wait logic. Payment tracking is additive.

## Suggestions to make it better (please confirm)

1. **Weekly "Payment run" view** — group unpaid rows by driver/company with one-click "mark whole run paid".
2. **Auto-reminders** — email/WhatsApp the driver/partner a link to their outstanding statement every N days.
3. **Attach proof** — allow uploading a receipt/screenshot when marking paid (stored in existing storage bucket).
4. **Ledger export** — a monthly CSV per driver with running balance for accountant handover.

Say which of 1–4 you want and I'll fold them in before building.
