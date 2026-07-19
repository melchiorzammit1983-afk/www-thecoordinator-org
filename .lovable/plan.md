
## Goal

Three tightly related fixes:

1. When an admin switches a feature OFF for a company, the coordinator UI must not show any tab, quick action, or button for it.
2. Add a master "Turn everything OFF (keep only the How-to Guide)" control in the admin Features dialog, plus a one-click "Turn all AI OFF".
3. When AI is off, the classic (non-AI) Paste-bulk tab in the New Trip dialog comes back exactly like before.

---

## 1. Close the remaining gaps for admin feature switches

Sidebar (`src/routes/_authenticated/coordinator.tsx`) and mobile tab bar (`src/components/mobile/MobileTabBar.tsx`) already filter by `useFeatures()`. The remaining places that still render controls for disabled features:

- Dashboard quick actions on `src/routes/_authenticated/coordinator.index.tsx` (New trip / Ask AI / Chat / Pending / etc.) — wrap each with `<IfFeature feature="…">` (or hide the AI ones when no AI feature is enabled).
- `src/components/coordinator/CoordinatorAssistant.tsx` FAB — already checks `ai_coordinator_assist`, but also hide it when the master "everything off" switch is on (see §2).
- `src/components/coordinator/AiAutoCoordinateButton.tsx` and `VoiceToTripButton.tsx` — already gated, verify they render nothing (not a locked panel) when disabled; switch from `FeatureGate` to `IfFeature` where appropriate so admins-off truly hides them.
- Calendar header AI helpers (Auto-coordinate, Ask AI on cards) — wrap in `IfFeature`.
- "Paste bulk" tab in `JobFormDialog` — see §3.

Rule going forward: any UI tied to a `FeatureKey` uses `<IfFeature>` for hard-hide (admin-off = invisible), and `<FeatureGate>` only for in-plan features that hit the wallet.

## 2. Master switches in the admin Features dialog

In `src/components/admin/FeatureEntitlementsDialog.tsx`, add a compact header block above the per-feature list:

- **Turn all AI OFF** — bulk-sets every `AI_FEATURE_KEYS` entitlement to `enabled=false` for this company. One click, no duration.
- **Kill switch: everything off (keep Help only)** — bulk-sets every `FEATURE_CATALOG` entry to `enabled=false`.
- **Restore defaults** — clears all overrides for this company (calls `clearFeatureEntitlement` per key).

Implementation:
- Add a `bulkSetFeatureEntitlements` server function in `src/lib/admin.functions.ts` that takes `{ company_id, features: {key, enabled}[] }` and upserts them in one call (reuses existing per-row logic + audit log).
- Buttons in the dialog call it, then invalidate `["feature-entitlements", company.id]`.
- No new tables. Existing `company_feature_entitlements` + `useFeature()` already do the reactive fan-out.

Effect on the coordinator:
- With the kill switch on, the sidebar/mobile tab bar filters already remove every gated route. Non-gated routes (Dashboard, Billing, Refer, Address & Map, AI Center) — the dashboard becomes a "your workspace is paused" view (see §2b) and AI Center hides itself (its `anyAiEnabled` check already handles that).
- The public `/help` route is outside `_authenticated`, so it's untouched by the kill switch. That satisfies "keep only the how-to guide".

### 2b. Paused-workspace state

When `features` is loaded and every `FeatureKey` in `FEATURE_CATALOG` is `false`, `coordinator.index.tsx` renders a single card: "Your workspace is paused by admin — visit the Help Guide" with a link to `/help`. No quick actions.

## 3. Restore non-AI Paste-bulk when AI is off

`src/components/coordinator/JobFormDialog.tsx` currently hard-codes `const bulkEnabled = false;`. Replace with:

```ts
const bulkPasteFeature = useFeature("bulk_paste");
const aiExtraction   = useFeature("ai_extraction");
const bulkEnabled    = bulkPasteFeature; // tab shown whenever admin allows it
```

Inside `BulkForm` (further down the same file), branch on `aiExtraction`:
- `aiExtraction = true` → keep current AI-assisted flow (existing behaviour).
- `aiExtraction = false` → use the classic regex parser already in `src/lib/parse-trips.ts` (no server call, no points deducted, no clarify step). This is the "like it used to be" path.

So the matrix is:
- AI on, bulk_paste on  → tab shows, AI parsing.
- AI off, bulk_paste on → tab shows, local parser only.
- bulk_paste off       → tab hidden entirely (already handled by `bulkEnabled`).

## Files touched

- `src/lib/admin.functions.ts` — add `bulkSetFeatureEntitlements`.
- `src/components/admin/FeatureEntitlementsDialog.tsx` — master switches UI + wiring.
- `src/components/coordinator/JobFormDialog.tsx` — restore `bulk_paste` gating; branch BulkForm on `ai_extraction`.
- `src/routes/_authenticated/coordinator.index.tsx` — wrap quick actions in `IfFeature`; paused-workspace fallback.
- `src/routes/_authenticated/coordinator.calendar.tsx` — wrap remaining AI helpers in `IfFeature`.
- `src/components/coordinator/AiAutoCoordinateButton.tsx`, `VoiceToTripButton.tsx` — return `null` when disabled instead of locked panels.

No DB migrations. No changes to `useFeature`/`useFeatures` semantics.

## Out of scope

- Reworking the Help page itself.
- Per-user (vs per-company) feature toggles.
- Changing pricing/wallet behaviour.
