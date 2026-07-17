import { createFileRoute } from "@tanstack/react-router";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

export const Route = createFileRoute("/api/help-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { messages?: unknown; context?: unknown } = {};
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const messages = body.messages;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response("AI Guide is not configured", { status: 500 });
        }

        // Build system prompt at request time so it reflects the current build's facts.
        const { buildSystemPrompt } = await import("@/lib/help-ai.server");
        let system = buildSystemPrompt();
        if (typeof body.context === "string" && body.context.trim()) {
          system += `\n\n--- CURRENT USER CONTEXT ---\n${body.context.slice(0, 2000)}`;
        }

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
