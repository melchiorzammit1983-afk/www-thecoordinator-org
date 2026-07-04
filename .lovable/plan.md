## Keep system alerts out of the client chat

Currently, driver actions (trip completed, driver rejected, no-show, running late) auto-post a chat message with no `thread_kind`, which defaults to `group` — so the client sees them alongside real conversation. The user wants these alerts private between driver and coordinator, just like prices.

There is already a `driver_coord` thread (driver↔coordinator private tab in `TripChatDialog`) and the client message list filters strictly on `thread_kind = 'group'`, so routing these auto-posts through `driver_coord` hides them from the client while keeping them visible to the coordinator (Driver tab) and to the driver.

### Changes

**`src/lib/coordinator-public.functions.ts`** — add `thread_kind: 'driver_coord'` to the four system inserts posted by driver actions:

1. `completeJobByDriver` (~line 313) — "✅ Trip completed …"
2. `driverRejectJob` (~line 452) — "⚠️ Driver rejected this trip …"
3. `markPaxNoShow` (~line 759) — "🚫 No-show: …"
4. `driverReportLate` (~line 803) — "🕒 Running ~N min late …"

No other logic changes. Client keeps seeing only real driver messages posted through the group chat UI. Coordinator will see these alerts in the private Driver thread (same tab where all driver-only communication already lives).

### Out of scope

- Price proposals (already private via their own panel, never in chat).
- Coordinator↔coordinator (partner) alerts — no such auto-posts to the client thread exist today.
