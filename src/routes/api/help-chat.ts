import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import {
  PUBLIC_AI_LIMITS,
  PUBLIC_AI_MESSAGES,
  bumpDailyCounter,
  checkDailyCap,
  isOverSessionCap,
  tryFaqAnswer,
} from "@/lib/public-ai-guard.server";

// In-memory best-effort rate limits. Signed-in users get a generous bucket;
// anonymous visitors are rate-limited by client IP to protect the paid gateway.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_AUTH = 20;
const RATE_MAX_ANON = 8;
const buckets = new Map<string, { count: number; reset: number }>();
function rateLimit(key: string, max: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}

function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "anon"
  );
}

function cannedTextResponse(text: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = "canned-1";
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: text });
      writer.write({ type: "text-end", id });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return (last?.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim();
}

export const Route = createFileRoute("/api/help-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Try to authenticate. Missing/invalid token = anonymous "sales" mode.
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7).trim()
          : "";

        let userId: string | null = null;
        if (token) {
          const supabaseUrl = process.env.SUPABASE_URL;
          const supabaseAnon = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (supabaseUrl && supabaseAnon) {
            try {
              const authClient = createClient(supabaseUrl, supabaseAnon, {
                auth: { persistSession: false, autoRefreshToken: false },
                global: { headers: { Authorization: `Bearer ${token}` } },
              });
              const { data: userRes } = await authClient.auth.getUser();
              if (userRes?.user) userId = userRes.user.id;
            } catch {
              /* fall through as anonymous */
            }
          }
        }

        const mode: "coach" | "sales" = userId ? "coach" : "sales";
        const rateKey = userId ? `u:${userId}` : `ip:${clientIp(request)}`;
        const rateMax = userId ? RATE_MAX_AUTH : RATE_MAX_ANON;
        if (!rateLimit(rateKey, rateMax)) {
          return new Response("Too many requests", { status: 429 });
        }

        let body: { messages?: unknown; context?: unknown } = {};
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const messages = body.messages;
        if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
          return new Response("Messages are required", { status: 400 });
        }
        const uiMessages = messages as UIMessage[];

        // ---- PUBLIC (sales / anonymous) COST CONTROLS ----
        // Coach-mode (authenticated coordinators) is intentionally untouched:
        // that flow is covered by the points/overage billing system.
        if (mode === "sales") {
          const lastText = lastUserText(uiMessages);

          // 5. Input length cap
          if (lastText.length > PUBLIC_AI_LIMITS.MAX_INPUT_CHARS) {
            return cannedTextResponse(PUBLIC_AI_MESSAGES.INPUT_TOO_LONG);
          }

          // 2. Per-session message cap
          const userTurns = uiMessages.filter((m) => m.role === "user").length;
          if (isOverSessionCap(userTurns)) {
            return cannedTextResponse(PUBLIC_AI_MESSAGES.SESSION_CAP);
          }

          // 1. FAQ shortcut — zero AI cost
          const faq = lastText ? tryFaqAnswer(lastText) : null;
          if (faq) return cannedTextResponse(faq);

          // 3. Daily global circuit breaker
          const cap = await checkDailyCap();
          if (!cap.allowed) {
            return cannedTextResponse(PUBLIC_AI_MESSAGES.DAILY_CAP);
          }
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response("AI Guide is not configured", { status: 500 });
        }

        const { buildSystemPrompt } = await import("@/lib/help-ai.server");
        let system = buildSystemPrompt({ mode });

        // Only inject current-page context and learned lessons for signed-in operators.
        if (mode === "coach" && userId) {
          if (typeof body.context === "string" && body.context.trim()) {
            system += `\n\n--- CURRENT USER CONTEXT ---\n${body.context.slice(0, 2000)}`;
          }
          try {
            const lastUser = [...uiMessages].reverse().find((m) => m.role === "user");
            const lastText = lastUser?.parts?.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim() ?? "";
            if (lastText) {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: co } = await supabaseAdmin
                .from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
              if (co?.id) {
                const { buildLearnedContext } = await import("@/lib/ai-context.server");
                system += await buildLearnedContext({ companyId: co.id, kind: "qa", input: lastText, limit: 5 });
              }
            }
          } catch { /* non-fatal */ }
        }

        // Sales mode gets the cheapest model; coach mode gets flash for
        // slightly stronger step-by-step task guidance.
        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway(mode === "sales" ? "google/gemini-3.1-flash-lite" : "google/gemini-3.5-flash");

        try {
          const result = streamText({
            model,
            system,
            messages: convertToModelMessages(uiMessages),
            maxOutputTokens: mode === "sales" ? PUBLIC_AI_LIMITS.MAX_OUTPUT_TOKENS : 800,
          });
          if (mode === "sales") {
            // Best-effort — count the public model call. Fire-and-forget.
            void bumpDailyCounter();
          }
          return result.toUIMessageStreamResponse();
        } catch (error) {
          const msg = error instanceof Error ? error.message : "AI request failed";
          const status = /429|rate/i.test(msg) ? 429 : /402|credit/i.test(msg) ? 402 : 500;
          return new Response(msg, { status });
        }
      },
    },
  },
});
