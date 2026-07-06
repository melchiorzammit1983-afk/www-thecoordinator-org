# Plan: Single Consolidated Blueprint File

Produce ONE file that contains the full architecture map, code analysis, capabilities report, performance report, visual diagram, Copilot-ready formatting, and four reusable prompts.

## Deliverable

- **Path:** `/mnt/documents/APP_FULL_BLUEPRINT.md`
- **Format:** Single Markdown file, no splits, all 7 sections included.
- Supersedes the earlier `APP_BLUEPRINT.md` + `APP_BLUEPRINT_DIAGRAM.mmd` (Mermaid embedded inline this time).

## File Structure

1. **Section 1 — Full Architecture Map**
   - Routes: every file under `src/routes/` (public, `_authenticated/coordinator.*`, `_authenticated/admin.*`, `api/public/*`, portal/track/driver/client magic-link routes, cron routes, email queue route).
   - Components: grouped by domain (`coordinator/`, `driver/`, `client/`, `admin/`, `billing/`, `branding/`, `mobile/`, `trip/`, `ui/`).
   - Backend server functions: every `*.functions.ts` in `src/lib/` with each exported `createServerFn`, its middleware (auth vs public), and purpose.
   - Server helpers: `*.server.ts` (AI gateway, portal token, supabase admin).
   - Workflows & triggers: dispatch lifecycle, portal booking → job, driver assign, price proposal thread, points spend, email queue (pgmq + cron), auto-coordinate cron, rollover cron, wait thresholds hook.
   - API endpoints: list all `src/routes/api/public/**` with method + purpose (no secrets/IDs).
   - Database: every table from the schema list with its role and relationships (FK map in prose + Mermaid ER snippet).
   - Supabase: RLS overview per table, all DB functions already listed in context, cron jobs (`process-email-queue`, subscription rollover, auto-coordinate), storage buckets.

2. **Section 2 — Full Code Analysis**
   - File-by-file walkthrough grouped by folder.
   - Dependencies between modules (routes → functions → server helpers → supabase).
   - Duplicated logic hotspots (time/date derivation, points spend wrappers, portal token verification).
   - Risky code (monolithic `coordinator.calendar.tsx` ~2.5k lines, `coordinator.functions.ts` ~4.5k lines, enum literal usage, `SELECT *`).
   - Missing validation / error handling (public portal endpoints, magic-link routes).
   - Heavy operations (unpaginated calendar fetch, unbounded `admin_activity_log`, geocoding on every job change, AI calls without cache).

3. **Section 3 — Capabilities Report**
   - Working today, partially working, broken/disconnected, easy to expand, expensive to expand.

4. **Section 4 — Performance Report**
   - Slowness causes, points-usage drivers (AI features via `spend_points`), crash risks, unoptimized areas (indexes, realtime subs, map reloads).

5. **Section 5 — Visual Blueprint**
   - Inline Mermaid `flowchart` showing Users → Routes → Server Fns → Supabase → External (Google Maps, Lovable AI, Resend/email).
   - Inline Mermaid `erDiagram` for core tables (companies, jobs, drivers, client_bookings, portal_*, points_ledger, company_subscriptions).

6. **Section 6 — Copilot-Ready Format**
   - Explicit "Copilot instructions" block: stack constraints, file conventions, RLS+GRANT rule, `spend_points` requirement, forbidden patterns (edge functions for internal logic, service key in client, etc.).

7. **Section 7 — Reusable Prompts**
   - PROMPT A – Export Entire Codebase
   - PROMPT B – Refactor Plan
   - PROMPT C – Performance Optimization Plan
   - PROMPT D – Points-Saving Plan
   Each written as a ready-to-paste block.

## Method

- Reuse knowledge already gathered in the earlier blueprint pass; re-scan `src/routes/`, `src/components/`, `src/lib/` with `rg`/`list_dir` to make sure nothing new is missed.
- No code changes. Read-only exploration then write the single Markdown file.
- Do not include secret values, project IDs, Supabase URLs, or API keys (user asked for "API calls without the numbers as it's private").

## Out of Scope

- No refactors, no code edits, no DB migrations.
- No multiple output files — everything goes into `APP_FULL_BLUEPRINT.md`.
