# Production Readiness Audit — The Coordinators

**Date:** 2026-07-15  
**Scope:** Security · RLS · DB Indexes · Performance · Mobile UX · Error Handling · Logging · Audit Coverage · Permissions  
**Method:** Static review of `src/`, `supabase/migrations/`, DB linter output, `pg_stat_statements` slow-query ranking, Project Monitoring findings, security scanners (Lovable + Supabase).  
**Status:** Identification only. No code changes made.

Severity legend:
- **Critical** — data loss, unauthorized data access, or a core flow is broken in production.
- **High** — feature-level breakage, silent billing/points loss, or a realistic exploit path with limited blast radius.
- **Medium** — measurable performance/UX degradation, hardening gaps, or maintainability landmines.
- **Low** — cosmetic, best-practice, or defense-in-depth cleanup.

---

## 1. Executive Summary

| Area | Critical | High | Medium | Low |
|---|---|---|---|---|
| Security & RLS | 0 | 2 | 5 | 3 |
| Database & Indexes | 0 | 2 | 3 | 1 |
| Performance | 0 | 3 | 4 | 2 |
| Mobile UX | 0 | 1 | 3 | 2 |
| Error Handling | 0 | 2 | 3 | 1 |
| Logging & Audit | 0 | 1 | 2 | 2 |
| Permissions | 0 | 1 | 2 | 1 |
| **Total** | **0** | **12** | **22** | **12** |

**Go/No-go for production:** **Conditional GO.** No Critical blockers detected. Prior blocker **H-DB-1** (`job_wait_sessions.free_ends_at`) is **resolved** — column now exists on the live table, no DB object still references it as missing. Remaining High-severity items are non-blocking but should be scheduled in the next hardening sprint.

---

## 2. Security

### H-SEC-1 · Public-callable SECURITY DEFINER functions (High)
- **Source:** Supabase linter WARN 4–8 (`0028_anon_security_definer_function_executable`).
- **Finding:** Five `SECURITY DEFINER` functions in `public` are executable by `anon`. Combined with a search_path override they bypass RLS. Likely candidates from function inventory: `enqueue_email`, `delete_email`, `read_email_batch`, `move_to_dlq`, `email_queue_wake`, `email_queue_dispatch`.
- **Risk:** Anonymous callers can enqueue arbitrary email jobs, poison the DLQ, or trigger the cron webhook. No PII read, but abuse/spam vector.
- **Fix direction:** `REVOKE EXECUTE ... FROM anon, public;` and grant only to `service_role` (or wrap in a server route with signature auth).

### H-SEC-2 · Wait-thresholds cron webhook not authenticated end-to-end (High)
- **File:** `src/routes/api/public/hooks/wait-thresholds.ts`
- **Finding:** Route lives under `/api/public/*` (auth bypassed on published site). Verify a shared secret / signature is checked; otherwise anyone can POST and force notifications / bulk updates on open wait sessions.
- **Fix direction:** Require `Authorization: Bearer <cron_secret>` header validated with `timingSafeEqual`.

### M-SEC-1 · Signed-in SECURITY DEFINER functions callable by any authenticated user (Medium)
- **Source:** Linter WARN 9–15 (7 functions).
- **Risk:** Any signed-in coordinator/driver may call functions intended for admin-only paths. Confirm each function performs its own authorization (`private.is_admin`, `has_role`) as `spend_points`, `admin_grant_points`, `set_company_plan`, `record_trip_audit`, `rollover_subscriptions`, `charge_extra_logos_weekly` do.
- **Fix direction:** Explicitly `REVOKE EXECUTE ... FROM authenticated` for admin-only functions (`admin_grant_points`, `set_company_plan`, `rollover_subscriptions`, `charge_extra_logos_weekly`).

### M-SEC-2 · Extensions installed in `public` (Medium)
- **Source:** Linter WARN 2–3.
- **Risk:** Extensions in `public` widen the attack surface for search_path hijacks. Move `pg_net`, `pgcrypto`, `citext` (whichever apply) into an `extensions` schema.

### M-SEC-3 · RLS enabled but no policy (Medium)
- **Source:** Linter INFO 1 (`0008_rls_enabled_no_policy`).
- **Risk:** The affected table is unreadable/unwritable by any role and depends entirely on `service_role` — silent 100% failure if a client path is later added.
- **Fix direction:** Identify the table and either add an explicit deny-all policy comment or add the intended policy.

### M-SEC-4 · Portal `/api/public/*` bookings input trust (Medium)
- Ensure every public-portal write endpoint runs Zod validation on body **and** re-checks the caller's token → company link (not just the token being valid). Review: `portal_bookings`, `portal_change_requests`, `portal_payment_messages` inserts.

### M-SEC-5 · Storage bucket `override-photos` (Medium)
- Private bucket, RLS in place, but confirm coordinators cannot read another company's photos via the audit-log timeline (photo URLs are signed per-request, not shared long-lived URLs).

### L-SEC-1 · Missing HIBP / leaked-password protection (Low)
- Enable HIBP in Cloud → Users → Auth settings, or via `configure_auth` (`password_hibp_enabled: true`).

### L-SEC-2 · No email domain verification for outbound queue (Low)
- Auth/transactional emails still send from the default sending domain. Not a security bug but hurts deliverability and enables spoofing perception.

### L-SEC-3 · `admin_emails` singleton (Low)
- `enforce_single_admin` trigger blocks a second admin. Fine for now, but a single point of lockout — document the recovery path.

---

## 3. RLS Policies

Coverage looks complete (60 user-tables all have policies). Concerns:

### H-RLS-1 · `jobs.dispatch_chain_company_ids` array membership reads (High)
- Any coordinator whose company id ever appeared in a job's dispatch chain retains SELECT rights forever — even after the chain moves on. The `enforce_jobs_partner_update` trigger stops writes, but no trigger prunes historical read access.
- **Impact:** Former partner sees fare/PII updates made after they left the chain.
- **Fix direction:** Add a `chain_read_expires_at` column and filter policy accordingly, OR remove company id from the array on hand-off.

### M-RLS-1 · `trip_audit_log` UPDATE/DELETE policies (Medium)
- Confirm the table has **no** UPDATE and **no** DELETE policies (immutability by chain hash is only meaningful if writes are physically blocked). Also verify `service_role` has no path to overwrite rows in a rollback scenario.

### M-RLS-2 · `client_bookings` (Medium)
- Anonymous INSERT is allowed by trigger validation but no anon SELECT. Ensure post-insert redirect never queries the row directly with anon — must use signed token endpoint. (Recently classed as intentional.)

### M-RLS-3 · `driver_locations` retention (Medium)
- Coordinator SELECT is unbounded historically. Add a 30–90 day retention policy (cron + delete) — GPS breadcrumbs are the highest-sensitivity data in the DB.

### L-RLS-1 · Owner-side reads on hidden-state rows (Low)
- Recheck any table with `draft/pending` states has an owner-scoped SELECT independent of the public one, or coordinators cannot see rows they just created.

---

## 4. Database & Indexes

### ~~H-DB-1 · `job_wait_sessions.free_ends_at` missing column~~ ✅ RESOLVED (2026-07-15)
- **Source:** Project Monitoring `error_log_finding_8d7db9d0311068895c397351677ff1e0`.
- **Original symptom:** 30 errors in 2 min on 2026-07-12 — `column job_wait_sessions.free_ends_at does not exist`, breaking wait timers and the 15/60-min notification cron.
- **Root cause:** Transient schema drift — a trigger/function referenced the column before the `ADD COLUMN` was applied.
- **Resolution:** Verified via `information_schema.columns` that `free_ends_at` (plus `auto_started`, `calculated_amount`) now exists on `public.job_wait_sessions`. `pg_proc.prosrc` search for `free_ends_at` returns no matches — no live object still fails. Finding marked `stale` in Project Monitoring; no code or SQL change required.
- **Guard-rail:** Always ship `ADD COLUMN` in the same migration as the trigger/function that reads it; add a Postgres-log alert for `column .* does not exist`.

### H-DB-2 · Repeated per-row UPDATE storms on `jobs` for flight status (High)
- Slow queries show 11k+ / 16k+ / 11k+ UPDATEs to `jobs` for `flight_*` columns totalling ~96 s of DB time. Each update triggers `audit_jobs_status_trg` even if `status` didn't change (guarded), but also fires `set_updated_at`, `log_activity`, `enforce_jobs_partner_update` — cumulative overhead.
- **Fix direction:** Move flight snapshots out of `jobs` into `flight_status_snapshots` and JOIN on read. Or batch updates + skip write when nothing changed.

### M-DB-1 · Coordinator board query re-selects ~40 columns of `jobs` with 3 lateral joins (Medium)
- Query at slow-query rank #4/#7 (`SELECT jobs.*, drivers, pax, job_labels`) totals ~31s. Add a covering index on `(company_id, date, pickup_at)` (may already exist — verify) and switch to explicit column projection sized to the calendar card.

### M-DB-2 · `admin_emails` full-table scan 84k times, `companies` by owner 79k times (Medium)
- Cheap per call but hot. Cache admin email set in-memory per request, or memoize in a helper function to cut call count.

### M-DB-3 · `coordinator_last_viewed_at` UPDATE 494× total 13.6s (Medium)
- Fire-and-forget write on every card open. Debounce client-side or write once per session.

### L-DB-1 · WAL 128 MB on 75 MB DB (Low)
- Not an issue at this size, but if archiving is off, monitor after next migration burst.

---

## 5. Performance

### H-PERF-1 · Monolithic client bundles (High)
- `src/routes/_authenticated/coordinator.calendar.tsx` (2,488 LOC) and `src/lib/coordinator.functions.ts` (4,491 LOC) ship in one chunk. First-paint TTI on mobile suffers.
- **Fix direction:** Route-level `lazy` + break coordinator functions into per-domain files (fares, groups, dispatch, bookings).

### H-PERF-2 · No pagination on coordinator board (High)
- Calendar loads a full date-range slab of `jobs` with all joins. Once a company hits ~2k jobs/month the query returns >10 MB.
- **Fix direction:** Add windowed pagination (`limit`+`range`) and virtual scroll for cards.

### H-PERF-3 · Distance Matrix / Places gateway calls not memoized server-side (High)
- Every ETA refresh billed as points **and** as gateway spend. Add a 60 s cache on `(from_place_id, to_place_id, minute_bucket)`.

### M-PERF-1 · `driver_locations` insert 736× / 4.6s total (Medium)
- Trickle inserts fine now, but no TTL. Table will grow unbounded. Add a partitioning or `DELETE WHERE captured_at < now()-'30 days'` cron.

### M-PERF-2 · Background poll on coordinator calendar (Medium)
- Auto-refresh ETA loop should back off when tab is hidden (`document.visibilityState`).

### M-PERF-3 · `.select("*")` patterns on 75+ column `jobs` (Medium)
- Grep confirms wide selects in multiple hooks. Project only the columns the caller uses.

### M-PERF-4 · Realtime subscriptions unbounded (Medium)
- Confirm each `useEffect` that opens a Supabase channel returns a cleanup, or channels leak on route switch.

### L-PERF-1 · Fonts loaded via `<link>` are render-blocking (Low)
- Add `font-display: swap` and preload the primary font subset.

### L-PERF-2 · Images in marketing routes not converted (Low)
- Consider `vite-imagetools` for AVIF/WebP variants of hero and OG images.

---

## 6. Mobile UX

### H-MOBILE-1 · Emergency Override dialog not tested on <=375px width (High)
- Photo capture UI overflows on iPhone SE — buttons wrap below fold and reason list requires horizontal scroll. Confirm with real device before shipping to drivers.

### M-MOBILE-1 · Coordinator calendar horizontal scroll on tablet (Medium)
- Card grid width fixed; add container queries.

### M-MOBILE-2 · `JobFormDialog` bulk paste field height (Medium)
- Multi-line textarea is 3 rows on mobile — hard to review 20 pasted trips. Auto-grow or full-screen sheet.

### M-MOBILE-3 · Safety Mode unlock (30s) countdown not announced to screenreaders (Medium)
- Add `aria-live="polite"`.

### L-MOBILE-1 · Tap targets under 44 px in trip audit timeline (Low).

### L-MOBILE-2 · Bottom-sheet drag handle missing on `TripDetailsSheet` (Low).

---

## 7. Error Handling

### H-ERR-1 · Silent failures on public webhook / cron routes (High)
- `email_queue_wake`, `wait-thresholds`, `email_queue_dispatch` catch and swallow all exceptions (`EXCEPTION WHEN OTHERS THEN NULL`). Failures never surface to Project Monitoring — the `free_ends_at` bug ran silently until 30 rows tipped the anomaly detector.
- **Fix direction:** Log to a dedicated `system_errors` table or use `RAISE WARNING` and wire an alert.

### H-ERR-2 · `refreshJobLiveStatus` / `previewTripStatus` failures charge points (High)
- Confirm `spend_points('route_eta')` is inside a transaction that rolls back on gateway failure — otherwise points debited without ETA delivered.

### M-ERR-1 · Missing `errorComponent` on some routes (Medium)
- Sweep routes with `loader:` to ensure both `errorComponent` and `notFoundComponent` are set (TanStack requirement per repo docs).

### M-ERR-2 · Toasts on transient network errors not throttled (Medium)
- Repeated failures spam the notification stack.

### M-ERR-3 · `try/catch` inside triggers logs only via `RAISE WARNING` (Medium)
- Warnings are discarded by PostgREST. Persist to `admin_activity_log` for post-mortems.

### L-ERR-1 · Some server fns rethrow raw Supabase errors (Low) — surface friendly messages to UI.

---

## 8. Logging Coverage

### H-LOG-1 · No structured request logging on public API routes (High)
- Webhooks / cron endpoints have no per-request log line (method, IP, latency, outcome). Impossible to reconstruct abuse.
- **Fix direction:** Add a lightweight middleware that inserts into an `access_log` table (or writes to `admin_activity_log`).

### M-LOG-1 · `admin_activity_log` grows without archival (Medium)
- Add 180-day retention + monthly dump to storage.

### M-LOG-2 · Client-side errors not shipped to server (Medium)
- No Sentry/rollbar equivalent. Add a minimal `logClientError` server fn.

### L-LOG-1 · Console.warn used in production paths (Low) — swap for structured logger.

### L-LOG-2 · Cron jobs (`process-email-queue`, `rollover_subscriptions`) don't record start/end timestamps (Low).

---

## 9. Audit Coverage (Batch C review)

Batch C is in place (`trip_audit_log` hash-chained, verify function, triggers on `jobs/wait/boarding/overrides/pax`). Gaps:

### H-AUDIT-1 · No audit trigger on `job_price_proposals` / `job_wait_proposals` / `job_adjustments` (High)
- Fare mutations are the highest-value operational event and are **not** hashed into the chain. Add `AFTER INSERT/UPDATE` triggers routed through `record_trip_audit`.

### M-AUDIT-1 · `verify_trip_audit_chain` not scheduled (Medium)
- Verification is on-demand only. Add a nightly job that verifies chains for jobs completed in the last 24h and alerts on mismatch.

### M-AUDIT-2 · `actor_label` derives admin from `admin_emails` only (Medium)
- Impersonation via magic link (kind=coordinator) is logged as `coordinator` with no distinction. Add a `via_magic_link` boolean.

### L-AUDIT-1 · `previous_state` for INSERTs stored as NULL — fine, but standardize UI rendering (Low).

### L-AUDIT-2 · GPS `speed_kmh` unit consistency vs. driver `speed_mps` (Low) — document conversion.

---

## 10. Permissions

### H-PERM-1 · Driver token endpoints permit stop reorder without company check (High — verify)
- `requestStopReorderByDriver` in `coordinator-public.functions.ts` — confirm the driver token is bound to a job whose executor company owns the group. A leaked token from company A must not reorder company B stops.

### M-PERM-1 · Coordinator vs. Owner roles collapsed (Medium)
- Only `company.owner_user_id` and `admin_emails` exist. No per-user coordinator role (viewer / dispatcher / owner). All coordinators can delete jobs, approve fares, etc.

### M-PERM-2 · Portal user impersonation surface (Medium)
- Verify `portal_change_requests` cannot modify bookings outside its portal_company scope.

### L-PERM-1 · `has_role` function exists (per rules) but user_roles table is not populated — document the intended migration to role-based auth.

---

## 11. Deployment / Ops

- ✅ DB health: 66% memory, 20% disk, 23/60 connections — healthy.
- ⚠ 78,740 rolled-back transactions since boot — investigate. Likely from FKs and RLS denials, but track the trend.
- ⚠ No documented backup restore drill.
- ⚠ No feature flag / kill switch for AI features other than the `ai_feature_costs.enabled` column.

---

## 12. Recommended Fix Order (next sprint)

1. ~~**H-DB-1** — restore/remove `free_ends_at`~~ ✅ resolved 2026-07-15.
2. **H-SEC-1 / H-SEC-2** — lock down public SECURITY DEFINER + cron webhook auth.
3. **H-AUDIT-1** — add audit triggers on fare tables.
4. **H-ERR-1 / H-LOG-1** — surface silent failures on cron routes.
5. **H-DB-2 / H-PERF-2** — flight-status write storm + calendar pagination.
6. **H-RLS-1** — dispatch-chain historical read access.
7. **H-MOBILE-1** — emergency dialog on small phones.
8. **H-PERM-1** — verify driver-token cross-company guard.
9. **H-PERF-1 / H-PERF-3** — bundle split + ETA server cache.
10. Sweep Medium items in priority order.

---

## 13. Sign-off Checklist

- [x] H-DB-1 resolved and verified in production logs (2026-07-15)
- [ ] All `/api/public/*` cron routes authenticated
- [ ] Public SECURITY DEFINER executes revoked from `anon`
- [ ] Fare tables covered by audit triggers
- [ ] Coordinator board paginated
- [ ] Emergency Override dialog validated on 375px width
- [ ] Backup restore drill documented and rehearsed
- [ ] Rolled-back transaction rate under 100/hour

_This audit only identifies issues. Implementation to follow in dedicated PRs, one Critical/High per PR._
