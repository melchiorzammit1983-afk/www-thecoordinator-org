## Root cause

The URL `https://thecoordinator.org/h/<slug>/r/<qr>` is served by two nested routes:

- `src/routes/h.$slug.tsx` → parent route at `/h/$slug`
- `src/routes/h.$slug.r.$qr.tsx` → child route at `/h/$slug/r/$qr`

`routeTree.gen.ts` confirms the QR route is registered as a **child** of `HSlugRoute` (`parentRoute: typeof HSlugRoute`). Under TanStack Router, a parent route's `component` renders on every child match. When it doesn't render an `<Outlet />`, its own UI takes over instead of the child.

`h.$slug.tsx` is currently a leaf: its component does `window.location.replace('/api/public/portal/by-slug/<slug>')` inside `useEffect` and never renders `<Outlet />`. So visiting the QR URL immediately fires the by-slug redirect. The slug in the failing link is the portal's UUID (`ee3916ed-…`), which isn't a valid branded slug — `/api/public/portal/by-slug/$slug.ts` returns the "This portal link is no longer active." 404, which is exactly what the user sees. The child room-landing page never gets a chance to mount.

## Fix

Split the parent into a real layout plus a sibling index leaf, following the documented "promote a leaf to a layout" pattern.

1. **`src/routes/h.$slug.tsx`** — turn into a pure layout: component just returns `<Outlet />`. Keep `ssr: false` and the noindex `head()`. No `useEffect`, no redirect logic here.
2. **New `src/routes/h.$slug.index.tsx`** — move the current redirect body here. This owns `/h/$slug` only and continues to call `/api/public/portal/by-slug/<slug>` for branded-slug landings.
3. **`src/routes/h.$slug.r.$qr.tsx`** — no change. Now that the parent renders `<Outlet />`, this child mounts normally and calls `/api/public/portal/guest/room/<qr>` for the room QR flow.

Let TanStack Router regenerate `src/routeTree.gen.ts` from the new file set (no manual edits).

## Verification

- Load `/h/<uuid>/r/<qr>` — should show the room landing (name/email/phone form or a specific `not_found` / `room_disabled` / `portal_disabled` message from the guest-room API), never the by-slug "no longer active" message.
- Load `/h/<branded-slug>` — should still redirect to `/portal/<magic_token>` as before.
- Load `/h/<invalid-slug>` — should still show "This portal link is no longer active." from by-slug.

If the QR URL still fails after the routing fix, the follow-up is on the QR side: check whether the row exists in the room-QR table and whether `active`/`portal.link_enabled` are truthy — those return the `not_found` / `room_disabled` / `portal_disabled` errors handled by the room-landing page's `Unavailable` component. That check is a separate step and only needed if routing is proven correct but the page still says the QR is invalid.
