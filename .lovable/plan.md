## 1) SOS attribution — per passenger + on the Live Map

**Backend (`src/lib/coordinator.functions.ts`)**
- `listSosForJob({ job_id })` → open SOS events for a job: `id, pax_id, pax_name, latitude, longitude, created_at, acknowledged_at`.
- `listActiveSosPoints({ since_minutes })` → open SOS across the coordinator's visible jobs for the main calendar Live Map.

**TripDetailsSheet — passenger list**
- Query `listSosForJob` (20s refetch + realtime on `client_sos_events`).
- Match to pax by `pax_id`; fall back to case-insensitive `pax_name`. Unmatched → a "Group SOS" row pinned at top.
- Red pulsing **SOS** badge next to that passenger's name with time-ago and a **Dismiss** action (see §3).

**DriverLiveMap (`src/components/coordinator/DriverLiveMap.tsx`)**
- New `sosPoints?: SosPoint[]` prop. Renders red pulsing circle markers above driver markers. InfoWindow: `SOS · {pax_name}`, time-ago, **Dismiss** button.
- SOS points included in auto-fit bounds so the map shows both the driver and the person who pressed SOS.

**Wire-up**
- `TripLiveLocation` in `TripDetailsSheet.tsx` passes job-scoped SOS points.
- Main calendar Live Map in `coordinator.calendar.tsx` passes company-wide SOS points.

## 2) Fix: `/coordinator/my-driving` shows every unassigned trip

Root cause in `src/lib/coordinator-public.functions.ts` (~lines 58–70): for virtual `coordinator`/`partner` drivers the code intentionally falls back to a company-wide OR filter, so all unassigned company jobs show up in the manifest.

**Fix**
- Always filter by `driver_id = link.subject_id` when the link has a `subject_id`, including virtual drivers. Drop the `isVirtualDriver` fallback branch (company-scope branch remains only for links without a `subject_id`).
- Result: My Driving shows only trips explicitly assigned to the coordinator's own virtual driver row.

Apply the same fix to the sibling queries at ~lines 228 and ~440 (`driver_id` filters gated by the same `isVirtualDriver` flag) so status updates and job-action guards stay consistent.

## 3) How the coordinator dismisses SOS (and re-press works)

**Model**
- SOS uses one row per press in `client_sos_events`. "Open" = `acknowledged_at IS NULL`. Dismissing sets `acknowledged_at = now()`, `acknowledged_by = auth.uid()`. That row is closed; a new press by the client creates a **new** row that is open again — so the client can always press again and the coordinator sees the fresh alert.

**Backend**
- Reuse existing `acknowledgeSosCoord({ sos_id })`.
- Add `acknowledgeAllSosForJob({ job_id })` — batch-dismiss all open SOS rows for a job (used by the header "Dismiss all" button). Authorized via `assertJobInCompany`.

**UI — coordinator side**
- **Passenger row Dismiss** (in `TripDetailsSheet`): calls `acknowledgeSosCoord`, then invalidates `["sos-job", job_id]`, `["card-signals"]`, and `["sos-active"]`.
- **Map InfoWindow Dismiss**: same call.
- **Sheet header Dismiss all** (visible only when >1 open SOS on the trip): calls `acknowledgeAllSosForJob`.
- **Toast + siren**: the existing SOS toast in `coordinator.calendar.tsx` gets a **Dismiss** action button; auto-scroll to the card remains. Stop the alert beep loop when every SOS on that job is acknowledged.
- **Card corner**: existing `signal-corner-sos` clears automatically once `getCardSignalsCoord` no longer sees `sos_open` (already the case — no change needed).

**Client side — re-press guarantee**
- `t.$token.tsx` SOS button already inserts a new row per press. Confirm the button is **not** disabled by prior acknowledgement, and shows: "Emergency signal sent — press again if you still need help." No throttle beyond the existing per-device debounce for accidental double-taps (a few seconds).
- Nothing on the client watches `acknowledged_at` to gray out the button.

## Files touched
- `src/lib/coordinator.functions.ts` — `listSosForJob`, `listActiveSosPoints`, `acknowledgeAllSosForJob`.
- `src/lib/coordinator-public.functions.ts` — remove virtual-driver company fallback in the 3 driver-scoped queries.
- `src/components/coordinator/DriverLiveMap.tsx` — SOS markers + Dismiss in InfoWindow.
- `src/components/coordinator/TripDetailsSheet.tsx` — per-pax SOS badge + Dismiss + Dismiss all header + wire sosPoints into map.
- `src/routes/_authenticated/coordinator.calendar.tsx` — company-wide sosPoints on main map + Dismiss action on the SOS toast.
- `src/routes/t.$token.tsx` — confirm SOS button always enabled with correct wording.
- `src/styles.css` — small red-pulse keyframe for the SOS map marker if needed.

No schema, RLS, or migration changes required.
