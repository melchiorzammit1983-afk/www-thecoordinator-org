/**
 * Server-only helper that auto-estimates a trip fare from the coordinator
 * pricing settings + service areas and writes it back onto the jobs row.
 *
 * Safe to call repeatedly — only fills or refreshes rows where the price was
 * unset OR previously auto-estimated. Manual coordinator/driver prices are
 * never overwritten.
 */
import { computeFareBreakdown, type FareArea, type FareSettings } from "./fare";

type SB = any;

async function admin(): Promise<SB> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as SB;
}

/** Pick the first active service area whose name appears in either endpoint. */
export function pickAreaFor(
  from: string | null,
  to: string | null,
  fromName: string | null,
  toName: string | null,
  areas: Array<FareArea & { name: string; active?: boolean; sort_order?: number }>,
): FareArea | null {
  const hay = [from, to, fromName, toName].filter(Boolean).join(" | ").toLowerCase();
  if (!hay) return null;
  const active = (areas ?? []).filter((a: any) => a && (a.active ?? true));
  const sorted = [...active].sort(
    (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  for (const a of sorted) {
    const needle = String((a as any).name ?? "").trim().toLowerCase();
    if (needle.length >= 3 && hay.includes(needle)) return a as any;
  }
  return null;
}

/**
 * Auto-price a single job. Returns the computed total (or null when we
 * couldn't estimate). Never overwrites a manual price.
 */
export async function autoPriceJob(jobId: string): Promise<number | null> {
  const sb = await admin();
  const { data: job } = await sb
    .from("jobs")
    .select(
      "id, company_id, from_location, to_location, pickup_display_name, dropoff_display_name, route_distance_m, route_duration_sec, price_amount, price_set_by",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  // Preserve manual prices — only fill nulls or refresh prior auto-estimates.
  const setBy = String((job as any).price_set_by ?? "").toLowerCase();
  const hasPrice = (job as any).price_amount != null;
  if (hasPrice && setBy && setBy !== "auto" && setBy !== "system") return null;

  const [{ data: co }, { data: areas }] = await Promise.all([
    sb
      .from("companies")
      .select(
        "currency, price_per_km, price_per_hour, minimum_fare, free_wait_minutes, waiting_rate_per_minute",
      )
      .eq("id", (job as any).company_id)
      .maybeSingle(),
    sb.from("service_areas" as any).select("*").eq("company_id", (job as any).company_id),
  ]);
  if (!co) return null;
  const settings = co as FareSettings;

  const km = Number((job as any).route_distance_m ?? 0) / 1000;
  const mins = Math.round(Number((job as any).route_duration_sec ?? 0) / 60);
  // If we have neither route data nor a company minimum fare, skip.
  if (km <= 0 && mins <= 0 && !Number(settings.minimum_fare ?? 0)) return null;

  const area = pickAreaFor(
    (job as any).from_location ?? null,
    (job as any).to_location ?? null,
    (job as any).pickup_display_name ?? null,
    (job as any).dropoff_display_name ?? null,
    (areas ?? []) as any,
  );

  const bd = computeFareBreakdown({ km, mins, waitMins: 0, settings, area });
  const total = Math.round(bd.fare * 100) / 100;
  if (!Number.isFinite(total) || total <= 0) return null;

  await sb
    .from("jobs")
    .update({
      price_amount: total,
      price_currency: bd.currency,
      price_set_by: "auto",
      price_set_at: new Date().toISOString(),
    } as any)
    .eq("id", jobId);
  return total;
}

/** Fire-and-forget wrapper so callers never block trip creation on pricing. */
export function autoPriceJobBg(jobId: string): void {
  autoPriceJob(jobId).catch((e) => {
    console.warn("[autoPriceJob] failed", jobId, e?.message ?? e);
  });
}
