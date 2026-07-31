# Lovable preview QA test log

## Scope and test data

- Environment: Lovable preview only (`id-preview--39452616-a23d-4f77-ba69-7d9cca7056b0.lovable.app`)
- Test companies: QA Alpha Transport, QA Beta Partners, QA Gamma Overflow
- Test approach: clearly labelled QA data only; no production client or operational data.

## 2026-07-31 - authentication and coordinator smoke test

- **PASS:** QA Alpha Transport and QA Beta Partners sign in successfully with phone number and temporary password.
- **PASS:** The mandatory password-change flow completes successfully.
- **PASS:** Main coordinator pages render without visible application errors or browser console warnings.
- **PASS:** The New trip dialog opens and can be cancelled without creating data.
- **PASS:** Alpha created a provider invite and Beta redeemed it; the resulting connection is active.
- **PASS:** Alpha created QA trip #1 (airport to hotel, one passenger, flight code, pinned locations), priced it at EUR 75.00, dispatched it to Beta, and Beta accepted it.
- **PASS:** Route pin map and traffic/ETA data render in the trip details. Flight tracking fails safely for the deliberately invalid QA123 code and presents the Malta Airport fallback link.

## Defects

### QA-001 - Collaboration invites cannot be created

- **Severity:** Critical
- **Reproduction:** Sign in as QA Alpha Transport -> Collaborate -> New invite -> leave the default Provider mode -> Create invite.
- **Actual result:** The server rejects the request because `edit_jobs`, `create_jobs`, `assign_drivers`, `post_chat`, and `edit_pax` are absent from `permissions`.
- **Expected result:** A provider invite is created with every permission represented as a boolean.
- **Cause:** The page state only initialized the enabled permissions, while the server schema requires all permission keys.
- **Fix:** Initialize every permission key, using `false` for disabled permissions.
- **Verification:** Fixed and verified in Lovable preview: Alpha created a provider invite and Beta redeemed it successfully.

### QA-002 - Native schedule inputs can submit the original default date/time

- **Severity:** High
- **Reproduction:** In Alpha's New trip form, change the visible date/time from the defaults to 2026-08-01 10:30, then create the trip.
- **Actual result:** QA trip #1 was stored and shown in Dispatch as 2026-07-31 09:00, the original defaults.
- **Expected result:** The created record uses the date/time shown when Create is pressed.
- **Cause:** The native date and time inputs only committed through the change handler. In the affected interaction path the visible control updated without the submitted form state being refreshed.
- **Fix:** Commit both controls on `input` as well as `change`, so desktop, mobile, and native picker interactions consistently update the submitted schedule.

### QA-003 - Dispatch history is absent after provider acceptance

- **Severity:** Medium
- **Reproduction:** Alpha dispatches QA trip #1 to Beta; Beta opens Dispatch and accepts it; either party opens the trip details.
- **Actual result:** The dispatch succeeds and Beta receives/accepts the trip, but the Dispatch chain section still displays “No dispatch history.”
- **Expected result:** The chain should show Alpha's dispatch and Beta's acceptance, with timestamps and current executor.

### QA-004 - Receiving partner cannot manage transferred passengers

- **Severity:** High
- **Reproduction:** Alpha creates a trip with one passenger, dispatches it to Beta, and Beta accepts and assigns a driver. In Beta, open the trip details and select **Manage / split passengers**.
- **Actual result:** The details card shows `Passengers (1)` and lists QA Passenger One, but the Manage / split passengers dialog says `No passengers on this trip.`
- **Expected result:** The receiving company can access the transferred passenger record to manage boarding, no-shows, and splitting.
- **Impact:** Provider companies cannot complete passenger-level operations on accepted work; client/driver tracking may show a passenger that the operating company cannot act on.

### QA-005 - Reassignment approval was reported as an immediate assignment

- **Severity:** High
- **Reproduction:** In QA Beta, assign the accepted and en-route QA trip #1 from `QA Beta Driver One` to `QA Beta Partners (me)`.
- **Actual result:** The server correctly keeps the current driver and creates an approval request, but the calendar showed the success message `Assigned`. The My Driving portal consequently still showed no trip, which could be mistaken for a manifest defect.
- **Expected result:** The calendar must say that approval was requested until the current driver approves the reassignment.
- **Fix:** Use the server response's `pending` flag in single and bulk assignment feedback. The driver manifest remains strictly scoped to its assigned driver row.

### QA-006 - Dispatch card contains a button inside a button

- **Severity:** Medium
- **Reproduction:** Open QA trip #1 in the Dispatch board while the invalid `QA123` flight code is visible.
- **Actual result:** The browser console reports a React hydration error because the card's clickable button contains the `fix code` button.
- **Expected result:** The trip card and its inline controls render valid interactive markup without hydration errors.
- **Fix:** Change the clickable card body to a non-interactive container so its inline action buttons are no longer nested inside a button.

## Next scenarios

1. Create and redeem a Gamma invite, then validate reduced-permission sync access and tenant isolation.
2. Exercise reject, recall, and re-dispatch; then verify the repaired dispatch-chain history.
3. Validate public portal booking, client tracking, driver manifest, chat, and status transitions.
4. Exercise driver pricing, trip costs, statements, and payment status.
5. Verify QA-004 after the passenger-transfer defect is repaired, then test onboard/no-show and split-trip flows.
