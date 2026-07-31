# Live QA test log

## Scope and test data

- Environment: production (`thecoordinator.org`)
- Test companies: QA Alpha Transport, QA Beta Partners, QA Gamma Overflow
- Test approach: production-safe, clearly labelled QA data only; no real client or operational data.

## 2026-07-31 — authentication and coordinator smoke test

- **PASS:** QA Alpha Transport and QA Beta Partners sign in successfully with phone number and temporary password.
- **PASS:** The mandatory password-change flow completes successfully.
- **PASS:** Main coordinator pages render without visible application errors or browser console warnings.
- **PASS:** The New trip dialog opens and can be cancelled without creating data.

## Defects

### QA-001 — Collaboration invites cannot be created

- **Severity:** Critical
- **Reproduction:** Sign in as QA Alpha Transport → Collaborate → New invite → leave the default Provider mode → Create invite.
- **Actual result:** The server rejects the request because `edit_jobs`, `create_jobs`, `assign_drivers`, `post_chat`, and `edit_pax` are absent from `permissions`.
- **Expected result:** A provider invite is created with every permission represented as a boolean.
- **Cause:** The page state only initialized the enabled permissions, while the server schema requires all permission keys.
- **Fix:** Initialize every permission key, using `false` for disabled permissions.
- **Regression test needed:** Provider and sync invite creation, including a reduced-permission sync connection.

## Next scenarios

1. Redeem Alpha's invite in QA Beta and QA Gamma.
2. Create, dispatch, accept, reject, recall, and re-dispatch trips.
3. Validate public portal booking, client tracking, driver manifest, chat, and status transitions.
4. Exercise permissions and tenant isolation across all three companies.
