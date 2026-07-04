
# Implementation Plan — M1–M3 + AI Center + Admin AI Controls + Voice-to-Trip UI

Adds **Milestone 6**. M1–M5 unchanged.

---

## M1 · Traffic + flight schema
`job_route_cache`, `flight_status_snapshots`, denormalised traffic/flight columns on `jobs`. Schema only.

## M2 · Automated driver assignment
`job_assignment_events`, `auto_assign_job()` RPC, `autoAssignJob` server fn, insert trigger, `ai_auto_assign` feature key. Gated by entitlement + `ai_configuration.auto_assign_enabled`.

## M3 · Trip card traffic badges
`TrafficBadge` in trip card, details sheet, job form preview.

## M4 · AI Control & Settings Center (coordinator)
`/coordinator/ai-center` with three sections: automation toggles (`ai_configuration`), Command Bar (`runAiCommand` + `ai_command_log`), Rule Engine (`company_ai_rules`). New `buildSystemPrompt()` helper appends rules to every existing AI system prompt (6 call sites).

## M5 · Admin AI access control
`plans.ai_features jsonb`, `entitlements.override_source`, `get_effective_ai_access` RPC, plan-level AI editor in `admin.pricing.tsx`, per-company "AI access" tab in `CompanyBillingDialog`, `use-features.ts` refactor.

---

## Milestone 6 — Voice-to-Trip button in Bulk Paste modal (NEW)

### 6A. Backend — reuse the existing `aiVoiceNoteToTrip` server fn
Already implemented in `src/lib/coordinator.functions.ts` per the earlier expansion. Confirm its shape supports two inputs:
- Recorded blob: `{ audio_base64: string, mime: string }` (browser recording, WAV preferred per STT knowledge)
- Uploaded file: same shape — reuse the parser, no new fn needed

If the current implementation only accepts one shape, extend the Zod input to accept either, but keep the return type identical to the existing bulk-paste parser: `{ trips: ParsedTrip[], warnings: string[] }` so the modal's existing "review & save" table renders it with zero refactor.

The fn continues to:
- Verify `ai_voice_to_trip` entitlement + `spend_points`
- Call Lovable AI STT (`openai/gpt-4o-mini-transcribe`, streaming SSE) → transcript
- Feed transcript into the existing text-extraction pipeline (same one bulk-paste uses)
- Return parsed trips + transcript for display
- Run system prompt through `buildSystemPrompt()` (from M4) so coordinator's custom rules apply automatically

### 6B. Frontend — new component `src/components/coordinator/VoiceToTripButton.tsx`

Two-mode button placed at the top of the bulk-paste modal, above the textarea:

- **Record button** (mic icon, primary variant)
  - Uses Web Audio API + `MediaRecorder` fallback, per the STT knowledge file: capture PCM via `getUserMedia`, encode a complete WAV on stop (avoids Safari fragmented-mp4 and MediaRecorder header issues).
  - Recording state UI: red pulse dot, timer (mm:ss), "Stop" button.
  - Guard: reject blobs < 2 KB with toast "Recording was empty — please try again."
  - Max recording length: 5 min soft cap with visual warning at 4:30.

- **Upload button** (paperclip icon, outline variant)
  - `<input type="file" accept="audio/*">`
  - Client-side size cap: 20 MB (matches existing platform limit).
  - Client-side format check: reject if MIME doesn't start with `audio/`.

Both paths funnel into the same async handler:
1. Convert to base64 (or upload to a signed URL if we later need > 20 MB — out of scope now).
2. Wrap in `<FeatureGate feature="ai_voice_to_trip">`. If gated/out of points, the existing gate renders the "Buy points" CTA and the button is disabled.
3. Show inline progress: "Transcribing…" → "Extracting trips…" (two-phase spinner from the SSE stream).
4. On success:
   - Populate the existing bulk-paste "Parsed trips" review table with the returned trips.
   - Show the transcript in a collapsible section above the table ("Show transcript ▾") so the coordinator can spot-check what the AI heard.
   - Any `warnings` render as amber alert chips (e.g. "Couldn't determine pickup time for trip 2").
5. On error: toast with the server-side message; recording preserved so the user can retry without re-recording. 429/402 rendered with the standard billing/back-off messaging.

### 6C. Integration point
`src/components/coordinator/JobFormDialog.tsx` (which hosts the bulk-paste flow — verified via file listing) gets a small header row above the paste textarea:

```
[🎤 Record voice note] [📎 Upload audio]   —or—   paste text below
```

No structural changes to the existing bulk-paste review UI: the voice path just pre-fills the same parsed-trips table via `setParsedTrips(response.trips)`.

### 6D. Points & rules wiring
- Cost taken from `ai_feature_costs.ai_voice_to_trip` (already seeded in earlier migration).
- Charged once per successful transcription+extraction, not on failure.
- `company_ai_rules` (M4) injected into the extraction prompt so rules like "trips before 06:00 are always airport pickups" apply to voice input identically to text input.

### 6E. Safety
- Never send raw audio to the client's browser console or logs.
- Recording permission handled per browser (`getUserMedia` promise); denial shows a helpful message with a link to the browser's mic-permission settings.
- Stop all `MediaStream` tracks + close `AudioContext` on unmount to prevent mic-indicator staying on.

---

## Order of operations
```text
M1 → M2 → M3 → M4 → M5 → M6
```
Each shippable independently; M6 depends on M4's `buildSystemPrompt` helper being wired into `aiVoiceNoteToTrip`, but the button UI can be built in parallel.

## Still open (blocking M2/M4 code, NOT blocking M6 UI)
Four earlier questions on coordinate resolution, bulk-execute confirm threshold, which AI features receive custom rules, and which job sources auto-fire the assign trigger.

Approve to start with M1 migration — or say "start with M6" and I'll ship the Voice-to-Trip button first since its backend already exists.
