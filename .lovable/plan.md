# Fix production slowness: sign-in, page load, and AI

## Diagnosis (verified this turn)

- Console: `supabase.auth.getUser()` and `/_serverFn/*` calls fail with `TypeError: Failed to fetch`.
- Network: `GET /auth/v1/user` → Failed to fetch; a server fn returned `TSR/Error` with empty message (the backend call inside it timed out).
- Backend probes just now: `db_health` metrics endpoint timed out; `slow_queries` returned `Connection terminated due to connection timeout`.
- Cloud status: reports healthy, but the Postgres side is not accepting connections in time.

That combination — healthy control plane, unreachable DB, connection timeouts — is the Lovable Cloud instance running out of compute/connection headroom. Every authenticated page load currently fires: `auth.getUser()` in the `_authenticated` gate + `getMyCompany` + `getMyFeatures` (with a realtime channel + 30s refetch) + `getMyBilling` + `getUserPrefs`, plus AI server fns. When the DB stalls, sign-in stalls, protected routes stall, and AI stalls.

## Step 1 — Upgrade Cloud compute (unblock production now)

Call `supabase--resize_compute` so you can pick the next tier in the approval picker. Larger instance = more concurrent connections + more RAM for Postgres, which is the metric that's saturated. Takes a few minutes; increases monthly Cloud usage.

After resize, re-run `db_health` and `slow_queries` to confirm timeouts are gone and to capture the top offenders for Step 2.

## Step 2 — Cut per-page-load DB round-trips (no functional change)

Goal: one authenticated page load = one bootstrap round-trip instead of 4–5.

1. **Consolidate bootstrap** — add `getMyBootstrap` server fn in `src/lib/coordinator.functions.ts` returning `{ company, features, billing, prefs }` in a single `requireSupabaseAuth` handler. Update `useMyCompany`, `useFeatures`, `useMyBilling`, `usePreferences` to read from one shared `["me-bootstrap"]` query via `useQuery(select: ...)`, keeping their public APIs unchanged.
2. **Stop the 30s feature refetch storm** — in `src/hooks/use-features.ts` drop `refetchInterval: 30_000` and `refetchOnMount: "always"`; keep the realtime channel as the invalidation source, and raise `staleTime` to 60s. Same for billing.
3. **Cache `getUser` at the gate** — in `src/routes/_authenticated/route.tsx` `beforeLoad`, prefer `supabase.auth.getSession()` for the presence check (no network) and only call `getUser()` when a session exists; also short-circuit if `queryClient` already has `["me-bootstrap"]`. Keeps the security posture (server fns still re-validate via `requireSupabaseAuth`).
4. **Defer non-critical AI wiring** — the AI FAB/`AskGuideProvider` should not eagerly hit the network on mount; only fetch on first open. Verify `SalesChatbot` and help-chat public surfaces are already guarded (they are, via `public-ai-guard.server.ts`).
5. **Verify** — after deploy, load `/coordinator`, watch DevTools Network: expect 1× `/auth/v1/session` (cached) + 1× `/_serverFn/getMyBootstrap`, no 30s polling. Re-check `db_health` connection count under real traffic.

## Out of scope

- No schema changes, no RLS changes, no AI behavior changes.
- No changes to workflows, dispatch, flight tracking, or billing math.

## Technical notes

- `getMyBootstrap` returns the same shapes the existing hooks already expose, so hook consumers don't change.
- Realtime channel in `use-features.ts` stays — it's the correct invalidation signal; the 30s poll is the redundant one.
- Session-first gate check is safe: `requireSupabaseAuth` on every protected server fn is the real authorization boundary.
