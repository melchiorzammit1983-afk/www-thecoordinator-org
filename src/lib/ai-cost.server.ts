/**
 * AI cost recorder — server-only.
 *
 * Each AI Gateway call should hand its {usage, model, feature_key} to
 * `recordAiCost` so admins can compare real Lovable-credit / USD cost
 * against the system points they charged the company.
 *
 * Never throws: metering should never break a primary AI response.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cached_tokens?: number | null;
  // OpenAI-compat aliases (accept either form)
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
};

export type RecordAiCostInput = {
  feature_key: string;
  model?: string | null;
  usage?: AiUsage | null;
  company_id?: string | null;
  actor_user_id?: string | null;
  points_charged?: number | null;
  job_id?: string | null;
  aig_log_id?: string | null;
  aig_run_id?: string | null;
  surface?: string | null;
  duration_ms?: number | null;
  status?: "ok" | "error" | "rate_limited" | "no_credits" | string;
};

type RateRow = {
  input_usd_per_1m: number;
  output_usd_per_1m: number;
  credits_per_usd: number;
};

let ratesCache: Map<string, RateRow> | null = null;
let ratesCachedAt = 0;
const RATES_TTL_MS = 60_000;

async function loadRates(): Promise<Map<string, RateRow>> {
  if (ratesCache && Date.now() - ratesCachedAt < RATES_TTL_MS) return ratesCache;
  const { data } = await supabaseAdmin
    .from("ai_model_rates")
    .select("model, input_usd_per_1m, output_usd_per_1m, credits_per_usd");
  const map = new Map<string, RateRow>();
  for (const r of (data ?? []) as Array<{ model: string } & RateRow>) {
    map.set(r.model, {
      input_usd_per_1m: Number(r.input_usd_per_1m) || 0,
      output_usd_per_1m: Number(r.output_usd_per_1m) || 0,
      credits_per_usd: Number(r.credits_per_usd) || 100,
    });
  }
  ratesCache = map;
  ratesCachedAt = Date.now();
  return map;
}

function pickRate(map: Map<string, RateRow>, model: string | null | undefined): RateRow {
  if (model && map.has(model)) return map.get(model)!;
  // Fallback: try loose match (family)
  if (model) {
    for (const [k, v] of map) {
      if (model.startsWith(k) || k.startsWith(model)) return v;
    }
  }
  return { input_usd_per_1m: 0, output_usd_per_1m: 0, credits_per_usd: 100 };
}

export async function recordAiCost(input: RecordAiCostInput): Promise<void> {
  try {
    const rates = await loadRates();
    const rate = pickRate(rates, input.model ?? null);
    const inTok = Number(input.usage?.input_tokens ?? input.usage?.prompt_tokens ?? 0) || 0;
    const outTok = Number(input.usage?.output_tokens ?? input.usage?.completion_tokens ?? 0) || 0;
    const cached = Number(input.usage?.cached_tokens ?? 0) || 0;
    const usd = (inTok * rate.input_usd_per_1m + outTok * rate.output_usd_per_1m) / 1_000_000;
    const usdCents = usd * 100;
    const credits = usd * rate.credits_per_usd;

    await supabaseAdmin.from("ai_cost_events").insert({
      feature_key: input.feature_key,
      model: input.model ?? null,
      input_tokens: inTok,
      output_tokens: outTok,
      cached_tokens: cached,
      real_cost_usd_cents: Number(usdCents.toFixed(6)),
      real_cost_credits: Number(credits.toFixed(6)),
      points_charged: Number(input.points_charged ?? 0),
      company_id: input.company_id ?? null,
      actor_user_id: input.actor_user_id ?? null,
      job_id: input.job_id ?? null,
      aig_log_id: input.aig_log_id ?? null,
      aig_run_id: input.aig_run_id ?? null,
      surface: input.surface ?? null,
      duration_ms: input.duration_ms ?? null,
      status: input.status ?? "ok",
    });
  } catch (err) {
    // Never break primary flow because metering failed.
    console.warn("[ai-cost] record failed", err);
  }
}
