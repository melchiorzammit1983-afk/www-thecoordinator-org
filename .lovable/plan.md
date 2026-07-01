Add a **Copy link** action to the trip card dropdown so coordinators can grab the driver share link manually when WhatsApp Web isn't available.

## Changes

**`src/components/coordinator/TripCard.tsx`**
- Add a new `DropdownMenuItem` "Copy link" directly under "Share on WhatsApp".
- Icon: `Link2` (or `Copy`) from lucide-react.
- Handler reuses the same magic-link generator that "Share on WhatsApp" already calls (creating/fetching the driver magic link for the assigned driver), then writes the URL to `navigator.clipboard.writeText(url)` and shows a toast ("Link copied").
- If clipboard API is unavailable, fall back to a temporary `<textarea>` + `document.execCommand('copy')`.
- Only enabled when a driver is assigned (same condition as the WhatsApp share item).

No backend, schema, or other UI changes.
