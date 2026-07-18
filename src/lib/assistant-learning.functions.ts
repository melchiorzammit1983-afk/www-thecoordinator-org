/**
 * Silent learning layer for the AI dispatch assistant.
 *
 * Logs every proposal + outcome (confirmed/edited_then_confirmed/cancelled/
 * skipped) into `assistant_action_log`. A daily job (see
 * src/routes/api/public/hooks/summarize-learning.ts) rolls the last ~30 days
 * per company into short soft-preference notes injected into the system
 * prompt on future assistant turns.
 *
 * Fire-and-forget from the client: any logging failure is silent so it can
 * never block the primary assistant flow.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  action_kind: z.enum(["draft", "batch", "search_update", "data_fix", "partner_suggest"]),
  outcome: z.enum(["confirmed", "edited_then_confirmed", "cancelled", "skipped"]),
  proposed_payload: z.unknown().optional(),
  final_payload: z.unknown().optional(),
  raw_message: z.string().max(4000).optional().nullable(),
});

export const logAssistantAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (!company) return { logged: false };
    const proposed = (data.proposed_payload ?? {}) as Record<string, unknown>;
    const final = (data.final_payload ?? proposed) as Record<string, unknown>;
    try {
      await supabaseAdmin.from("assistant_action_log").insert({
        company_id: company.id,
        actor_user_id: context.userId,
        action_kind: data.action_kind,
        outcome: data.outcome,
        proposed_payload: proposed as never,
        final_payload: final as never,
        raw_message: (data.raw_message ?? "").slice(0, 2000) || null,
      });
      return { logged: true };
    } catch {
      return { logged: false };
    }
  });
