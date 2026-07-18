## Goal

Support any combination of Airport / Seaport / Hotel on either side of a trip (e.g. airport→vessel, vessel→hotel), have the AI validate the trip *before* it creates it (flight code, vessel name, hotel resolution, missing fields), and simplify the mobile New Trip form into a step-by-step wizard.

---

## 1. Airport ↔ Vessel: per-side tracking

Today `tracking_kind` is a single value per trip ("flight" OR "vessel") even though `from_flight` and `to_flight` are separate strings. That prevents `airport → vessel` (flight code on the pickup side, ship name on the drop-off side).

**Changes**
- Introduce **per-side "endpoint type"** in the form: each side (From / To) is one of `airport | seaport | hotel | custom`.
- Reuse the existing `from_flight` / `to_flight` string columns:
  - `airport` side → holds the flight code (e.g. `KM123`)
  - `seaport` side → holds the vessel name (e.g. `MSC World Europa`)
  - `hotel` / `custom` → left blank
- Keep the existing `tracking_kind` column but derive it: if either side is `seaport` and no `airport` side, `vessel`; else `flight`. Both sides can carry a code; live-status refresh will run per side (small extension to `refreshFlightStatus` to accept `side: "from" | "to"`). Backwards compatible — old trips keep working.
- Address input on each side stays `AddressAutocomplete`, but with a **type chip row** above it (Airport / Seaport / Hotel / Custom) that biases the Google Places query (`types=airport` / `types=port,marina` / `types=lodging`) and swaps the flight-vs-vessel input label + placeholder.

---

## 2. AI pre-validation before creating a trip

Runs inside the assistant's existing draft/batch flow, before the confirm card is shown. Each check attaches a colored chip to the affected field on the draft card. Coordinator can still edit and confirm.

**Checks**
1. **Flight lookup** — for any `airport` side with a flight code, call the existing `refreshFlightStatus` path and compare scheduled arrival/departure to the booked time. Warn if delta > 30 min. Surface terminal + status.
2. **Vessel lookup** — for any `seaport` side with a vessel name + date, call the existing Gemini vessel-lookup path (same infra used by `refreshFlightStatus` with `tracking_kind = "vessel"`). Warn if no confident match, or ETA/ETD mismatches the booked time.
3. **Hotel / venue resolution** — for `hotel` sides, run one `resolveAddresses` pass. If Places returns >1 candidate with similar score, mark **ambiguous** and let the AI ask a short inline follow-up ("Which Hilton — St Julian's or Malta Airport?"). If clearly resolved, silently attach `place_id / lat / lng / display_name`.
4. **Missing-field prompts** — if `pax_count`, `contact_phone`, or `clientcompanyname` is missing, AI asks *one* short follow-up in chat before drafting.

**Ambiguity policy** (per your answer): AI **asks inline in chat only when truly ambiguous** (multiple equally-good matches, or flight code returns nothing on that date). Otherwise it drafts with a **yellow "check this" chip** on the guessed field, so the coordinator can approve or fix in one tap.

**Where it lives**: extend `parseAndDraftFromText` / `parseAndDraftBatch` in `src/lib/coordinator-assist.functions.ts` to run the validators after parsing and return `warnings: [{field, level: "ambiguous"|"mismatch"|"unresolved", message}]` on the draft/batch payload. Render those chips on the draft cards in `CoordinatorAssistant.tsx`.

---

## 3. Mobile New Trip form — 3-step wizard

Current form is one long screen — too many fields for a 375px viewport. Split into a stepper:

```text
Step 1 — WHO       Step 2 — WHERE          Step 3 — WHEN
─────────────      ────────────────────    ─────────────
Passenger name(s)  From: [type chips]      Date
Pax count (+/-)    From: address           Time
Phone              From: flight/vessel #   Vehicle
Client company     To:   [type chips]      Notes
                   To:   address
                   To:   flight/vessel #
```

- Sticky bottom bar with **Back / Next**; step 3 button is **Create trip**.
- Progress dots at the top (1 / 2 / 3).
- Bigger tap targets (min 44px), full-width native date/time inputs, `+` / `−` buttons for pax count.
- Address field opens a **full-screen sheet** on mobile (already how `AddressAutocomplete` behaves; we'll just enlarge the trigger).
- On desktop the form stays a single scrolling panel — the wizard is a mobile-only layout swap keyed off `useIsMobile()`. All existing single-trip business logic in `JobFormDialog.tsx` stays; only the render layout changes.

---

## Technical details

**Files touched**
- `src/components/coordinator/JobFormDialog.tsx` — add `EndpointType` state per side, type-chip row, mobile wizard layout, per-side vessel/flight input label swap.
- `src/lib/coordinator-assist.functions.ts` — validator pipeline after parse: flight check, vessel check, hotel resolve, missing-field detector. Attach `warnings` to draft/batch payloads.
- `src/components/coordinator/CoordinatorAssistant.tsx` — render warning chips on draft / batch cards; support inline clarifying-question turn.
- `src/lib/parse-trips.ts` — infer endpoint type per side from parsed hints (flight code → airport, "MSC/Costa/..." + "berth/port" → seaport, else hotel/custom).
- `src/lib/coordinator.functions.ts` — accept an optional `from_endpoint_type` / `to_endpoint_type` on create/update (stored as-is for later use; not required by DB). No migration needed if we derive `tracking_kind` from the two sides at save time.

**No DB migration required** for step 1 — we reuse `from_flight` / `to_flight` / `tracking_kind`. If you later want per-side tracking kind persisted, we'd add two nullable text columns; skipped for this pass to keep it small.

**Reused infra**
- `AddressAutocomplete` + `resolveAddresses` for hotel/venue resolution.
- Existing `refreshFlightStatus` (Gemini + Google search grounding) for both flight and vessel checks — already supports `tracking_kind: "flight" | "vessel"`.
- Existing meter `assistant_trip_action` for confirms; validation reads are free (no extra points) except when flight/vessel live lookup fires — those already meter under `flight_vessel_tracking`.

**Out of scope for this pass** (call out if you want them added)
- Persisting per-side endpoint type as its own DB columns.
- Vessel port/berth as a structured field separate from the address.
- A "recent places" quick-pick list in the mobile address sheet.
