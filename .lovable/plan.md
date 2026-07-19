## Why it isn't working today

I traced your pasted crew-change email through the assistant and found two concrete gaps — this is not a prompt problem, it's a missing field in the pipeline.

**1. The assistant's draft schema has nowhere to put passenger names.**
`src/lib/coordinator-assist.functions.ts` defines the draft `fields` as:

```
from_location, to_location, date, time,
driver_id, driver_name, vehicle, contact_phone,
from_flight, to_flight, clientcompanyname
```

No `pax`, no `passengers`. So even when the model correctly reads "M. Harris – Master – BA2648 LGW/MLA", it has no legal place to output the name and drops it. On confirm, the client also calls single-trip `createJob` (which has no `pax` param), not `createJobsBulk` (which already accepts `pax: string[]`).

**2. There is no "client note" concept anywhere.**
`clientcompanyname` is a free-text string on every job. There's no clients table and no note store, so nothing to show next to the name.

## Fix — Passenger extraction end-to-end

**Prompt + schema (`coordinator-assist.functions.ts`)**
- Add `pax?: string[]` to the `AssistantDraft.fields` TypeScript type and its Zod parser.
- Update the JSON-shape rules in the system prompt: `pax` = array of passenger names / crew members mentioned for that trip (max 200, ≤ 200 chars each). Explicit example in the prompt using a crew-change email like the one you pasted so the model learns the pattern (10 joiners → 10 create drafts, each with `pax: ["M. Harris – Master", ...]`, plus separate drafts for the hotel transfer and sign-offs).
- Tighten the batch rules: when the pasted message clearly lists multiple people on the SAME flight/date/route (joiners on KM103, sign-offs on KM116), collapse them into ONE draft with all names in `pax`, not one draft per person.

**Confirm path (`CoordinatorAssistant.tsx`)**
- Show a "Passengers (N)" line in each draft card, listing the names (collapsible if >5). Editable via a small "Edit passengers" affordance so the coordinator can add/remove before Confirm.
- In `createDraft` and `confirmBatch`, route to `createJobsBulk` (already accepts `pax`) whenever `fields.pax?.length > 0`. Single-trip with zero pax keeps using `createJob` unchanged.
- `draftFieldSummary` gets a `Passengers` row.

## Fix — Per-client notes

Simplest shape that matches how you actually key clients today (by free-text name):

**New table `client_notes`** (migration):
```
company_id uuid, client_key text (normalized clientcompanyname, case/space-folded),
note text, updated_at timestamptz, PK (company_id, client_key)
```
RLS: read/write scoped to the coordinator's company. GRANT to authenticated/service_role.

**Server fns (`src/lib/client-notes.functions.ts`)**
- `getClientNote({ client_name })` → returns `{ note } | null`.
- `upsertClientNote({ client_name, note })` → writes (note trimmed, empty note deletes the row).
- `listClientNotes()` → all notes for the company (used to hydrate a map so trip lists don't N+1).

**Display — "shown near the client name"**
- New `<ClientNameWithNote>` component: renders `clientcompanyname` + a small amber `📝 note` pill; hover/tap opens a popover with the full note and an "Edit note" button.
- Wire it into:
  - `TripDetailsSheet.tsx` (currently `<SheetDescription>{job.clientcompanyname}</SheetDescription>`)
  - `NewTripsPreviewDialog.tsx` (the AI's own preview cards — so if you paste a crew-change email and Ship Agency Malta Ltd. has a note like "annex 1 needed", it shows on every draft as you confirm)
  - `JobFormDialog.tsx` next to the Client input
  - Dashboard activity rows / trip cards that already print the client name

**AI awareness**
- In `askCoordinatorAssistant`, when the pasted message names a client that has a saved note, inject `CLIENT NOTES: Ship Agency Malta Ltd. → "annex 1 needed"` into the system prompt so the AI can factor it in and mention it in the draft `summary` ("… — annex 1 needed").
- Add a `kind:"client_note_save"` action (mirrors `glossary_save`) so you can teach it in chat: *"Note for Ship Agency Malta: annex 1 needed"* → confirm card that writes the note.

## Out of scope for this change
- Passenger tracking pages / per-pax QR codes.
- Migrating `clientcompanyname` free text to a real clients table (bigger refactor; notes table above is keyed by the same normalized name so it survives that migration later).
- Extracting hotel bookings from the same paste — the AI will still note them in the `summary` / `clarify`, but hotel rooms aren't a trip type yet.

## Verification
After build:
1. Open the assistant, paste your MV Ocean Pioneer email.
2. Expect ~4 batch drafts (joiners KM103 20 Jul → hotel, joiners FR7118/KL1601/etc 21 Jul → vessel, sign-offs by flight, inspectors) each with the correct names in the Passengers list.
3. Add a note "annex 1 needed" to `Ship Agency Malta Ltd.` from any trip's client popover.
4. Paste the same email again → each draft card shows the amber note pill next to the client.
