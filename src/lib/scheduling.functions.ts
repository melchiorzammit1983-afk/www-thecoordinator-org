import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Driver schedule conflict detection.
 *
 * For a given driver + date (or a hypothetical assignment), evaluates each
 * adjacent trip pair to determine whether the driver can realistically
 * complete the earlier trip, hand off the passengers, and travel to the
 * next pickup on time — factoring drive time, traffic, and a passenger
 * drop-off buffer.
 *
 * Math:
 *   prev_end        = prev.pickup_at + prev.duration_sec
 *   handover_ready  = prev_end + PAX_DROPOFF_BUFFER_MIN
 *   transit_to_next = Routes API (prev.dropoff -> next.pickup, traffic-aware)
 *                     falls back to next.route_duration_sec of same-origin cache
 *   must_leave_by   = next.pickup_at - transit_to_next
 *   slack_min       = (must_leave_by - handover_ready) / 60
 *
 *   slack >= TIGHT_THRESHOLD_MIN => "free"
 *   0 <= slack <  TIGHT_THRESHOLD_MIN => "tight"
 *   slack < 0                      => "conflict"
 */

const PAX_DROPOFF_BUFFER_MIN = 10;
const TIGHT_THRESHOLD_MIN = 5;
const AVG_KMH_FALLBACK = 45; // used only if we truly cannot get a duration

export type ConflictSeverity = "free" | "tight" | "conflict";

export type ConflictPair = {
  prev_job_id: string;
  next_job_id: string;
  prev_pickup_at: string | null;
  next_pickup_at: string | null;
  prev_end_iso: string | null;
  must_leave_by_iso: string | null;
  slack_min: number;
  severity: ConflictSeverity;
  reason: string;
  transit_sec: number | null;
  buffer_min: number;
  prev_duration_sec: number | null;
  prev_from_label: string | null;
  prev_to_label: string | null;
  next_from_label: string | null;
  next_to_label: string | null;
};

export const SCHEDULING_CONSTANTS = {
  PAX_DROPOFF_BUFFER_MIN: 10,
  TIGHT_THRESHOLD_MIN: 5,
} as const;

type MinJob = {
  id: string;
  pickup_at: string | null;
  from_location: string | null;
  to_location: string | null;
  pickup_display_name: string | null;
  dropoff_display_name: string | null;
  route_duration_sec: number | null;
  group_id: string | null;
  status: string | null;
};

async function computeTransitSec(
  from_address: string,
  to_address: string,
): Promise<number | null> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) return null;
  try {
    const res = await fetch(
      "https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          "Content-Type": "application/json",
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: { address: from_address },
          destination: { address: to_address },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          languageCode: "en-GB",
          units: "METRIC",
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: Array<{ duration?: string }>;
    };
    const d = json.routes?.[0]?.duration;
    if (!d || !d.endsWith("s")) return null;
    return Number(d.slice(0, -1));
  } catch {
    return null;
  }
}

/**
 * In-memory cache for handover-leg drive times.
 *
 * Handover legs (prev.dropoff → next.pickup) are address-pair scoped and
 * traffic-aware but change slowly on a per-minute basis, so a short TTL
 * absorbs the repeated hits we get from:
 *   - the coordinator's 60s conflict poll,
 *   - reopening the driver picker,
 *   - `suggestAlternativeDrivers` scanning many drivers against the same
 *     candidate leg (all drivers share the identical prev→next segments).
 *
 * We also dedup concurrent identical requests via an inflight Promise map so a
 * burst of parallel evaluators fires exactly one Routes API call per leg.
 *
 * Cache is bounded to prevent unbounded growth in a long-lived Worker.
 */
const TRANSIT_TTL_MS = 5 * 60_000;
const TRANSIT_MAX_ENTRIES = 500;
type CacheEntry = { value: number; expires: number };
const transitCache = new Map<string, CacheEntry>();
const inflightTransit = new Map<string, Promise<number | null>>();

function transitCacheKey(from: string, to: string): string {
  return `${from.trim().toLowerCase()}||${to.trim().toLowerCase()}`;
}

function pruneTransitCache() {
  if (transitCache.size <= TRANSIT_MAX_ENTRIES) return;
  // Evict oldest expired first, then oldest overall (Map preserves insertion order).
  const now = Date.now();
  for (const [k, v] of transitCache) {
    if (v.expires <= now) transitCache.delete(k);
    if (transitCache.size <= TRANSIT_MAX_ENTRIES) return;
  }
  while (transitCache.size > TRANSIT_MAX_ENTRIES) {
    const firstKey = transitCache.keys().next().value as string | undefined;
    if (firstKey === undefined) break;
    transitCache.delete(firstKey);
  }
}

async function computeTransitSecCached(
  from_address: string,
  to_address: string,
): Promise<number | null> {
  const key = transitCacheKey(from_address, to_address);
  const hit = transitCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const inflight = inflightTransit.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    const value = await computeTransitSec(from_address, to_address);
    if (value != null) {
      transitCache.set(key, { value, expires: Date.now() + TRANSIT_TTL_MS });
      pruneTransitCache();
    }
    return value;
  })().finally(() => {
    inflightTransit.delete(key);
  });
  inflightTransit.set(key, promise);
  return promise;
}

function fmtHM(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function pickLabel(j: MinJob, kind: "pickup" | "dropoff"): string {
  if (kind === "pickup") return j.pickup_display_name || j.from_location || "pickup";
  return j.dropoff_display_name || j.to_location || "drop-off";
}

async function evaluatePairs(jobs: MinJob[]): Promise<ConflictPair[]> {
  const sorted = jobs
    .filter((j) => j.pickup_at)
    .sort(
      (a, b) => new Date(a.pickup_at!).getTime() - new Date(b.pickup_at!).getTime(),
    );

  const out: ConflictPair[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    // Grouped runs share a driver on purpose — no self-collision.
    if (prev.group_id && prev.group_id === next.group_id) continue;

    const prevStart = new Date(prev.pickup_at!).getTime();
    const nextStart = new Date(next.pickup_at!).getTime();
    const prevDur = prev.route_duration_sec ?? null;
    const prevEnd = prevDur != null ? prevStart + prevDur * 1000 : null;
    const handoverReady =
      prevEnd != null ? prevEnd + PAX_DROPOFF_BUFFER_MIN * 60_000 : null;

    // Transit prev.dropoff -> next.pickup. Prefer Routes API for accuracy,
    // fall back to a rough straight-line estimate when unavailable.
    let transitSec: number | null = null;
    const prevDrop = prev.dropoff_display_name || prev.to_location;
    const nextPick = next.pickup_display_name || next.from_location;
    if (prevDrop && nextPick) {
      transitSec = await computeTransitSec(prevDrop, nextPick);
    }
    // Rough fallback: if both addresses exist assume ~10km / AVG_KMH_FALLBACK
    if (transitSec == null) transitSec = Math.round((10 / AVG_KMH_FALLBACK) * 3600);

    const mustLeaveBy = nextStart - transitSec * 1000;
    const slackMin =
      handoverReady != null ? (mustLeaveBy - handoverReady) / 60_000 : Infinity;

    let severity: ConflictSeverity;
    if (slackMin >= TIGHT_THRESHOLD_MIN) severity = "free";
    else if (slackMin >= 0) severity = "tight";
    else severity = "conflict";

    const prevEndLbl = prevEnd ? fmtHM(new Date(prevEnd).toISOString()) : "?";
    const nextLbl = fmtHM(next.pickup_at);
    const buffer = PAX_DROPOFF_BUFFER_MIN;
    const transitMin = Math.round(transitSec / 60);
    const reason =
      severity === "conflict"
        ? `Prev trip ends ~${prevEndLbl}, +${buffer} min drop-off, +${transitMin} min drive → misses ${nextLbl} by ${Math.abs(Math.round(slackMin))} min.`
        : severity === "tight"
          ? `Prev ends ~${prevEndLbl} → ${nextLbl} pickup with only ${Math.round(slackMin)} min slack (needs ${transitMin} min drive + ${buffer} min drop-off).`
          : `Free — arrives with ${Math.round(slackMin)} min slack.`;

    out.push({
      prev_job_id: prev.id,
      next_job_id: next.id,
      prev_pickup_at: prev.pickup_at,
      next_pickup_at: next.pickup_at,
      prev_end_iso: prevEnd ? new Date(prevEnd).toISOString() : null,
      must_leave_by_iso: new Date(mustLeaveBy).toISOString(),
      slack_min: Number.isFinite(slackMin) ? Math.round(slackMin) : 9999,
      severity,
      reason,
      transit_sec: transitSec,
      buffer_min: PAX_DROPOFF_BUFFER_MIN,
      prev_duration_sec: prevDur,
      prev_from_label: pickLabel(prev, "pickup"),
      prev_to_label: pickLabel(prev, "dropoff"),
      next_from_label: pickLabel(next, "pickup"),
      next_to_label: pickLabel(next, "dropoff"),
    });
  }
  return out;
}

async function loadDriverDayJobs(
  supabase: any,
  driver_id: string,
  date: string,
): Promise<MinJob[]> {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, pickup_at, from_location, to_location, pickup_display_name, dropoff_display_name, route_duration_sec, group_id, status",
    )
    .eq("driver_id", driver_id)
    .gte("pickup_at", dayStart.toISOString())
    .lte("pickup_at", dayEnd.toISOString())
    .not("status", "in", "(completed,cancelled)");
  if (error) throw new Error(error.message);
  return (data as MinJob[]) ?? [];
}

export const checkDriverConflicts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        driver_id: z.string().uuid(),
        date: z.string().min(8), // YYYY-MM-DD
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const jobs = await loadDriverDayJobs(context.supabase, data.driver_id, data.date);
    const pairs = await evaluatePairs(jobs);
    // Roll up per-job worst severity so UI can badge any job that is part
    // of a conflict pair without re-doing the math.
    const perJob: Record<string, { severity: ConflictSeverity; pairs: ConflictPair[] }> = {};
    for (const p of pairs) {
      for (const jid of [p.prev_job_id, p.next_job_id]) {
        const cur = perJob[jid];
        const worse =
          !cur || rank(p.severity) > rank(cur.severity) ? p.severity : cur.severity;
        perJob[jid] = { severity: worse, pairs: [...(cur?.pairs ?? []), p] };
      }
    }
    return { pairs, perJob };
  });

export const previewAssignmentConflicts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        driver_id: z.string().uuid(),
        job_id: z.string().uuid().optional(),
        // Hypothetical job payload (used when creating a new trip that isn't
        // saved yet). Ignored if job_id is provided.
        candidate: z
          .object({
            id: z.string().optional(),
            pickup_at: z.string(),
            from_location: z.string(),
            to_location: z.string(),
            pickup_display_name: z.string().nullable().optional(),
            dropoff_display_name: z.string().nullable().optional(),
            route_duration_sec: z.number().nullable().optional(),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let existing: MinJob[] = [];
    let candidate: MinJob | null = null;

    if (data.job_id) {
      const { data: j } = await context.supabase
        .from("jobs")
        .select(
          "id, pickup_at, from_location, to_location, pickup_display_name, dropoff_display_name, route_duration_sec, group_id, status",
        )
        .eq("id", data.job_id)
        .maybeSingle();
      if (!j?.pickup_at) return { pairs: [], severity: "free" as ConflictSeverity };
      candidate = j as MinJob;
    } else if (data.candidate) {
      candidate = {
        id: data.candidate.id ?? "__candidate__",
        pickup_at: data.candidate.pickup_at,
        from_location: data.candidate.from_location,
        to_location: data.candidate.to_location,
        pickup_display_name: data.candidate.pickup_display_name ?? null,
        dropoff_display_name: data.candidate.dropoff_display_name ?? null,
        route_duration_sec: data.candidate.route_duration_sec ?? null,
        group_id: null,
        status: "pending",
      };
    } else {
      return { pairs: [], severity: "free" as ConflictSeverity };
    }

    const date = candidate.pickup_at!.slice(0, 10);
    existing = await loadDriverDayJobs(context.supabase, data.driver_id, date);
    // Drop the candidate itself if it's already in the list (job_id path).
    const merged = [
      ...existing.filter((j) => j.id !== candidate!.id),
      candidate,
    ];
    const pairs = await evaluatePairs(merged);
    const involved = pairs.filter(
      (p) => p.prev_job_id === candidate!.id || p.next_job_id === candidate!.id,
    );
    const worst = involved.reduce<ConflictSeverity>(
      (acc, p) => (rank(p.severity) > rank(acc) ? p.severity : acc),
      "free",
    );
    return { pairs: involved, severity: worst };
  });

function rank(s: ConflictSeverity): number {
  return s === "conflict" ? 2 : s === "tight" ? 1 : 0;
}

/**
 * Given a set of candidate drivers, evaluate each one against the same trip
 * (existing job_id or a candidate payload) and return them ranked from best
 * to worst — "free" first (largest slack), then "tight", then "conflict".
 * Used by the driver picker to suggest a better alternative when the currently
 * selected driver would collide.
 */
export const suggestAlternativeDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        driver_ids: z.array(z.string().uuid()).min(1).max(50),
        exclude_driver_id: z.string().uuid().nullable().optional(),
        job_id: z.string().uuid().optional(),
        candidate: z
          .object({
            id: z.string().optional(),
            pickup_at: z.string(),
            from_location: z.string(),
            to_location: z.string(),
            pickup_display_name: z.string().nullable().optional(),
            dropoff_display_name: z.string().nullable().optional(),
            route_duration_sec: z.number().nullable().optional(),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Resolve the candidate MinJob once.
    let candidate: MinJob | null = null;
    if (data.job_id) {
      const { data: j } = await context.supabase
        .from("jobs")
        .select(
          "id, pickup_at, from_location, to_location, pickup_display_name, dropoff_display_name, route_duration_sec, group_id, status",
        )
        .eq("id", data.job_id)
        .maybeSingle();
      if (j?.pickup_at) candidate = j as MinJob;
    } else if (data.candidate?.pickup_at) {
      candidate = {
        id: data.candidate.id ?? "__candidate__",
        pickup_at: data.candidate.pickup_at,
        from_location: data.candidate.from_location,
        to_location: data.candidate.to_location,
        pickup_display_name: data.candidate.pickup_display_name ?? null,
        dropoff_display_name: data.candidate.dropoff_display_name ?? null,
        route_duration_sec: data.candidate.route_duration_sec ?? null,
        group_id: null,
        status: "pending",
      };
    }
    if (!candidate) return { suggestions: [] as Array<{ driver_id: string; severity: ConflictSeverity; min_slack_min: number; pairs: ConflictPair[] }> };

    const date = candidate.pickup_at!.slice(0, 10);
    const excluded = data.exclude_driver_id ?? null;
    const targets = data.driver_ids.filter((id) => id !== excluded);

    const results = await Promise.all(
      targets.map(async (driver_id) => {
        const existing = await loadDriverDayJobs(context.supabase, driver_id, date);
        const merged = [...existing.filter((j) => j.id !== candidate!.id), candidate!];
        const pairs = await evaluatePairs(merged);
        const involved = pairs.filter(
          (p) => p.prev_job_id === candidate!.id || p.next_job_id === candidate!.id,
        );
        const worst = involved.reduce<ConflictSeverity>(
          (acc, p) => (rank(p.severity) > rank(acc) ? p.severity : acc),
          "free",
        );
        const minSlack = involved.length
          ? Math.min(...involved.map((p) => p.slack_min))
          : 9999;
        return { driver_id, severity: worst, min_slack_min: minSlack, pairs: involved };
      }),
    );

    results.sort((a, b) => {
      const r = rank(a.severity) - rank(b.severity);
      if (r !== 0) return r;
      return b.min_slack_min - a.min_slack_min;
    });
    return { suggestions: results };
  });
