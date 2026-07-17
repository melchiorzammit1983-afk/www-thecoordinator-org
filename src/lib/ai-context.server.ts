/**
 * Server-side helper: fetch top-K relevant lessons and format them for
 * injection into an AI system prompt.
 */
export async function buildLearnedContext(params: {
  companyId: string | null;
  kind: "parse_pattern" | "qa" | "suggestion_rule" | "signal_fix";
  input: string;
  limit?: number;
}): Promise<string> {
  if (!params.companyId || !params.input.trim()) return "";
  const { embedText } = await import("@/lib/ai-embed.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const vec = await embedText(params.input);
  if (!vec) return "";
  const { data, error } = await supabaseAdmin.rpc("match_ai_lessons", {
    query_embedding: vec as unknown as string,
    _company_id: params.companyId,
    _kind: params.kind,
    _limit: params.limit ?? 5,
  });
  if (error || !data || data.length === 0) return "";
  const lines = data.map(
    (l: { title: string; rule_text: string; scope: string; similarity: number }, i: number) =>
      `${i + 1}. [${l.scope}] ${l.title} — ${l.rule_text}`,
  );
  return `\n\n--- LEARNED PATTERNS (from prior corrections; apply when relevant, never repeat personal data across companies) ---\n${lines.join("\n")}`;
}
