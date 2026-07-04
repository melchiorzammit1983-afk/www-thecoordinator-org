## Direction

Mobile-first landing rebuild. All mockups are redrawn in code but mirror the **real app UI** — real sidebar labels (Dashboard, Dispatch, Pending, Drivers, Portal Links, Labels, Statements, Collaborate, My Driving, Branding), the real colored-stripe trip card, the real driver manifest layout, the real client trip portal with live tracking + SOS. **All names are fake/invented** (coordinator "Sea Breeze Fleet", hotel "Le Meridien Malta", driver "Andrei"). **QR code is removed everywhere.**

## Page structure (top to bottom)

### 1. Nav (sticky, compact on mobile)
- Left: your logo (h-10) + "The Coordinators" wordmark (hidden below sm)
- Right: `Login` (ghost) and `Book a Demo` (solid navy). Both stay visible on mobile but compact.

### 2. Hero (stacked on mobile, side-by-side ≥ md)
- Eyebrow chip: "Built in Malta for Maltese transport operators"
- Headline: **"Stop manually dispatching. Start collaborating."**
- Sub-headline: existing Malta hotels/shipping-agents/fleet-owners copy
- Buttons: `Get Started Free` (primary navy) + `See How It Works` (ghost, anchors to §4)
- Trust row: No credit card · No driver app required · Live flight tracking
- **Phone mockup on right (stacks below CTAs on mobile)** = redrawn client trip portal (`/t/:token`): header with logo + "Le Meridien Malta · Room 402", TripProgress bar, "Andrei · 4 min away" pulsing dot, chat preview, red SOS button. No QR.

### 3. Problem vs Solution (kept)
Two cards stack on mobile — red-tinted old way / emerald-tinted new way, copy unchanged.

### 4. How It Works — real coordinator flow (new section)
Vertical timeline on mobile, 4-column grid on desktop. Each step shows a mini render of the actual UI area.

1. **Paste bookings** — mini Pending screen with a WhatsApp-style paste block + "Parse with AI" button.
2. **AI parses in seconds** — mini list of parsed trip rows: name, pickup time, pax, flight number.
3. **Send driver a web link** — mini Drivers screen with "Send WhatsApp link" action + a tiny phone showing the driver manifest opening straight into an Accept card (no login).
4. **Track live + collaborate** — mini Dispatch board with the real colored-stripe trip cards and a small "chain" overlay for Trip Jumping.

### 5. Bento Features (kept)
Same 4 cards (Trip Jumping · Zero-Friction Drivers · AI Bulk Uploads · Ad Network); stacks to 1-column on mobile with simpler illustrations.

### 6. Client Experience (rewritten — no QR)
Text left, phone mockup right (stacks on mobile). Phone shows the **live tracking screen** (no QR):
- Header: "Le Meridien Malta · Room 402"
- Map placeholder with a pulsing driver pin + "Andrei · 4 min away"
- TripProgress bar (Assigned → En route → Arrived → Complete)
- Chat bubble preview
- Big red SOS button

Copy rewritten:
> **Put the trip in their pocket.**
> Send a secure booking link straight to your VIP corporate client or hotel guest. They confirm in one tap, then get live driver location, private chat with the driver, and a one-tap SOS safety button — no app to install.

Bullets: Live GPS + ETA · Private chat per trip · One-tap SOS

### 7. Bottom CTA (kept)
Dark navy card + logo + `Start Your Network Now` + `Book a Demo`.

### 8. Footer (kept, compact)

## Mobile-friendliness rules applied everywhere
- Base padding `px-5 py-16` on mobile; `md:px-6 md:py-24` on desktop
- Hero H1 caps at `text-4xl` on mobile (previous 4xl→7xl overflowed 375px)
- Two-column grids: `grid-cols-1 md:grid-cols-2 gap-8`
- Bento: explicit `grid-cols-1 md:grid-cols-6`
- Phone mockups `max-w-[260px] mx-auto` so they breathe on a 375px screen
- Sticky nav shrinks to `py-2.5` on mobile; nav buttons switch to `text-xs` below sm

## Realistic scenario names (invented, one consistent story)
- Coordinator company: **Sea Breeze Fleet**
- Hotel client: **Le Meridien Malta**
- Driver: **Andrei**
- Sample trips: MLA Airport ↔ Le Meridien / Corinthia / Valletta Waterfront
- Flight examples: KM110, RY4501

## Technical notes
- Single file rewrite: `src/routes/index.tsx`
- No new dependencies
- Logo asset already uploaded (`src/assets/coordinators-logo.png.asset.json`)
- Brand color `#1a2a52` (extracted from logo)
- lucide-react icons only, no QR icon in Client Experience
- Preview will be switched to mobile after building so you can review on the target form factor first

## Out of scope
- No changes to actual app routes/dashboards
- No copy changes to sections you didn't mention
- No new fonts (can add Inter/Geist via @fontsource in a follow-up)
