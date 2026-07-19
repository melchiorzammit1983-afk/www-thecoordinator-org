import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

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
            const lastUser = [...(messages as UIMessage[])].reverse().find((m) => m.role === "user");
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
            messages: convertToModelMessages(messages as UIMessage[]),
            maxOutputTokens: mode === "sales" ? 400 : 800,
          });
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
