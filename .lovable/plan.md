
# The Coordinator — Living Help Center + "Ask the Guide" AI Assistant

A sidebar-style docs portal (Stripe/Linear-inspired) with a **built-in AI assistant** that understands how the system works, why the UI is behaving a certain way, and how to fix it — grounded in the same living documentation.

## Two entry points

- **`/how-it-works`** — public route, SEO-friendly, no login. Marketing overview.
- **`/help`** and `/help/$topic` — in-app docs (linked from a `?` button in the header + sidebar). Full sidebar-navigated documentation with the AI guide.

## Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ Search • Role filter • Ask the Guide 🤖 • Back to app       │
├────────────┬──────────────────────────────────────┬─────────┤
│ Sidebar    │  Article body                        │ On this │
│ Getting    │  Updated auto · v2026.07.17          │ page ▼  │
│  Started   │                                      │ Step 1  │
│ Coordinat. │  [Live screenshot with pin overlays] │ Step 2  │
│ Drivers    │                                      │ Step 3  │
│ Clients    │  ## Step 1 …                         │         │
│ Admins     │  [Flow diagram]                      │         │
│ Concepts   │                                      │         │
│ FAQ        │                                      │         │
└────────────┴──────────────────────────────────────┴─────────┘
                                              ┌───────────────┐
                                              │ 🤖 Ask Guide  │◄─ floating
                                              └───────────────┘   button, app-wide
```

## Content (first release)

**Getting Started** · welcome, roles, install apps.
**Coordinator** · dashboard, calendar & dispatch, manual trip creation, AI trip extraction, driver assignment + conflict detection, live tracking, status overrides, waiting-time rules.
**Driver** · install/permissions, biometric unlock, status flow, emergency buttons, waiting/no-show impact on trust & payout, live rerouting.
**Client** · booking link, tracking portal, ETA meaning.
**Admin** · users/roles, points/plans, FCM/VAPID push, branded slugs, security posture.
**Concepts** · trip event catalog, ETA freshness, grouping & chain reflow, AI pipeline, conflict math.
**FAQ / Troubleshooting** · ETA not updating, GPS off, wrong status, failed extractions, red-glowing cards, etc.

## Visuals

- **Real screenshots** via headless Playwright, saved to `src/assets/help/screenshots/`, annotated with CSS pin overlays.
- **AI diagrams** for concepts (AI pipeline, trip lifecycle, event → payout/trust impact, chain reflow, conflict timeline).
- Click-to-zoom lightbox on every image.

## The "living document" system (auto-updates)

Docs never go stale. Every fact is pulled live from code.

1. **`src/lib/docs-facts.ts`** re-exports real constants (`waitProximityMeters`, `conflictBufferMin`, `etaPollSeconds`, `noShowFeeEur`, `TRIP_EVENT_CATALOG`, …). Articles render `<Fact name="conflictBufferMin" unit="min" />` — update the constant, docs update on next build.
2. **Auto-generated trip event catalog** from `TRIP_EVENT_CATALOG` — add an event type, docs get a new row automatically.
3. **Auto-refreshed screenshots** via `scripts/capture-help-screenshots.ts` (Playwright). Each image shows its capture date.
4. **Version + changelog banner** — `Updated automatically · <commit date>`. `/help/changelog` generated from `CHANGELOG.md`; "What's new" toast on new entries.
5. **Contextual `<HelpLink slug="…" />`** typed against the manifest so broken links fail at build.
6. **`manifest.ts`** = single source of truth for sidebar, search, prev/next, role filtering.
7. **`fuse.js`** client-side search auto-indexes new articles.

## 🤖 Ask the Guide — AI assistant

An always-available AI chat that understands the system and the user's current context. Two entry points:

- **Floating `Ask the Guide` button** app-wide (bottom-right).
- **Inline** — on any docs article ("Ask a follow-up") and next to key UI signals ("Why is this red?" button on a glowing trip card).

### What it knows

The AI is grounded in a **live knowledge index** (not "trained" — it does retrieval every request):

1. **Every help article** (title, headings, body text) — indexed at build.
2. **Live facts** from `docs-facts.ts` (real thresholds, fees, timings).
3. **The trip event catalog** with each event's payout/trust impact.
4. **UI state vocabulary** — a curated map of every visual signal the app shows and what it means:
   - Red-glowing trip card → schedule conflict (see `ScheduleConflictBanner`).
   - Orange ETA chip → planned (stale > 5min).
   - Green ETA chip → live traffic-aware.
   - Purple pin on map → coordinator status override.
   - "Waiting" chip → driver stopped within 150m after `pickup_at`.
   - …one entry per visual state, kept alongside the component that renders it via a `registerSignal()` helper so new signals auto-register.

### What it can do (tool calls)

The AI can call **read-only** server tools to answer contextual questions:

- `getTripContext(jobId)` — returns trip state, latest map events, current ETA, driver location, active conflicts. Used to answer "why is trip #A123 red?".
- `getConflictExplanation(jobId)` — returns the full conflict math (prev end + buffer + handover + next pickup) already computed by `suggestAlternativeDrivers`.
- `searchHelp(query)` — semantic search over the help articles.
- `getEventImpact(eventType)` — returns the payout/trust delta for an event.

Every tool is auth-scoped through `requireSupabaseAuth`; the assistant sees only what the signed-in user can see (coordinator sees their trips, driver sees only theirs).

### Contextual "Why is this red?" hooks

A `<ExplainThis context={{ kind: 'trip', jobId, signal: 'conflict' }}>` button opens the assistant pre-loaded with the right context. Wired into:

- Trip cards with a conflict rail → "Why is this red?"
- ETA chips → "Why is ETA stale?"
- Status override dialog → "What happens if I override?"
- AI extraction error → "Why did this fail? What do I do?"
- Waiting timer → "Why is waiting not counting?"

Clicking the button opens the chat with a prefilled question and the AI resolves the answer by calling `getTripContext` / `getConflictExplanation`.

### Answer shape

The AI is instructed to always answer in three parts:

1. **Diagnosis** — plain-language explanation of what's happening.
2. **Why it matters** — impact on payment, trust, or workflow.
3. **How to fix it** — concrete steps, with a `<HelpLink>` to the full article and (when applicable) a deep link to the relevant screen (e.g. "Open trip #A123" or "Try suggested driver → Marc").

### Implementation

- **Route** `src/routes/api/help-chat.ts` — streaming chat via AI SDK + Lovable AI Gateway. Uses `google/gemini-3.5-flash` for speed and multimodal (users can even paste a screenshot).
- **System prompt** is generated at build time from the help manifest, facts, event catalog, and signal registry so the model always has the current knowledge.
- **Tools** defined with `tool()` + Zod schemas, all read-only and auth-scoped via `requireSupabaseAuth` middleware.
- **UI** built with AI Elements (`conversation`, `message`, `prompt-input`, `tool`, `shimmer`) per the chat-ui-composition guidance. Assistant messages plain (no bubble), user messages with `primary`/`primary-foreground`, tool cards collapsed by default.
- **History** — one conversation per user in `localStorage` (per chat-agent-ui-contract: no threading needed for a help assistant). "New conversation" button clears it.
- **Cost guard** — surface 429 (rate limit) and 402 (credits) cleanly.

## Files added (roughly)

**Routes**
- `src/routes/how-it-works.tsx` (public)
- `src/routes/help.tsx` (layout), `help.index.tsx`, `help.$topic.tsx`, `help.changelog.tsx`
- `src/routes/api/help-chat.ts` (AI streaming)

**Components** (`src/components/help/`)
- `HelpSidebar`, `HelpArticle`, `HelpToc`, `HelpSearch`, `Screenshot`, `Callout`, `StepList`, `RoleBadge`, `Fact`, `EventCatalogTable`, `HelpLink`, `FeedbackWidget`
- `AskGuideButton` (floating), `AskGuidePanel` (sheet), `ExplainThis` (contextual button)

**Content** (`src/content/help/`)
- `manifest.ts`, `screenshots.manifest.ts`, `docs-facts.ts`
- One `.tsx` per article
- `signal-registry.ts` — visual state → meaning map

**Automation**
- `scripts/capture-help-screenshots.ts`
- `src/lib/help-changelog.ts`
- `src/lib/help-ai.server.ts` — system prompt builder + tool definitions

**Optional DB (small)**
- `help_feedback (article_slug, thumbs, note, user_id, created_at)` with RLS + GRANT.
- `help_chat_events (user_id, question, tools_used, resolved, created_at)` — lightweight analytics so we can see which questions users actually ask.

## Rollout in one build pass

1. Scaffold routes, sidebar, article shell, manifest, search, `Fact` + `EventCatalogTable`.
2. Wire `docs-facts.ts` to real constants; auto-generate event catalog.
3. Capture initial screenshots + generate 5 AI diagrams.
4. Write first-wave articles (Getting Started + one per role + 3 concept deep-dives).
5. Build `/api/help-chat` with AI SDK, tools (`getTripContext`, `getConflictExplanation`, `searchHelp`, `getEventImpact`), and system prompt from live knowledge.
6. Build `AskGuideButton`, `AskGuidePanel`, `ExplainThis` and wire into 4–5 high-value UI spots (conflict rail, ETA chip, status override, AI extraction, waiting timer).
7. SEO metadata for `/how-it-works`, changelog page, `help_feedback` + `help_chat_events` migrations.

New dependencies: `fuse.js` (search) + AI Elements packages already available. No workflow changes.
