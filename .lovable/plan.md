## Goal
Catch silent passenger-parsing failures in the AI trip flow, tell the coordinator what happened, and verify the `pax` rows actually landed in the database.

## Problem
Right now `toDraft` in `src/lib/coordinator-assist.functions.ts` accepts whatever the model returns. If it yields `[]`, one merged string, or a passenger count that disagrees with the trip's stated `pax_count`, the draft confirms silently and the driver sees an empty passenger list. There is also no post-save assertion that `syncJobPax` wrote the rows.

## Changes

### 1. Parse-time validation (`src/lib/coordinator-assist.functions.ts`)
- After `toDraft` builds `pax`, compute `parseWarnings` per draft:
  - `no_pax_extracted` — message text contains passenger cues (regex: `pax|passenger|guest|name[s]?[:：]|\b\d+\s*(pax|pers|adult)`) but `pax.length === 0`.
  - `count_mismatch` — `fields.pax_count` set and `pax.length !== pax_count`.
  - `single_blob` — exactly one entry longer than 60 chars or containing 3+ separators (likely unsplit).
- Return `warnings: string[]` on each draft in the assistant response payload.

### 2. Confirmation UI (`src/components/coordinator/CoordinatorAssistant.tsx`)
- Render an amber warning strip on trip cards with `warnings.length > 0`, listing human-readable messages ("No passenger names detected — driver will see an empty list", "Expected 3 passengers, parsed 2", etc.).
- Add an inline "Edit passengers" affordance that opens the existing pax editor before confirming.
- Block one-click "Confirm all" when any card has `no_pax_extracted` or `count_mismatch`; require per-card confirm so the coordinator sees the warning.

### 3. Post-save verification (`src/lib/coordinator.functions.ts`)
- After `syncJobPax` in `createJob`/`updateJob`, re-select `count(*) from pax where job_id = ?` and compare to the requested list length.
- On mismatch, throw a typed error so the assistant surfaces "Saved trip but passenger sync failed (expected N, stored M)" instead of a silent success.

### 4. Toast feedback
- `CoordinatorAssistant` surfaces `sonner` success toast including passenger count ("Trip #123 saved · 3 passengers") so the coordinator gets immediate confirmation the names persisted.

### 5. DB spot-check
- After deploying, run a read query against `pax` for the last ~20 AI-created jobs to confirm rows exist and match `jobs.pax_count`; report any drift.

## Out of scope
- No changes to the AI prompt itself or to manual (non-AI) trip creation beyond the shared verification in `createJob`.
- No new tables or migrations.

## Question before I build
Should the "Confirm all" button be **blocked** on warnings (safer, forces review) or just **flagged** with a confirm-anyway dialog (faster)? Default in the plan above is blocked for `no_pax_extracted` / `count_mismatch` only.
