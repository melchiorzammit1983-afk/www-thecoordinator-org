import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordTripAudit } from "@/lib/trip-audit.server";


/**
 * Batch D — AI Route Optimization
 *
 * Uses:
 *   - Google Distance Matrix (via Lovable connector gateway) to score
 *     the current and suggested orderings.
 *   - Lovable AI (google/gemini-3.5-flash) to propose an improved
 *     order given stops, pax counts, and any recorded pickup windows.
 *
 * Coordinator MUST approve — no automatic reordering.
 */

const GATEWAY = "https://connector-gateway.lovable.dev";

async function dmDurationBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  lovableKey: string,
  mapsKey: string,
): Promise<{ distance_m: number; duration_s: number } | null> {
  const url =
    `${GATEWAY}/google_maps/maps/api/distancematrix/json` +
    `?origins=${from.lat},${from.lng}` +
    `&destinations=${to.lat},${to.lng}` +
    `&departure_time=now&traffic_model=best_guess`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": mapsKey,
    },
  });
  if (!res.ok) return null;
  const body: any = await res.json();
  const el = body?.rows?.[0]?.elements?.[0];
  if (!el || el.status !== "OK") return null;
  const dur = el.duration_in_traffic?.value ?? el.duration?.value ?? null;
  const dist = el.distance?.value ?? null;
  if (dur == null || dist == null) return null;
  return { distance_m: dist, duration_s: dur };
}

async function scoreOrder(
  stops: Array<{ id: string; lat: number | null; lng: number | null }>,
  order: string[],
  lovableKey: string,
  mapsKey: string,
): Promise<{ distance_m: number; duration_s: number } | null> {
  let totalDist = 0;
  let totalDur = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const a = stops.find((s) => s.id === order[i]);
    const b = stops.find((s) => s.id === order[i + 1]);
    if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
    const leg = await dmDurationBetween(
      { lat: a.lat, lng: a.lng },
      { lat: b.lat, lng: b.lng },
      lovableKey,
      mapsKey,
    );
    if (!leg) return null;
    totalDist += leg.distance_m;
    totalDur += leg.duration_s;
  }
  return { distance_m: totalDist, duration_s: totalDur };
}

export const suggestRouteOptimization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ group_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Resolve group + job + company
    const { data: group, error: gErr } = await supabase
      .from("groups")
      .select("id, job_id, jobs:job_id(company_id)")
      .eq("id", data.group_id)
      .maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!group || !group.job_id) throw new Error("group_not_found");
    const company_id = (group as any).jobs?.company_id as string | undefined;
    if (!company_id) throw new Error("group_company_missing");

    // Load stops
    const { data: stops, error: sErr } = await supabase
      .from("group_stops")
      .select("id, stop_index, address, display_name, lat, lng, pax_count")
      .eq("group_id", data.group_id)
      .order("stop_index", { ascending: true });
    if (sErr) throw new Error(sErr.message);
    if (!stops || stops.length < 3) throw new Error("need_at_least_three_stops");
    if (stops.some((s: any) => s.lat == null || s.lng == null)) {
      throw new Error("all_stops_need_coordinates");
    }

    const lovableKey = process.env.LOVABLE_API_KEY;
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !mapsKey) throw new Error("gateway_not_configured");

    // Respect the coordinator's per-feature opt-out before billing.
    const { assertUserFeatureEnabled } = await import("@/lib/user-feature-prefs.server");
    await assertUserFeatureEnabled(supabase, company_id, "route_optimization");

    // Bill points BEFORE the AI call — spend_points throws on empty balance.
    const { error: spendErr } = await supabase.rpc("spend_points", {
      _company_id: company_id,
      _feature_key: "route_optimization",
      _job_id: group.job_id,
      _note: `route optimization suggestion (${stops.length} stops)`,
    });
    if (spendErr) throw new Error(spendErr.message);

    // Original order + score
    const originalOrder: string[] = stops.map((s: any) => s.id);
    const originalScore = await scoreOrder(stops as any, originalOrder, lovableKey, mapsKey);

    // Ask the AI for a suggested order
    const prompt = [
      "You are a routing optimizer for a Malta ground-transport dispatcher.",
      "Given the list of stops below, produce the best pickup order to minimise total driving time.",
      'Return ONLY a JSON object of shape { "order": ["<stop-id>", ...], "reasoning": "<short human explanation>" }.',
      "The order MUST include every stop id exactly once.",
      "",
      "Stops:",
      JSON.stringify(
        stops.map((s: any) => ({
          id: s.id,
          address: s.display_name || s.address,
          lat: s.lat,
          lng: s.lng,
          pax_count: s.pax_count,
        })),
        null,
        2,
      ),
    ].join("\n");

    const model = "google/gemini-3.5-flash";
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableKey,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!aiRes.ok) {
      const t = await aiRes.text().catch(() => "");
      throw new Error(`ai_${aiRes.status}: ${t.slice(0, 200)}`);
    }
    const aiJson: any = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { order?: string[]; reasoning?: string } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("ai_returned_non_json");
    }
    const suggestedOrder = parsed.order ?? [];
    // Validate: same set of ids
    const validIds = new Set(originalOrder);
    if (
      suggestedOrder.length !== originalOrder.length ||
      !suggestedOrder.every((id) => validIds.has(id)) ||
      new Set(suggestedOrder).size !== suggestedOrder.length
    ) {
      throw new Error("ai_returned_invalid_order");
    }

    const suggestedScore = await scoreOrder(stops as any, suggestedOrder, lovableKey, mapsKey);

    // Supersede any older pending row for the same group
    await supabase
      .from("group_route_optimizations")
      .update({ status: "superseded" })
      .eq("group_id", data.group_id)
      .eq("status", "pending");

    const { data: inserted, error: iErr } = await supabase
      .from("group_route_optimizations")
      .insert({
        group_id: data.group_id,
        job_id: group.job_id,
        company_id,
        original_order: originalOrder,
        suggested_order: suggestedOrder,
        status: "pending",
        model,
        reasoning: parsed.reasoning ?? null,
        distance_meters_original: originalScore?.distance_m ?? null,
        distance_meters_suggested: suggestedScore?.distance_m ?? null,
        duration_seconds_original: originalScore?.duration_s ?? null,
        duration_seconds_suggested: suggestedScore?.duration_s ?? null,
        requested_by_user_id: userId,
      })
      .select("*")
      .single();
    if (iErr) throw new Error(iErr.message);

    return inserted;
  });

export const listGroupRouteOptimizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ group_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("group_route_optimizations")
      .select("*")
      .eq("group_id", data.group_id)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const approveRouteOptimization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("group_route_optimizations")
      .select("id, group_id, job_id, suggested_order, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("optimization_not_found");
    if (row.status !== "pending") throw new Error("optimization_not_pending");

    // Rewrite stop_index in the suggested order
    for (let i = 0; i < row.suggested_order.length; i++) {
      const { error: uErr } = await supabase
        .from("group_stops")
        .update({ stop_index: i })
        .eq("id", row.suggested_order[i])
        .eq("group_id", row.group_id);
      if (uErr) throw new Error(uErr.message);
    }

    // Supersede pending driver reorder requests
    await supabase
      .from("group_stop_reorder_requests")
      .update({ status: "superseded" })
      .eq("group_id", row.group_id)
      .eq("status", "pending");

    const { error: uErr } = await supabase
      .from("group_route_optimizations")
      .update({
        status: "approved",
        approved_order: row.suggested_order,
        decided_by_user_id: userId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (uErr) throw new Error(uErr.message);

    await recordTripAudit({
      job_id: row.job_id,
      event_type: "route_optimization_approved",
      new: { optimization_id: row.id, approved_order: row.suggested_order },
      group_id: row.group_id,
      approval_status: "approved",
      actor_label: "coordinator",
      actor_user_id: userId,
    });


    return { ok: true };
  });

export const rejectRouteOptimization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), note: z.string().max(500).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("group_route_optimizations")
      .select("id, group_id, job_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("optimization_not_found");
    if (row.status !== "pending") throw new Error("optimization_not_pending");

    const { error: uErr } = await supabase
      .from("group_route_optimizations")
      .update({
        status: "rejected",
        decided_by_user_id: userId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (uErr) throw new Error(uErr.message);

    await recordTripAudit({
      job_id: row.job_id,
      event_type: "route_optimization_rejected",
      new: { optimization_id: row.id, note: data.note ?? null },
      group_id: row.group_id,
      approval_status: "rejected",
      actor_label: "coordinator",
      actor_user_id: userId,
    });


    return { ok: true };
  });

/**
 * Company-scoped listing of pending optimizations. Powers the coordinator
 * calendar alerts (red-dot badge, banner, toast, sound).
 */
export const listPendingRouteOptimizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("group_route_optimizations")
      .select("id, group_id, job_id, created_at, reasoning, duration_seconds_original, duration_seconds_suggested")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

