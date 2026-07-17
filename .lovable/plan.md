## Goal

Trim the driver and coordinator apps down to the essentials. Keep all existing trust/payout/audit plumbing untouched — only hide or remove the UI surfaces and their entry points.

## 1. Remove Emergency Override (UI only)

Keep `job_emergency_overrides` table, `emergencyOverrideJobStatus` server function, and `src/lib/emergency-override.ts` intact so historical records and payout logic stay valid.

Remove from UI:
- Delete the Emergency Override button + dialog mount in `src/routes/m.driver.$token.tsx`.
- Delete component file `src/components/driver/EmergencyOverrideDialog.tsx`.
- Remove any help/docs references to Emergency Override in the driver guide article (`src/content/help/articles/driver-guide.tsx`) if present.

The server function stays callable (unused) so any pending mobile builds don't crash.

## 2. Remove driver-initiated cancellation of a trip

Scope confirmed as "when the driver cancelled the trip" — the driver's ability to cancel/decline an accepted trip.

- Remove the cancel-trip action + confirmation from `src/routes/m.driver.$token.tsx` (driver manifest actions).
- Leave coordinator-side cancellation intact — coordinator remains the only actor who can cancel.

## 3. Remove cancellation-request flows (driver + client/portal)

Driver side:
- Remove any "Request cancellation" button from the driver manifest and from `src/components/driver/CoordChangeRequestsPanel.tsx` (cancellation intent only — keep other change-request types like time/location if they exist there; if the panel is exclusively cancellation, remove the panel mount and file).
- Remove the coordinator inbox surface for driver cancellation requests in `src/components/coordinator/TripDetailsSheet.tsx` and anywhere `job_coord_change_requests` cancellation types are rendered.

Client/portal side:
- Remove the "Request cancellation" action from `src/routes/portal.$token.tsx` and `src/routes/api/public/portal/$token/change-requests.ts` handler (reject cancellation type with 410 Gone; keep endpoint for other change types).
- Remove the cancellation UI in `src/components/client/EditBookingDialog.tsx` if present.

Database rows in `job_coord_change_requests` and `portal_change_requests` are left in place; only new cancellation requests are blocked.

## 4. Auto-hide completed trips

Apply a `status NOT IN ('completed','cancelled')` filter at these read sites (dispatch list already filters; extend to the rest):

- **Coordinator calendar** (`src/routes/_authenticated/coordinator.calendar.tsx`) — default view hides completed/cancelled; add a "Show completed" toggle in the filter bar so history stays reachable.
- **Driver manifest** (`src/routes/m.driver.$token.tsx`) — filter completed jobs from the active list immediately after `status = completed`. Keep a collapsible "Completed today" section (count only, expand to view) so the driver can still confirm what they finished.
- **Coordinator dashboard recent activity** (`src/routes/_authenticated/coordinator.index.tsx` → `getDashboardActivity`) — exclude completed/cancelled from the "recent trips" feed; keep them counted in the KPI tiles.

## Suggestions to make it better (my recommendations, please confirm before I include)

1. **Single driver status pill flow** — with override + cancel gone, collapse the driver bottom bar to one sticky primary CTA per state (On the way → Arrived → Passenger on board → Complete). Everything else moves into a "…" overflow.
2. **Undo bar instead of confirmations** — when a driver taps Complete or a coordinator marks a trip done, show a 5-second "Undo" toast rather than a modal. Faster in the field, still safe.
3. **"Completed today" strip** on the driver home — one-line summary (count, total wait minutes, earnings) so hiding completed trips doesn't feel like losing information.
4. **Coordinator calendar "Show completed" toggle** persisted per user in localStorage so power users don't have to re-enable it every session.
5. **Help center prune** — remove the Emergency Override section from the driver guide so docs match the app.

## Technical notes

- No database migrations. All four changes are frontend + one server route guard (portal cancellation endpoint returning 410).
- `emergencyOverrideJobStatus` and `job_emergency_overrides` table remain — unreferenced from UI but callable.
- Filter for completed trips uses existing `status` column; no schema changes.
- Realtime subscriptions on `jobs` keep working; the client-side filter simply drops completed rows on receipt.

## Out of scope

- Coordinator status override (`CoordinatorStatusOverride.tsx`) stays — user confirmed the "approve" removal was about driver cancellation, not coordinator overrides.
- Trust/payout/audit event pipeline untouched.
- Boarding-approval flow untouched.

Confirm the 5 suggestions above (accept all / pick some / skip) and I'll implement.
