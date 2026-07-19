// Server-only helper for auditing raw AI model responses.
// Persists the raw content along with model/run/log IDs so failed parses
// can be reviewed later. Never throws — logging must not break the caller.

type LogArgs = {
  feature_key: string;
  surface?: string;
  model?: string | null;
  aig_run_id?: string | null;
  aig_log_id?: string | null;
  finish_reason?: string | null;
  parse_ok: boolean;
  parse_error?: string | null;
  raw_content: string;
  company_id?: string | null;
  actor_user_id?: string | null;
  meta?: Record<string, unknown>;
};

const MAX_LEN = 200_000; // keep individual rows bounded

export async function logRawAiResponse(args: LogArgs): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const raw = args.raw_content ?? "";
    const truncated = raw.length > MAX_LEN;
    const stored = truncated ? raw.slice(0, MAX_LEN) : raw;
    await supabaseAdmin.from("ai_raw_responses").insert({
      feature_key: args.feature_key,
      surface: args.surface ?? null,
      model: args.model ?? null,
      aig_run_id: args.aig_run_id ?? null,
      aig_log_id: args.aig_log_id ?? null,
      finish_reason: args.finish_reason ?? null,
      parse_ok: args.parse_ok,
      parse_error: args.parse_error ?? null,
      raw_content: stored,
      content_length: raw.length,
      company_id: args.company_id ?? null,
      actor_user_id: args.actor_user_id ?? null,
      meta: { ...(args.meta ?? {}), truncated },
    });
  } catch {
    // never let audit logging break the caller
  }
}
