// Cost controls shared by the two PUBLIC/unauthenticated AI surfaces:
// the marketing SalesChatbot and the anonymous ("sales") mode of /api/help-chat.
// Not used by the authenticated coordinator assistant or coach-mode help chat.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PUBLIC_AI_LIMITS = {
  SESSION_TURN_CAP: 12,          // max real AI turns per visitor conversation
  DAILY_MODEL_CALL_CAP: 300,     // combined cap across both public endpoints per calendar day
  MAX_INPUT_CHARS: 500,          // per-message user input length ceiling
  MAX_OUTPUT_TOKENS: 250,        // per-response completion ceiling
} as const;

export const PUBLIC_AI_MESSAGES = {
  SESSION_CAP:
    "We've covered a lot in this chat! For anything more detailed, the fastest next step is booking a quick demo at /request-access — the team will walk you through your specific setup.",
  DAILY_CAP:
    "We're seeing high demand right now and this chat is taking a short breather. Please book a demo at /request-access or email us — the team will get back to you today.",
  INPUT_TOO_LONG:
    "That's a lot to unpack in chat! Could you shorten your question, or book a quick demo at /request-access so the team can walk through it with you?",
  EMPTY_REPLY:
    "Sorry, I didn't catch that — could you rephrase?",
  OFFLINE:
    "Sorry, the assistant is offline right now. Please use the Book a Demo form at /request-access and the team will be in touch.",
} as const;

// ---------- FAQ shortcut (zero AI cost when we can answer directly) ----------

type Faq = { keywords: string[][]; answer: string };

// Match rule: an entry matches if AT LEAST ONE of its keyword groups is fully
// present in the message (all tokens in that group must appear). Keeps the
// matcher conservative — we only short-circuit when we're confident.
const FAQS: Faq[] = [
  {
    keywords: [["what", "do"], ["what", "is"], ["what", "does"], ["about"], ["explain"]],
    answer:
      "The Coordinators is a transport dispatch platform for hotels, shipping agents, and fleet owners in Malta. You create trips, assign drivers, track flights and vessels, share live trip links with clients, and hand off overflow jobs to trusted partners — all in one place. Want a quick demo? /request-access",
  },
  {
    keywords: [["who", "for"], ["who", "uses"], ["fit"], ["right", "for"]],
    answer:
      "It's built for hotels, shipping agents, and fleet owners in Malta who run daily transfers. If that sounds like your operation, book a quick demo at /request-access and we'll show you how it'd fit.",
  },
  {
    keywords: [["price"], ["pricing"], ["cost"], ["how", "much"], ["fee"], ["fees"]],
    answer:
      "It's pay-as-you-go using points — no monthly subscription. Roughly: a trip is ~1.5 points, dispatching to a partner ~0.5, and sending a client SMS tracking link ~0.25. Top up whenever you like. For a tailored walkthrough: /request-access",
  },
  {
    keywords: [["subscription"], ["monthly"], ["contract"], ["commitment"]],
    answer:
      "No subscription and no long contract — it's pay-as-you-go with points. Top up when you need to, pause when you don't.",
  },
  {
    keywords: [["driver", "app"], ["install", "app"], ["download"], ["app", "store"], ["apk"]],
    answer:
      "Drivers don't need to install anything. They get a secure web link — no app store, no account signup, works on any phone.",
  },
  {
    keywords: [["try"], ["trial"], ["demo"], ["test"], ["free"]],
    answer:
      "Yes — you can book a quick live demo (and there's a trial when you get access). Grab a slot at /request-access.",
  },
  {
    keywords: [["access"], ["sign", "up"], ["signup"], ["get", "started"], ["register"], ["join"]],
    answer:
      "It's currently invite-based. Send a quick request from /request-access and the team reviews within 24 hours.",
  },
  {
    keywords: [["safe"], ["secure"], ["security"], ["privacy"], ["gdpr"], ["data"]],
    answer:
      "Yes — data is scoped per company with role-based access, live trip links use short-lived tokens, and only your team sees your dispatch data. For specifics, book a demo at /request-access.",
  },
  {
    keywords: [["ai", "assistant"], ["ai", "dispatch"], ["ai", "work"], ["ai", "do"], ["what", "ai"]],
    answer:
      "The AI dispatch assistant lets a coordinator just type or talk to create trips, edit them, or paste in a whole booking email. It drafts every action first, shows exactly what will change, and only runs after you confirm — and any AI action can be undone in one click. It also flags driver schedule conflicts automatically.",
  },
  {
    keywords: [["client", "link"], ["tracking", "link"], ["live", "link"], ["share", "link"], ["guest", "track"]],
    answer:
      "You can send guests or clients a live tracking link with the driver's ETA, in-trip chat, and an SOS button — no app install needed.",
  },
  {
    keywords: [["partner"], ["overflow"], ["hand", "off"], ["trip", "jumping"], ["jumping"], ["forward"]],
    answer:
      "When you're overbooked, Trip Jumping hands the trip off to a partner company you trust while you keep visibility for your client. Want to see it in action? /request-access",
  },
  {
    keywords: [["flight"], ["vessel"], ["ferry"], ["track", "flight"], ["airline"]],
    answer:
      "Flights and vessels are tracked automatically so pickups adjust to real arrival times — no more chasing a delayed flight manually.",
  },
  {
    keywords: [["contact"], ["email"], ["talk", "team"], ["reach", "you"], ["human"], ["real", "person"]],
    answer:
      "The fastest way to reach the team is /request-access — book a demo or drop a message there and someone will get back to you personally.",
  },
  {
    keywords: [["hi"], ["hello"], ["hey"], ["hola"]],
    answer:
      "Hey! I'm the Coordinators assistant. Ask me anything about the platform — what it does, pricing, the AI dispatcher, driver setup — or book a demo at /request-access.",
  },
];

function tokenize(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9']{2,}/g) ?? []));
}

export function tryFaqAnswer(userMessage: string): string | null {
  const tokens = tokenize(userMessage);
  if (tokens.size === 0) return null;
  for (const faq of FAQS) {
    for (const group of faq.keywords) {
      if (group.every((k) => tokens.has(k))) return faq.answer;
    }
  }
  return null;
}

// ---------- Daily circuit breaker ----------

export async function checkDailyCap(): Promise<{ allowed: boolean; count: number }> {
  try {
    const { data, error } = await supabaseAdmin.rpc("get_public_ai_daily_count");
    if (error) return { allowed: true, count: 0 }; // fail-open on infra error
    const count = typeof data === "number" ? data : 0;
    return { allowed: count < PUBLIC_AI_LIMITS.DAILY_MODEL_CALL_CAP, count };
  } catch {
    return { allowed: true, count: 0 };
  }
}

export async function bumpDailyCounter(): Promise<void> {
  try {
    await supabaseAdmin.rpc("bump_public_ai_daily_count");
  } catch {
    /* non-fatal — worst case one extra call slips through */
  }
}

// ---------- Session cap ----------

export function isOverSessionCap(userTurnsSoFar: number): boolean {
  // The current incoming user turn hasn't been answered yet, so cap AFTER 12 answered turns.
  return userTurnsSoFar > PUBLIC_AI_LIMITS.SESSION_TURN_CAP;
}
