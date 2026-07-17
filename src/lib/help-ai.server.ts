/**
 * Server-only system prompt builder for the Ask-the-Guide AI.
 * Grounds the model in the same living knowledge as the docs.
 */
import { FACTS, TRIP_EVENT_CATALOG, SIGNAL_REGISTRY } from "@/lib/docs-facts";
import { HELP_ARTICLES } from "@/content/help/manifest";

export function buildSystemPrompt(): string {
  const facts = Object.entries(FACTS)
    .map(([k, v]) => `- ${k}: ${v.value}${v.unit} — ${v.label}. ${v.description}`)
    .join("\n");

  const events = TRIP_EVENT_CATALOG.map(
    (e) =>
      `- ${e.type} ("${e.label}", ${e.category}, payout ${e.payoutDeltaEur === 0 ? "0" : `+€${e.payoutDeltaEur}`}, trust ${e.trustDelta >= 0 ? "+" : ""}${e.trustDelta}): ${e.description}`,
  ).join("\n");

  const signals = SIGNAL_REGISTRY.map(
    (s) => `- ${s.key} (${s.where}): ${s.meaning} FIX: ${s.fixHint}`,
  ).join("\n");

  const articles = HELP_ARTICLES.map(
    (a) => `- /help/${a.slug} — ${a.title}: ${a.summary}`,
  ).join("\n");

  return `You are "The Guide" — the built-in AI assistant for The Coordinator, a transport-dispatch platform for hotels, drivers, and coordinators in Malta.

Your job:
- Explain how the system works in plain language.
- Diagnose what a user is seeing on screen (e.g. "why is my trip card glowing red?").
- Guide the user to a fix with concrete, numbered steps.

ALWAYS answer in three short sections when the user asks about a problem or a signal:
1. **What's happening** — plain-language diagnosis.
2. **Why it matters** — impact on payment, trust, or workflow.
3. **How to fix it** — concrete steps. Reference the /help/<slug> page in the KNOWLEDGE section when appropriate (as markdown link).

Be concise. Use short paragraphs and bullet lists. Never invent numbers — always use the LIVE FACTS below. If unsure, say so.

--- LIVE FACTS (authoritative constants pulled from the running code) ---
${facts}

--- TRIP EVENT CATALOG (every event the system logs, with its payout/trust impact) ---
${events}

--- VISUAL SIGNAL VOCABULARY (what the colors and badges mean) ---
${signals}

--- HELP ARTICLE INDEX (link to these with markdown [Title](/help/slug)) ---
${articles}
`;
}
