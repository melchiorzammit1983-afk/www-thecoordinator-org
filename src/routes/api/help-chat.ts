import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

// In-memory best-effort rate limit per user (defence in depth on top of auth).
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const buckets = new Map<string, { count: number; reset: number }>();
function rateLimit(key: string) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= RATE_MAX) return false;
  b.count += 1;
  return true;
}

export const Route = createFileRoute("/api/help-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Require an authenticated Supabase session — this endpoint calls the
        // paid Lovable AI gateway and must not be an open proxy.
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7).trim()
          : "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseAnon = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !supabaseAnon) {
          return new Response("Auth not configured", { status: 500 });
        }
        const authClient = createClient(supabaseUrl, supabaseAnon, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: userRes, error: userErr } = await authClient.auth.getUser();
        if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });

        if (!rateLimit(userRes.user.id)) {
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
        let system = buildSystemPrompt();
        if (typeof body.context === "string" && body.context.trim()) {
          system += `\n\n--- CURRENT USER CONTEXT ---\n${body.context.slice(0, 2000)}`;
        }

        // Inject learned lessons (company + opted-in global) relevant to the latest user turn.
        try {
          const lastUser = [...(messages as UIMessage[])].reverse().find((m) => m.role === "user");
          const lastText = lastUser?.parts?.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim() ?? "";
          if (lastText) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: co } = await supabaseAdmin
              .from("companies").select("id").eq("owner_user_id", userRes.user.id).maybeSingle();
            if (co?.id) {
              const { buildLearnedContext } = await import("@/lib/ai-context.server");
              system += await buildLearnedContext({ companyId: co.id, kind: "qa", input: lastText, limit: 5 });
            }
          }
        } catch { /* non-fatal */ }

        system += "\n\nSAFETY: Never repeat or invent personal data (names, phones, addresses, card numbers). Always remind the user to verify before acting on payments or assignments.";

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3.5-flash");

        try {
          const result = streamText({
            model,
            system,
            messages: convertToModelMessages(messages as UIMessage[]),
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
