/**
 * Server-only auto-forwarding engine.
 * Called by the cron endpoint /api/public/cron/auto-forward and by
 * dispatch flows immediately after a partner rejects or when
 * `forward_after` (deadline) has elapsed.
 */
import { scheduleIsOpen } from "./availability.functions";

type Sched = {
  always_open: boolean;
  timezone: string;
  windows: { weekday: number; start_time: string; end_time: string }[];
  exceptions: { date: string; is_open: boolean; start_time: string | null; end_time: string | null }[];
};

async function loadSchedule(sb: any, owner_type: "company" | "driver", owner_id: string): Promise<Sched | null> {
  const { data: s } = await sb
    .from("availability_schedules")
    .select("id, timezone, always_open")
    .eq("owner_type", owner_type)
    .eq("owner_id", owner_id)
    .maybeSingle();
  if (!s) return null;
  const [{ data: w }, { data: e }] = await Promise.all([
    sb.from("availability_windows").select("weekday, start_time, end_time").eq("schedule_id", s.id),
    sb.from("availability_exceptions").select("date, is_open, start_time, end_time").eq("schedule_id", s.id),
  ]);
  return {
    always_open: s.always_open,
    timezone: s.timezone,
    windows: w ?? [],
    exceptions: (e ?? []).map((x: any) => ({
      date: x.date,
      is_open: x.is_open,
      start_time: x.start_time ?? null,
      end_time: x.end_time ?? null,
    })),
  };
}

async function pickNextCandidate(
  sb: any,
  ownerCompanyId: string,
  triedIds: string[],
  preferredIds: string[],
  at: Date,
): Promise<string | null> {
  // Active partners of owner
  const { data: conns } = await sb
    .from("coordinator_connections")
    .select("owner_company_id, partner_company_id, status")
    .eq("status", "accepted")
    .or(`owner_company_id.eq.${ownerCompanyId},partner_company_id.eq.${ownerCompanyId}`);
  const partnerIds = new Set<string>();
  for (const c of conns ?? []) {
    const other = c.owner_company_id === ownerCompanyId ? c.partner_company_id : c.owner_company_id;
    if (other && !triedIds.includes(other) && other !== ownerCompanyId) partnerIds.add(other);
  }
  // Preferred first
  const ordered = [
    ...preferredIds.filter((id) => partnerIds.has(id)),
    ...Array.from(partnerIds).filter((id) => !preferredIds.includes(id)),
  ];
  for (const pid of ordered) {
    const sched = await loadSchedule(sb, "company", pid);
    if (scheduleIsOpen(sched, at)) return pid;
  }
  return null;
}

/**
 * Attempt one forwarding hop. Returns the new executor id or null if no
 * candidate available (trip becomes "unassigned / needs manual attention").
 *
 * Charges the origin company `trip_auto_forward` points on each successful hop
 * via the existing spend_points() RPC (block_on_empty=false so it never stops
 * the trip from moving).
 */
export async function tryAutoForward(jobId: string, reason: "off_hours" | "unanswered" | "rejected"): Promise<
  { ok: true; new_executor_id: string } | { ok: false; reason: string }
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin;

  const { data: job, error } = await sb
    .from("jobs")
    .select("id, company_id, origin_company_id, executor_company_id, dispatch_chain_company_ids, forward_hop_count, forward_tried_company_ids, pickup_at, status")
    .eq("id", jobId)
    .single();
  if (error || !job) return { ok: false, reason: "job_not_found" };
  if (job.status && ["completed", "cancelled"].includes(job.status)) return { ok: false, reason: "trip_closed" };

  const originCompanyId = job.origin_company_id ?? job.company_id;
  const { data: policy } = await sb
    .from("availability_policies")
    .select("*")
    .eq("company_id", originCompanyId)
    .maybeSingle();

  if (!policy?.forwarding_enabled) return { ok: false, reason: "forwarding_disabled" };
  const maxHops = policy.max_forward_hops ?? 5;
  const hops = job.forward_hop_count ?? 0;
  if (hops >= maxHops) return { ok: false, reason: "max_hops_reached" };

  const tried: string[] = Array.isArray(job.forward_tried_company_ids) ? job.forward_tried_company_ids : [];
  const currentExec = job.executor_company_id ?? job.company_id;
  if (currentExec && !tried.includes(currentExec)) tried.push(currentExec);

  const at = job.pickup_at ? new Date(job.pickup_at) : new Date();
  const nextId = await pickNextCandidate(sb, originCompanyId, tried, policy.preferred_partner_ids ?? [], at);
  if (!nextId) return { ok: false, reason: "no_available_partner" };

  // Move executor + record audit
  const chain: string[] = Array.isArray(job.dispatch_chain_company_ids) ? job.dispatch_chain_company_ids : [];
  const nextChain = chain.includes(nextId) ? chain : [...chain, nextId];
  const { error: upErr } = await sb
    .from("jobs")
    .update({
      executor_company_id: nextId,
      dispatch_status: "pending",
      dispatch_chain_company_ids: nextChain,
      forward_hop_count: hops + 1,
      forward_tried_company_ids: [...tried, nextId],
      forward_after: null,
    })
    .eq("id", jobId);
  if (upErr) return { ok: false, reason: upErr.message };

  await sb.from("dispatch_forward_events").insert({
    job_id: jobId,
    from_company_id: currentExec,
    to_company_id: nextId,
    reason,
    points_charged: 0,
    meta: { hop: hops + 1 },
  });

  // Charge points (soft — never blocks the hop)
  try {
    await sb.rpc("spend_points", {
      _company_id: originCompanyId,
      _feature_key: "trip_auto_forward",
      _job_id: jobId as unknown as string,
      _note: `auto-forward hop ${hops + 1} → ${nextId} (${reason})`,
      _cost_override: undefined as unknown as number,
    });
  } catch {
    // ignore metering errors
  }

  return { ok: true, new_executor_id: nextId };
}

/**
 * Cron sweep: process every job whose forward_after deadline is due or which
 * is currently pending on an off-hours executor.
 */
export async function sweepAutoForward(): Promise<{ processed: number; forwarded: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin;
  const nowIso = new Date().toISOString();
  const { data: due } = await sb
    .from("jobs")
    .select("id")
    .eq("dispatch_status", "pending")
    .not("forward_after", "is", null)
    .lte("forward_after", nowIso)
    .limit(50);
  let forwarded = 0;
  for (const row of due ?? []) {
    const r = await tryAutoForward(row.id, "unanswered");
    if (r.ok) forwarded += 1;
  }
  return { processed: (due ?? []).length, forwarded };
}
