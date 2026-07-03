## Problem

Trip time drifts by the Malta UTC offset (+1 or +2h) between the coordinator and the driver/client apps.

Example: coordinator creates a 09:00 trip → driver's card shows 11:00.

## Root cause

`makePickupIso` in `src/lib/coordinator.functions.ts` stores the entered wall‑clock time as if it were UTC:

```ts
const pickup = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss || 0));
```

So 09:00 Malta gets written to the DB as `09:00Z`. The coordinator screens happen to look right because they render the raw `job.time` string, but the driver and client screens render `pickup_at` with `new Date(pickup_at).toLocaleTimeString()`, which converts to the device's local zone — in Malta (UTC+2 summer) that's 11:00.

The same UTC‑as‑local mistake exists in:
- `combineDateAndTime` (flight status times) — `coordinator.functions.ts` ~L1020
- `coordinator-public.functions.ts` public booking create (~L571) and client booking create (~L1072)

The driver/client renderers also never pin the display zone to Malta, so a driver whose phone is on a different timezone would see yet another time even after the storage bug is fixed.

## Fix

Two coordinated changes: store correctly, and always display in Malta time.

### 1. Store `pickup_at` as Malta wall‑clock → correct UTC

Add a shared helper (DST‑safe, uses `Intl` to derive the Europe/Malta offset for the given date):

```ts
// src/lib/time.ts
export function maltaWallTimeToUtcIso(date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm, ss = 0] = time.split(":").map(Number);
  // Naive UTC guess, then adjust by Malta's offset at that instant.
  const guess = Date.UTC(y, mo - 1, d, hh, mm, ss);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Malta", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const asMalta = Date.UTC(get("year"), get("month") - 1, get("day"),
                           get("hour"), get("minute"), get("second"));
  const offsetMs = asMalta - guess;           // Malta − UTC at that instant
  return new Date(guess - offsetMs).toISOString();
}

export const MALTA_TZ = "Europe/Malta";
export function formatMaltaDateTime(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString([], { ...opts, timeZone: MALTA_TZ });
}
export function formatMaltaTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", timeZone: MALTA_TZ,
  });
}
```

Replace every naive `Date.UTC(y, mo-1, d, hh, mm)` pickup construction with `maltaWallTimeToUtcIso`:

- `src/lib/coordinator.functions.ts` — `makePickupIso` (L40) and `combineDateAndTime` (L1020, use for flight scheduled/estimated stamps)
- `src/lib/coordinator-public.functions.ts` — public booking create (~L571) and client booking create (~L1072)

### 2. Always render `pickup_at` in Malta time

Swap `new Date(pickup_at).toLocaleTimeString(...)` / `toLocaleString(...)` calls to use `formatMaltaTime` / `formatMaltaDateTime` (or add `timeZone: "Europe/Malta"` inline) in:

- `src/routes/m.driver.$token.tsx` — L326, L329
- `src/routes/m/client/$token.tsx` — any `pickup_at` labels
- `src/routes/t.$token.tsx` — L169
- `src/components/coordinator/TripDetailsSheet.tsx` — flight time labels (L526, L530, L536)
- `src/routes/_authenticated/coordinator.calendar.tsx` — `when` labels at L1011‑1013, L1522‑1524, L1564‑1566, L1822‑1824

Coordinator lines that already show raw `job.time?.slice(0,5)` stay as‑is — they're the authoring string and remain correct.

### 3. Backfill existing rows (data migration)

Existing `pickup_at` values are off by the Malta offset. Rebuild them from the authoritative `(date, time)` columns so old trips display the same time on every screen after deploy:

```sql
UPDATE public.jobs
SET pickup_at = (
  ((date::text || ' ' || time::text) AT TIME ZONE 'Europe/Malta')
)
WHERE date IS NOT NULL AND time IS NOT NULL;

UPDATE public.client_bookings
SET pickup_at = (
  ((date::text || ' ' || time::text) AT TIME ZONE 'Europe/Malta')
)
WHERE date IS NOT NULL AND time IS NOT NULL;
```

(Postgres `AT TIME ZONE 'Europe/Malta'` on a naive timestamp treats the value as Malta local and returns the correct UTC `timestamptz` — DST‑correct.)

## Verification

1. Create a new trip at 09:00. On coordinator, driver portal, and client portal it must read 09:00.
2. Repeat with a trip in the opposite DST window (e.g. a January date) to confirm winter offset.
3. Open a historical trip after the backfill: `time` column and displayed pickup should match on all three surfaces.
4. Set the driver device timezone to UTC and reopen — driver card still shows 09:00 (Malta pin).

## Files changed

- `src/lib/time.ts` (new)
- `src/lib/coordinator.functions.ts`
- `src/lib/coordinator-public.functions.ts`
- `src/routes/m.driver.$token.tsx`
- `src/routes/m/client/$token.tsx`
- `src/routes/t.$token.tsx`
- `src/components/coordinator/TripDetailsSheet.tsx`
- `src/routes/_authenticated/coordinator.calendar.tsx`
- One SQL migration for the `pickup_at` backfill
