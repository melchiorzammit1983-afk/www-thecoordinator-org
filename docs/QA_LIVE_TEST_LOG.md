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

### QA-002 - Changed schedule appears to save the original default date/time

- **Severity:** High (under investigation)
- **Reproduction:** In Alpha's New trip form, change the visible date/time from the defaults to 2026-08-01 10:30, then create the trip.
- **Actual result:** QA trip #1 was stored and shown in Dispatch as 2026-07-31 09:00, the original defaults.
- **Expected result:** The created record uses the date/time shown when Create is pressed.
- **Notes:** The React bindings in `JobFormDialog` appear correct; reproduce manually in the preview before changing code, to distinguish a native date/time automation-event issue from an application defect.

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

## Next scenarios

1. Create and redeem a Gamma invite, then validate reduced-permission sync access and tenant isolation.
2. Exercise reject, recall, and re-dispatch; then verify the repaired dispatch-chain history.
3. Validate public portal booking, client tracking, driver manifest, chat, and status transitions.
4. Exercise driver pricing, trip costs, statements, and payment status.
5. Verify QA-004 after the passenger-transfer defect is repaired, then test onboard/no-show and split-trip flows.
