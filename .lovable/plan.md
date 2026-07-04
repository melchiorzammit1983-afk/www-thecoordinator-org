## Landing page updates (`src/routes/index.tsx`)

**Wording — remove "Free":**
- Hero CTA: "Get Started Free" → "Get Started" (button links to `/request-access`, not `/auth`).
- Hero micro-badges: replace "No credit card" with "Pay as you go".
- Add a small tagline under the hero: *"Points-based pricing — pay only for what you use."*
- Anywhere else "Free" appears (trial mentions, badges), rewrite to "Pay as you go" / "Only pay for what you use".
- Nav bar / header: add a secondary "Request Access" link; keep "Sign in" going to `/auth` for existing users.

**New sections (kept simple):**

1. **How points work** (3 short cards):
   - "1 point ≈ one small action" (trip created 1.5 pts, dispatch 0.5 pts, client SMS 0.25 pts).
   - "Top up anytime — no subscription lock-in."
   - "Only pay for what you actually use."

2. **FAQ** (accordion, 5 items):
   - How much does it cost? → Pay-as-you-go via points; example rates.
   - Do drivers need to install an app? → No.
   - Is it available outside Malta? → Currently focused on Malta.
   - How do I get access? → Request access, we approve, you're in.
   - Where is my data stored? → Secure cloud with role-based access.

3. **Trust strip** (placeholder):
   - Grayscale row of 4–6 partner logo slots (`bg-slate-100` boxes with "Your logo" until real ones are added).
   - Single testimonial quote card below (placeholder text you can swap later).

**Book a Demo:** the current `mailto:` link becomes a `<Link to="/request-access" search={{ demo: 1 }}>` so demo requests land in the same form (pre-checked "This is a demo request").

## New route: `src/routes/request-access.tsx`

Public route (SSR on). Simple centered card form using existing shadcn `Input`, `Select`, `Textarea`, `Checkbox`, `Button`.

Fields (all Zod-validated, trimmed, length-capped):
- Company name * (max 120)
- Contact name * (max 80)
- Email * (email, max 200)
- Phone * (max 40)
- Role * — Select: Hotel / Shipping agent / Fleet owner / Other
- Fleet size / expected trips per month * — Select: 1–5, 6–20, 21–50, 50+
- Message (optional, max 1000)
- Hidden/auto `kind`: `demo` if `?demo=1` in URL, else `access`. UI shows a small badge "Demo request" when in demo mode.

Submit calls a public `createServerFn` `submitAccessRequest` that:
1. Validates with Zod.
2. Inserts into existing `public.access_requests` (adds `kind` column via migration — see below).
3. Fires an email notification to you (admin) via `email_domain--scaffold_transactional_email` infra if an email domain is configured; otherwise no-op (log only). Subject differs: `[Demo] New demo request from X` vs `New access request from X`.
4. Returns `{ ok: true }`. Form shows a success card: *"Thanks — we'll be in touch within 24h."*

Head metadata: title "Request access — The Coordinator", description matches, `noindex` (avoid crawler spam on the form).

## Database migration

Small schema change on `public.access_requests`:
- Add `kind text not null default 'access' check (kind in ('access','demo'))`.
- Add `notes_admin text` (for you to jot notes when reviewing).
- No new tables. Existing RLS + admin-only read policies stay.

Regenerate `types.ts` after approval.

## Admin visibility

Existing admin panel already surfaces `access_requests`. Add a "Demo" badge next to demo rows (small `Badge` component change in the admin access-requests table — the row where `kind='demo'`). No new admin page.

## Notification to you

Two options depending on your setup:
- **If Lovable Emails is set up on this project** (custom domain): send via the transactional email infra to your admin email (`hello@coordinatormt.com` or whatever you prefer — I'll ask before wiring).
- **If not yet set up**: I'll leave the email hook stubbed with a clear TODO and only insert the DB row. You'll still see it in the admin panel with a "New" indicator.

## Files touched

- `src/routes/index.tsx` — copy edits, new sections, CTA rewiring.
- `src/routes/request-access.tsx` — new.
- `src/lib/public.functions.ts` (or extend existing public functions file) — `submitAccessRequest` server fn.
- `src/components/admin/AccessRequestsTable.tsx` (or wherever it lives) — demo badge.
- `supabase/migrations/…` — add `kind`, `notes_admin` columns.

## Out of scope for this pass

- Actual auto-provisioning of accounts (you approve manually in admin panel — same as today).
- Payment / Stripe integration.
- Marketing SEO deep dive.

**One thing I need from you before building:** which email should receive the "new request" / "new demo" notifications? (Also — is Lovable Emails already configured for this project, or should I skip the email step and stick to admin-panel-only for now?)