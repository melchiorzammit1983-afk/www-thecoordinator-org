/**
 * Dispatch default rules — coordinators define time-of-day / day-of-week
 * routing rules (e.g. "Weekdays 12:30–17:00 → Driver A"). Rules never
 * auto-apply; they surface as proposals that the coordinator confirms
 * from the calendar/dispatch settings page.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function myCompany(ctx: Ctx) {
  const sb = await getAdmin();
  const { data } = await sb.from("companies").select("id").eq("owner_user_id", ctx.userId).maybeSingle();
  if (!data) throw new Error("No company assigned to this account");
  return data.id as string;
}

const ruleInput = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(120),
  days_of_week: z.array(z.number().int().min(0).max(6)).max(7),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  target_type: z.enum(["driver", "partner"]),
  target_id: z.string().uuid(),
  enabled: z.boolean().default(true),
});

export type DispatchRule = {
  id: string;
  company_id: string;
  label: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  target_type: "driver" | "partner";
  target_id: string;
  target_name?: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export const listDispatchRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await myCompany(context);
    const sb = await getAdmin();
    const { data: rules, error } = await sb
      .from("dispatch_default_rules")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (rules ?? []) as DispatchRule[];
    // Enrich with human names
    const driverIds = rows.filter((r) => r.target_type === "driver").map((r) => r.target_id);
    const partnerIds = rows.filter((r) => r.target_type === "partner").map((r) => r.target_id);
    const nameMap = new Map<string, string>();
    if (driverIds.length) {
      const { data } = await sb.from("drivers").select("id,name").in("id", driverIds);
      (data ?? []).forEach((d: any) => nameMap.set(`d:${d.id}`, d.name));
    }
    if (partnerIds.length) {
      const { data } = await sb.from("companies").select("id,name").in("id", partnerIds);
      (data ?? []).forEach((c: any) => nameMap.set(`p:${c.id}`, c.name));
    }
    return rows.map((r) => ({
      ...r,
      target_name: nameMap.get(`${r.target_type === "driver" ? "d" : "p"}:${r.target_id}`) ?? null,
    }));
  });

export const upsertDispatchRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ruleInput.parse(i))
  .handler(async ({ data, context }) => {
    const companyId = await myCompany(context);
    const sb = await getAdmin();
    const payload = { ...data, company_id: companyId };
    if (data.id) {
      const { error } = await sb.from("dispatch_default_rules").update(payload).eq("id", data.id).eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await sb.from("dispatch_default_rules").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id as string };
  });

export const deleteDispatchRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const companyId = await myCompany(context);
    const sb = await getAdmin();
    const { error } = await sb.from("dispatch_default_rules").delete().eq("id", data.id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Evaluate active rules against upcoming unassigned trips and return
 * proposals for confirmation. If job_ids is empty, scans the next 14 days
 * of unassigned trips.
 */
export const evaluateDispatchRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ job_ids: z.array(z.string().uuid()).max(200).optional() })
      .optional()
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const companyId = await myCompany(context);
    const sb = await getAdmin();
    const { data: rules } = await sb
      .from("dispatch_default_rules")
      .select("*")
      .eq("company_id", companyId)
      .eq("enabled", true);
    const active = (rules ?? []) as DispatchRule[];
    if (!active.length) return { proposals: [] };

    let jobsQ = sb
      .from("jobs")
      .select("id, pickup_at, driver_id, status, from_location, to_location, dispatched_to_company_id")
      .eq("company_id", companyId)
      .is("driver_id", null)
      .is("dispatched_to_company_id", null);
    if (data?.job_ids?.length) jobsQ = jobsQ.in("id", data.job_ids);
    else {
      const now = new Date();
      const until = new Date(now.getTime() + 14 * 24 * 3600_000);
      jobsQ = jobsQ.gte("pickup_at", now.toISOString()).lte("pickup_at", until.toISOString());
    }
    const { data: jobs } = await jobsQ.limit(200);

    // Enrich names for the response
    const dIds = Array.from(new Set(active.filter((r) => r.target_type === "driver").map((r) => r.target_id)));
    const pIds = Array.from(new Set(active.filter((r) => r.target_type === "partner").map((r) => r.target_id)));
    const nameMap = new Map<string, string>();
    if (dIds.length) {
      const { data } = await sb.from("drivers").select("id,name").in("id", dIds);
      (data ?? []).forEach((d: any) => nameMap.set(`d:${d.id}`, d.name));
    }
    if (pIds.length) {
      const { data } = await sb.from("companies").select("id,name").in("id", pIds);
      (data ?? []).forEach((c: any) => nameMap.set(`p:${c.id}`, c.name));
    }

    const proposals: Array<{
      job_id: string;
      pickup_at: string;
      from_location: string | null;
      to_location: string | null;
      rule_id: string;
      rule_label: string;
      target_type: "driver" | "partner";
      target_id: string;
      target_name: string;
    }> = [];

    for (const j of (jobs ?? []) as any[]) {
      const at = new Date(j.pickup_at);
      const dow = at.getUTCDay(); // treat pickup_at UTC dow — good enough for Malta short local ranges
      const hh = String(at.getHours()).padStart(2, "0");
      const mm = String(at.getMinutes()).padStart(2, "0");
      const t = `${hh}:${mm}`;
      const match = active.find((r) => {
        if (!r.days_of_week.includes(dow)) return false;
        const s = r.start_time.slice(0, 5);
        const e = r.end_time.slice(0, 5);
        return t >= s && t <= e;
      });
      if (!match) continue;
      const key = `${match.target_type === "driver" ? "d" : "p"}:${match.target_id}`;
      proposals.push({
        job_id: j.id,
        pickup_at: j.pickup_at,
        from_location: j.from_location,
        to_location: j.to_location,
        rule_id: match.id,
        rule_label: match.label,
        target_type: match.target_type,
        target_id: match.target_id,
        target_name: nameMap.get(key) ?? "(unknown)",
      });
    }
    return { proposals };
  });

/**
 * Apply a single dispatch-rule proposal: assign the driver, or hand off to
 * the partner. Reuses existing helpers where possible.
 */
export const applyDispatchRuleProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        target_type: z.enum(["driver", "partner"]),
        target_id: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const companyId = await myCompany(context);
    const sb = await getAdmin();
    // Verify job belongs to this company
    const { data: job } = await sb.from("jobs").select("id, company_id").eq("id", data.job_id).maybeSingle();
    if (!job || job.company_id !== companyId) throw new Error("Trip not found");
    if (data.target_type === "driver") {
      const { error } = await sb.from("jobs").update({ driver_id: data.target_id }).eq("id", data.job_id);
      if (error) throw new Error(error.message);
    } else {
      const { dispatchJobToPartnerInternal } = await import("./coordinator.functions");
      await dispatchJobToPartnerInternal(sb, companyId, data.job_id, data.target_id, "via dispatch rule");
    }
    return { ok: true };
  });
