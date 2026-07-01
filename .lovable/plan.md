## Phase 3 — Client Portal (`src/routes/m/client/$token.tsx`)

Magic-link auth already resolves via `getClientBookings` in `coordinator-public.functions.ts` (subject_label scoping). Extend that flow with edit/cancel and recurring booking creation.

### Server functions (append to `src/lib/coordinator-public.functions.ts`)
1. `updateClientBooking({ token, booking_id, changes })`
   - Resolve magic link (kind=client). Scope changes to `link.company_id` and (if present) `link.subject_label` email.
   - Load booking's `pickup_at`. If `pickup_at - now() > 2h` → UPDATE `client_bookings` directly.
   - Else → INSERT into `client_booking_modifications` with `requested_changes` JSON and `status='pending'`; set booking `status='modification_pending'`. Return `{ mode: 'direct' | 'pending' }`.
2. `cancelClientBooking({ token, booking_id })` — same 2h split; direct sets `status='cancelled'`, else inserts modification with `{ action: 'cancel' }`.
3. `createRecurringBookings({ token, weekdays[0-6], time HH:MM, from, to, name, surname, room_number? })`
   - For next 7 days, if `getDay()` ∈ weekdays, insert one `client_bookings` row per day with computed `pickup_at` (UTC = local date+time as ISO). Returns count.

Use publishable client (RLS allows anon insert/update on client_bookings? Check — currently policies scope by company). Since magic-link flow is server-verified, use `supabaseAdmin` inside handler (`await import('@/integrations/supabase/client.server')`) after validating the token — safer than opening anon policies.

### UI (`src/routes/m/client/$token.tsx`)
- Add per-booking Edit/Cancel buttons opening a dialog with time/from/to fields.
- On save, call `updateClientBooking`. Toast success text differs by returned mode.
- "Setup recurring trip" button → dialog: weekday checkboxes, time input, from/to, name/surname/room. Submit → `createRecurringBookings`.
- Refresh list via `queryClient.invalidateQueries`.

## Phase 4 — Driver Interface (`src/routes/m.driver.$token.tsx`)

Rewrite existing manifest view with mobile-first execution UI.

### Server functions (append to `src/lib/coordinator-public.functions.ts`)
1. `updateJobStatus({ token, job_id, status })` — validate driver token owns job, update `jobs.status` (enum: pending/en_route/arrived/in_progress/completed). Uses `supabaseAdmin` after token check.
2. `markPaxOnboard({ token, job_id, pax_id, method: 'qr'|'manual' })` — set `pax.status='onboard'`, `boarded_at=now()`, `boarded_method=method`. Reject manual when `jobs.qr_strict_mode=true`.

### Migration
Add `status` column values already exist? Check `jobs.status` enum — extend with `en_route, arrived, in_progress` if missing. Add `pax.boarded_at timestamptz`, `pax.boarded_method text` if missing.

### UI
- Sort jobs today by `pickup_at`, large cards, big status buttons (En route → Arrived → In progress → Completed).
- "Open" button → Trip Execution sheet:
  - Passenger list with checkboxes / onboard badges.
  - QR scanner via `@zxing/browser` (BrowserMultiFormatReader on user-facing camera). Payload = `pax_id`. On decode → `markPaxOnboard`.
  - "Manually confirm" button per pax, hidden when `qr_strict_mode`.
  - Deep-link "Open in Maps" → `https://www.google.com/maps/dir/?api=1&destination=<encoded to_location>`.
- Keep existing accept-trip / approve-deletion buttons.

### Packages
- `bun add @zxing/browser @zxing/library`

## Files touched
- migration: extend jobs status enum + pax columns
- `src/lib/coordinator-public.functions.ts` (append 5 fns)
- `src/routes/m/client/$token.tsx` (rewrite with actions + recurring dialog)
- `src/routes/m.driver.$token.tsx` (rewrite with execution sheet + QR scanner)
- new `src/components/driver/QrScanner.tsx`
- new `src/components/client/RecurringDialog.tsx`, `src/components/client/EditBookingDialog.tsx`

Charging: none of these new fns hit `charge_feature`; QR strict mode / tracking were charged at job creation.
