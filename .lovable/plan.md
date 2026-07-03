## Post-trip pricing & payment tracking

When a driver marks a trip **Completed**, a summary dialog pops up with the trip stats, a price input, currency, and two payment buttons. The price is stored on the job, visible only to coordinators in the dispatch chain (never to clients or drivers of other companies), and surfaces on the statement export as two new columns.

### 1. Driver post-trip dialog (`m.driver.$token.tsx`)

When the driver taps **Completed**, open `TripSummaryDialog` instead of just flipping status. Contents:

- **Trip summary (read-only)**: from → to, pickup time, actual start (first "en_route" status), actual end (now), total duration, passenger count, no-show count, "Ran late by X min" if reported.
- **Price** number input (2 decimals) + **currency** select (EUR default, USD, GBP — small list, coordinator can extend later).
- Optional **note** field (e.g. "waited 20 min", "extra stop").
- Two big buttons: **💵 Paid by client** and **🧾 Invoice to company**.
- Cancel = keeps status but doesn't finalize price (driver can reopen from the finished-trip strip).

Submitting calls a new server fn `driverFinalizeTrip({ token, job_id, price_amount, price_currency, payment_method, note })` which sets `status='completed'`, writes the price fields, and logs a `trip_messages` entry (`"✅ Trip finalized — €45.00 · Invoice to company"`) so the coordinator sees it in chat.

### 2. Coordinator override

- In `TripDetailsSheet.tsx`, add a **Price & payment** row showing amount + method with an ✏️ edit button.
- Opens a small inline editor calling `coordinatorSetTripPrice({ job_id, price_amount, price_currency, payment_method, note })`.
- Any coordinator in `dispatch_chain_company_ids` can view; only the originating coordinator (`company_id`) OR the current executor can edit. Server enforces this.

### 3. Statement export (`coordinator.statements.tsx`)

Add two new columns to the Excel export:
- **Payment** — "Cash" / "Invoice" / blank
- **Amount** — e.g. "€45.00", blank if not set

Add two filter chips at the top: "Cash only", "Invoiced only". Add a totals row at the bottom of the sheet: total cash, total invoiced, grand total per currency.

### 4. Bulletproof visibility (the important part)

Price fields are **NEVER** returned to:
- Clients (any `/t/$token`, `/c/$token`, `/m/client/$token` route)
- Drivers of other companies (magic-link driver portal only sees their own trips; price is hidden from the driver UI once submitted — the driver enters it and moves on, they don't need to re-see it)
- Public/anon endpoints

Enforcement layers (defense in depth):

1. **DB columns** on `jobs`: `price_amount numeric(10,2)`, `price_currency text`, `payment_method text` (check in `('cash','invoice')`), `price_set_by uuid`, `price_set_at timestamptz`, `price_note text`.
2. **RLS**: no policy changes needed for reads (existing chain-scoped SELECT already covers coordinators). Writes go only through the two SECURITY DEFINER RPCs above — no direct `UPDATE` on price columns from anon/authenticated. Add a trigger `enforce_price_columns_via_rpc` that raises if `price_*` changes and `current_setting('app.price_rpc', true) IS DISTINCT FROM 'on'`; the RPCs set it before updating.
3. **Server functions**: every client-facing fn (`getClientTrip`, `getClientTripStatus`, `listPaxActivityClient`, `getDriverJobs` for the driver token) explicitly **projects columns** — price fields are omitted from the SELECT list, not just filtered client-side. Add a code comment + a unit-style assertion in each fn to prevent regressions.
4. **Trip chat**: the "✅ Trip finalized — €45" message is written to a **coordinator-only** thread (kind `coord`), not the client-visible group thread, so clients never see the amount even in chat history.
5. **AutoRefresh sweep** and any realtime payloads: filter published columns via the same projection.

### 5. Files touched

- Migration: add price columns, trigger, and two SECURITY DEFINER RPCs.
- `src/lib/coordinator.functions.ts` — `coordinatorSetTripPrice`, projection audit on any client-facing readers that live here.
- `src/lib/coordinator-public.functions.ts` — `driverFinalizeTrip`; strip price fields from every anon/token reader.
- `src/routes/m.driver.$token.tsx` — new `TripSummaryDialog`, wire "Completed" through it.
- `src/components/coordinator/TripDetailsSheet.tsx` — Price & payment row + inline editor.
- `src/routes/_authenticated/coordinator.statements.tsx` — new columns, filters, totals.
- `src/lib/features.ts` — optional `trip_pricing` feature flag so admin can disable the whole module per company.

### Open follow-ups (ask before build if you want changes)

- Currency list: EUR/USD/GBP enough, or should coordinators define their own set per company?
- Should the price be **required** to mark a trip completed, or optional (driver can skip and set later)?
- Should "Invoice to company" auto-generate a monthly invoice PDF, or just tag the row for the statement export?
