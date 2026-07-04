## Goal
Turn the uploaded coordinator logo into the company brand mark everywhere its name shows up.

## Changes

### 1. Coordinator sidebar (`src/routes/_authenticated/coordinator.tsx`)
Replace the 2-letter square next to the company name with the logo when `company.logo_url` is present; fall back to the initials square when it's missing. Keep size (`h-9 w-9`, rounded, contained image).

### 2. Driver portal header (`src/routes/m.driver.$token.tsx`)
Add a small logo (h-8 w-8, rounded) next to the company/coordinator name at the top. Uses `branding.logo_url` already returned by `getDriverManifest`. Fallback to initials when absent.

### 3. Client portal headers
Same treatment in:
- `src/routes/m/client/$token.tsx` (client bookings list header)
- `src/routes/t.$token.tsx` (client trip portal header)
- `src/routes/c.$token.tsx` if it shows a company name header

Uses `branding.logo_url` already returned by `getClientBookings` / `getClientTripPortal`.

### 4. Browser tab favicon for public portals
In each public portal route's `head()` (`m.driver.$token`, `m/client/$token`, `t.$token`, `c.$token`), when `loaderData.branding.logo_url` exists, add:
```ts
links: [{ rel: "icon", href: loaderData.branding.logo_url }]
```
Data URLs work as favicons. Falls back to the default Lovable favicon when no logo.

### 5. BrandingBar (`src/components/branding/BrandingBar.tsx`)
Since the logo now lives in the header, drop the logo square from the bottom bar:
- When an advert exists → render advert + caption only (no logo).
- When no advert exists → render nothing (the bar becomes advert-only).
This keeps the bottom bar purely for the sponsored advert and avoids double-branding.

### 6. Branding page preview (`src/routes/_authenticated/coordinator.branding.tsx`)
Update the in-page `PreviewBar` to match the new advert-only bottom bar, and add a small "Header preview" tile showing the logo + company name so the coordinator sees both placements.

## Out of scope
- No DB/schema changes (all data already available via `loadCompanyBranding`).
- No admin toggle changes — logo visibility stays tied to whether one is uploaded; the admin `branding_advert` entitlement continues to gate only the advert.
- No changes to server functions.
