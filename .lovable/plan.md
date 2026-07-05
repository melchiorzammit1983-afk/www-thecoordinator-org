## Redesign the Super Admin "AI & Features Pricing" panel

Focused rework of `src/routes/_authenticated/admin.pricing.tsx` (Feature Costs section) plus a new companion Wallets section. Plans and Point Packs sections stay as-is — this pass targets the two things the request calls out: feature pricing UX and the wallet overview.

### 1. Feature cost cards (replaces the current dense table)

Replace the `FeatureCostsCard` table layout with a responsive grid of cards (1 col mobile, 2 cols md, 3 cols xl). One card per feature, grouped by category (Core / AI / Comms / Data) with a subtle section header per group.

Each card shows, from top to bottom:
- Feature label (large) + monospaced `feature_key` (muted, small).
- A big current price pill: `X.XX pts / use`.
- A **range slider** (shadcn `Slider`, `min=0 max=50 step=0.5`) bound to a local `points` state. The slider is the primary control; the numeric value updates live above it. Values above the slider max (legacy rows already priced higher) auto-widen the slider max to `Math.max(50, currentValue)` so nothing gets clamped.
- A tiny numeric `Input` under the slider for precise entry (keeps decimals + values >50 reachable).
- **Usage this month** label: `Used 1,284× this month across N companies` (dimmed muted-foreground line, with a small `Activity` icon).
- Two toggle chips in a row: `Enabled` / `Disabled` and `Hard stop` / `Allow negative`.
- A `Save` button in the card footer — enabled only when dirty, uses the same `adminSetFeatureCost` mutation already wired.

Visual polish: subtle border, `bg-card`, hover elevates shadow slightly, dirty state adds a `ring-1 ring-primary/40` so admins see which cards have unsaved edits.

### 2. Usage metrics data source

Add a new server function `adminFeatureUsageThisMonth` in `src/lib/admin.functions.ts`:
- Guarded by `assertAdmin`.
- Reads `points_ledger` where `created_at >= date_trunc('month', now())`.
- Groups by `feature_key`, returning `{ feature_key, uses, companies }` where `uses = count(*)` and `companies = count(distinct company_id)`.
- Cached in the client via `useQuery` alongside the existing `listAiFeatureCosts` query.

The Feature Costs section joins the two datasets in memory and passes `{ uses, companies }` into each card. Missing entries render as `Used 0× this month`.

### 3. Total Wallet Overview (new section, above Plans)

New `WalletsCard` above `PlansCard` inside `PricingAdmin`:
- Header: "Company wallets" + subtitle "Live point balances across all companies."
- A compact right-aligned summary strip: `Total balance: 12,430 pts · N companies · M topped up this month`.
- A search input to filter by company name.
- Table columns: **Company** (name + created_at muted), **Plan** (badge from active subscription), **Balance** (large mono, color-coded: `text-emerald-600` >0, `text-amber-600` low <20, `text-destructive` ≤0), **Last activity** (relative time from most recent `points_ledger` entry), **Actions**.
- Actions column reuses the existing `<CompanyBillingDialog />` component (already imported in `admin.index.tsx`) as the "Top up" quick-action — clicking opens the same dialog that handles grant/plan/entitlements, so we don't duplicate business logic.

Data comes from a new server function `adminListCompanyWallets` in `admin.functions.ts`:
- Reads `companies (id, name, created_at, points_balance)`.
- Left-joins `company_subscriptions (plan_id, plans(name))`.
- For "last activity", one small `points_ledger` query grouped by `company_id` with `max(created_at)`.
- Returns a single flat array so the table doesn't do N+1 fetches.

### 4. Section ordering after the change

```text
Pricing (page title)
├── Company wallets            ← NEW, top of page
├── Feature point costs        ← redesigned as cards + sliders + usage
├── Plans                      ← unchanged
└── Point packs                ← unchanged
```

### Technical notes

- Slider: `import { Slider } from "@/components/ui/slider"` (already in the shadcn set per file listing). Two-way bound with a numeric input; both write to the same local state.
- Category grouping stays keyed by `CATEGORIES` constant already in the file.
- Server functions follow the existing `createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(...)` shape and go under the existing `// ---------- COMPANY ...` sections in `admin.functions.ts`.
- No schema changes, no new RLS work — all reads use `supabaseAdmin` inside admin-gated server functions, same pattern as the existing admin fetches.
- No changes to `PlansCard`, `PointPacksCard`, `PlanEditor`, or `PackRow`.
- Keep the `PricingAdmin` container width bumped to `max-w-7xl` to accommodate the card grid.
