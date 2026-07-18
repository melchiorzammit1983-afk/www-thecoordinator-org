/**
 * AI Watchtower — opt-in, points-metered proactive monitoring.
 *
 * The coordinator turns this on from the dashboard; every scan charges
 * `ai_watchtower_scan` points via `spend_points`. Nothing runs unless the
 * user explicitly enables it, and a per-user daily cap prevents runaway
 * spend even if the tab is left open.
 *
 * Scan logic is deterministic (no per-scan AI cost by default): it looks at
 * today's active jobs for flight disruptions, ETA slippage, driver conflicts
 * and obvious data problems. Deduping via (company_id, dedupe_key) means an
 * unchanged issue does not re-notify on every tick.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KINDS = ["flight", "execution", "conflict", "data"] as const;
export type WatchKind = (typeof KINDS)[number];

async function getCompanyId(sb: any, userId: string): Promise<string | null> {
  const { data } = await sb
    .from("companies")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

async function loadSettings(sb: any, userId: string) {
  const { data } = await sb
    .from("watchtower_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data;
  const { data: created } = await sb
    .from("watchtower_settings")
    .insert({ user_id: userId })
    .select("*")
    .single();
  return created;
}

export const getWatchtowerSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const s = await loadSettings(supabaseAdmin, context.userId);
    const { data: cost } = await supabaseAdmin
      .from("ai_feature_costs")
      .select("points_cost")
      .eq("feature_key", "ai_watchtower_scan")
      .maybeSingle();
    return { settings: s, points_per_scan: Number(cost?.points_cost ?? 1) };
  });

export const saveWatchtowerSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        enabled: z.boolean().optional(),
        interval_sec: z.number().int().min(60).max(3600).optional(),
        severity_min: z.number().int().min(1).max(5).optional(),
        kinds: z.array(z.enum(KINDS)).optional(),
        daily_scan_cap: z.number().int().min(10).max(2000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await loadSettings(supabaseAdmin, context.userId); // ensures row exists
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.interval_sec !== undefined) patch.interval_sec = data.interval_sec;
    if (data.severity_min !== undefined) patch.severity_min = data.severity_min;
    if (data.kinds !== undefined) patch.kinds = data.kinds;
    if (data.daily_scan_cap !== undefined) patch.daily_scan_cap = data.daily_scan_cap;
    const { data: updated } = await supabaseAdmin
      .from("watchtower_settings")
      .update(patch as never)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    return { settings: updated };
  });

export const listWatchtowerAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const companyId = await getCompanyId(supabaseAdmin, context.userId);
    if (!companyId) return { alerts: [] };
    const { data } = await supabaseAdmin
      .from("watchtower_alerts")
      .select("*")
      .eq("company_id", companyId)
      .in("status", ["new", "acknowledged"])
      .order("created_at", { ascending: false })
      .limit(50);
    return { alerts: data ?? [] };
  });

export const acknowledgeWatchtowerAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["acknowledged", "dismissed", "resolved"]).default("dismissed"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const companyId = await getCompanyId(supabaseAdmin, context.userId);
    if (!companyId) return { ok: false };
    await supabaseAdmin
      .from("watchtower_alerts")
      .update({
        status: data.status,
        resolved_at:
          data.status === "resolved" || data.status === "dismissed" ? new Date().toISOString() : null,
      })
      .eq("id", data.id)
      .eq("company_id", companyId);
    return { ok: true };
  });

type Finding = {
  kind: WatchKind;
  severity: number;
  title: string;
  body: string;
  job_id: string | null;
  dedupe_key: string;
  suggested_actions: { label: string; href?: string }[];
};

function detectFindings(jobs: any[], kinds: WatchKind[], severityMin: number): Finding[] {
  const now = Date.now();
  const found: Finding[] = [];
  const wantFlight = kinds.includes("flight");
  const wantExec = kinds.includes("execution");
  const wantConflict = kinds.includes("conflict");
  const wantData = kinds.includes("data");

  // Driver workload counts (for conflict/imbalance)
  const perDriver: Record<string, number> = {};

  for (const j of jobs) {
    if (!j || !j.id) continue;
    const pickupMs = j.pickup_at ? new Date(j.pickup_at).getTime() : null;

    if (j.driver_id) perDriver[j.driver_id] = (perDriver[j.driver_id] ?? 0) + 1;

    // 1) Flight disruptions
    if (wantFlight && j.flight_status && j.flight_status !== "on_time") {
      const bad = ["delayed", "cancelled", "diverted"].includes(String(j.flight_status).toLowerCase());
      if (bad) {
        found.push({
          kind: "flight",
          severity: j.flight_status === "cancelled" ? 5 : 4,
          title: `Flight ${j.from_flight ?? j.to_flight ?? ""} ${j.flight_status}`.trim(),
          body:
            j.flight_status_note?.toString().slice(0, 200) ||
            "Client's flight status changed. Consider adjusting pickup time or notifying the driver.",
          job_id: j.id,
          dedupe_key: `flight:${j.id}:${j.flight_status}:${j.flight_estimated_at ?? ""}`,
          suggested_actions: [{ label: "Open trip", href: `/coordinator/calendar` }],
        });
      }
    }

    // 2) Execution issues: driver ETA past pickup, or trip stalled with no status
    if (wantExec && pickupMs) {
      if (j.driver_id && j.live_eta_sec != null && j.live_eta_updated_at) {
        const arrivalMs = new Date(j.live_eta_updated_at).getTime() + j.live_eta_sec * 1000;
        const slipMin = Math.round((arrivalMs - pickupMs) / 60000);
        if (slipMin >= 5 && arrivalMs > now) {
          found.push({
            kind: "execution",
            severity: slipMin >= 15 ? 4 : 3,
            title: `Driver ~${slipMin} min late to pickup`,
            body: `Live ETA puts the driver ${slipMin} minutes past scheduled pickup. Notify the client or reassign.`,
            job_id: j.id,
            dedupe_key: `late:${j.id}:${Math.floor(slipMin / 5)}`,
            suggested_actions: [{ label: "Open trip", href: `/coordinator/calendar` }],
          });
        }
      }
      // Stalled: pickup already past + no driver + not cancelled/completed
      if (
        !j.driver_id &&
        pickupMs < now - 10 * 60_000 &&
        !["completed", "cancelled"].includes(String(j.status))
      ) {
        found.push({
          kind: "execution",
          severity: 5,
          title: "Trip past pickup with no driver",
          body: "This trip is already past its scheduled pickup and still has no driver assigned.",
          job_id: j.id,
          dedupe_key: `stalled:${j.id}:${Math.floor(pickupMs / (5 * 60_000))}`,
          suggested_actions: [{ label: "Assign driver", href: `/coordinator/calendar` }],
        });
      }
    }

    // 4) Data problems: unresolved address (still shows plus-code / raw geo)
    if (wantData) {
      const bad = (s: string | null | undefined) =>
        !s || /^[0-9+.,\-\s]+$/.test(s) || /^\S{4,}\+\S{2,}/.test(s);
      if (bad(j.pickup_display_name) && bad(j.from_location)) {
        found.push({
          kind: "data",
          severity: 2,
          title: "Pickup has no readable name",
          body: "The pickup address didn't resolve to a business or landmark. Edit the trip to add a name.",
          job_id: j.id,
          dedupe_key: `data-pickup:${j.id}`,
          suggested_actions: [{ label: "Open trip", href: `/coordinator/calendar` }],
        });
      }
    }
  }

  // 3) Driver workload imbalance
  if (wantConflict) {
    const counts = Object.values(perDriver);
    if (counts.length >= 2) {
      const max = Math.max(...counts);
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      if (max >= 4 && max >= avg * 2) {
        const [drvId] = Object.entries(perDriver).find(([, n]) => n === max) ?? [];
        found.push({
          kind: "conflict",
          severity: 2,
          title: "One driver has much more work than the others",
          body: `A driver is booked for ${max} trips today (team average ${avg.toFixed(1)}). Consider rebalancing.`,
          job_id: null,
          dedupe_key: `imbalance:${drvId ?? "x"}:${max}`,
          suggested_actions: [{ label: "Open drivers", href: `/coordinator/drivers` }],
        });
      }
    }
  }

  return found.filter((f) => f.severity >= severityMin);
}

export const runWatchtowerScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const companyId = await getCompanyId(supabaseAdmin, context.userId);
    if (!companyId) return { ok: false, reason: "no_company" as const };

    const s = await loadSettings(supabaseAdmin, context.userId);
    if (!s.enabled) return { ok: false, reason: "disabled" as const };

    // Reset daily counter
    const today = new Date().toISOString().slice(0, 10);
    const scansToday = s.scans_reset_on === today ? s.scans_today : 0;
    if (scansToday >= s.daily_scan_cap) {
      return { ok: false, reason: "daily_cap_reached" as const };
    }

    // Meter (soft — but we treat failure as pause)
    let charged = true;
    try {
      const { error } = await supabaseAdmin.rpc("spend_points", {
        _company_id: companyId,
        _feature_key: "ai_watchtower_scan",
        _job_id: undefined as unknown as string,
        _note: "watchtower scan",
        _cost_override: undefined as unknown as number,
      });
      if (error) charged = false;
    } catch {
      charged = false;
    }
    if (!charged) {
      await supabaseAdmin
        .from("watchtower_settings")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("user_id", context.userId);
      return { ok: false, reason: "insufficient_points" as const };
    }

    // Scan today's + upcoming (24h) active jobs
    const fromIso = new Date(Date.now() - 2 * 3600_000).toISOString();
    const toIso = new Date(Date.now() + 24 * 3600_000).toISOString();
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select(
        "id, status, pickup_at, driver_id, from_location, to_location, pickup_display_name, dropoff_display_name, from_flight, to_flight, flight_status, flight_status_note, flight_estimated_at, live_eta_sec, live_eta_updated_at",
      )
      .eq("company_id", companyId)
      .gte("pickup_at", fromIso)
      .lte("pickup_at", toIso)
      .not("status", "in", "(completed,cancelled)")
      .limit(200);

    const kinds = (s.kinds ?? ["flight", "execution", "conflict", "data"]) as WatchKind[];
    const findings = detectFindings(jobs ?? [], kinds, s.severity_min);

    // Upsert alerts (dedupe by company_id + dedupe_key)
    let inserted = 0;
    for (const f of findings) {
      const { error } = await supabaseAdmin
        .from("watchtower_alerts")
        .upsert(
          {
            company_id: companyId,
            job_id: f.job_id,
            kind: f.kind,
            severity: f.severity,
            title: f.title,
            body: f.body,
            suggested_actions: f.suggested_actions as never,
            dedupe_key: f.dedupe_key,
            status: "new",
          },
          { onConflict: "company_id,dedupe_key", ignoreDuplicates: true },
        )
        .select("id");
      if (!error) inserted += 1;
    }

    await supabaseAdmin
      .from("watchtower_settings")
      .update({
        scans_today: scansToday + 1,
        scans_reset_on: today,
        last_scan_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId);

    return {
      ok: true as const,
      scanned: jobs?.length ?? 0,
      findings: findings.length,
      new_alerts: inserted,
      scans_today: scansToday + 1,
      daily_scan_cap: s.daily_scan_cap,
    };
  });
