# Fix: passenger names missing on portal-created trips

## Root cause (verified against trip #140)

- The guest QR portal booking form (`GuestBookingInput` in `src/lib/portal-hotel.server.ts`) only captures the primary guest name + `pax_count`. Trip #140's `portal_bookings.payload` shows `pax_count: 2` but no names for the 2nd passenger.
- `acceptPortalBooking` in `src/lib/portal.functions.ts` writes only `clientcompanyname = "melchior zammit"` on the job and never inserts into `public.pax`. Result: driver sees 0 passengers to verify.

## What to change

### 1. Portal guest booking form — collect names
- **`src/lib/portal-hotel.server.ts`**
  - Extend `GuestBookingInput` with `pax_names: z.array(z.string().min(1).max(120)).max(20).optional()`.
  - Persist `pax_names` into `payload.pax_names` on `portal_bookings` insert.
- **`src/routes/g.$session.tsx`** (guest mini-portal booking sheet)
  - Add a "Passenger names (one per line)" textarea. Placeholder pre-fills the primary guest name. Auto-grows with `pax_count`.
  - On submit, split textarea by newlines/commas, trim, and send as `pax_names`.

### 2. Accept flow — seed pax rows with placeholder fallback
- **`src/lib/portal.functions.ts` → `acceptPortalBooking`**
  - After job insert, build the passenger list:
    1. Start with `payload.pax_names` (if any).
    2. If length < `payload.pax_count`, pad with the primary guest name (slot 0) and `"Guest 2"`, `"Guest 3"`, … so `list.length === pax_count`.
    3. If `pax_count` missing, use just the primary name.
  - Insert one row per name into `public.pax` with `job_id`, `name`, `status: 'pending'`.
  - Reuse the existing `syncJobPax` helper from `src/lib/coordinator.functions.ts` if it accepts an explicit list; otherwise inline the insert (mirrors `syncJobPax` shape).

### 3. Backfill existing portal jobs
- Migration (data-only, run once via `supabase--insert`):
  - For every `jobs` row where `source LIKE 'portal:%'` and no rows in `pax` for that `job_id`, insert `pax` rows derived from the linked `portal_bookings.payload` — primary name + placeholders up to `pax_count`.

## Non-goals
- No change to non-portal creation paths (AI assistant, manual form, client portal) — those already flow through `syncJobPax`.
- No change to fare/pricing.

## Test plan
1. Create a new guest booking with `pax_count=3` and 2 names entered → accept → job has 3 pax rows (2 real + `"Guest 3"`).
2. Trip #140 after backfill: shows `melchior zammit` + `Guest 2` in the driver's passenger list.
3. Guest booking with 0 names entered + `pax_count=2` → 2 pax rows (primary + `Guest 2`).