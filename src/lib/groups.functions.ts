import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertGroupCompany(supabase: any, group_id: string, userId: string) {
  const { data, error } = await supabase
    .from("groups")
    .select("id, job_id, jobs:job_id(company_id)")
    .eq("id", group_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("group_not_found");
  return data;
}

export const listGroupStops = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ group_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: stops, error } = await supabase
      .from("group_stops")
      .select("*")
      .eq("group_id", data.group_id)
      .order("stop_index", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: pending } = await supabase
      .from("group_stop_reorder_requests")
      .select("id, requested_by_driver_id, proposed_order, status, created_at")
      .eq("group_id", data.group_id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    return { stops: stops ?? [], pending_reorders: pending ?? [] };
  });

export const reorderStops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        group_id: z.string().uuid(),
        ordered_stop_ids: z.array(z.string().uuid()).min(1),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const group = await assertGroupCompany(supabase, data.group_id, userId);
    for (let i = 0; i < data.ordered_stop_ids.length; i++) {
      const { error } = await supabase
        .from("group_stops")
        .update({ stop_index: i })
        .eq("id", data.ordered_stop_ids[i])
        .eq("group_id", data.group_id);
      if (error) throw new Error(error.message);
    }
    if (group.job_id) {
      await supabase.rpc("record_trip_audit", {
        _job_id: group.job_id,
        _event_type: "stop_reordered",
        _new: { ordered_stop_ids: data.ordered_stop_ids } as any,
        _group_id: data.group_id,
        _approval_status: "approved",
        _actor_label: "coordinator",
      });
    }
    return { ok: true };
  });

export const splitGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        group_id: z.string().uuid(),
        stop_ids: z.array(z.string().uuid()).min(1),
        new_group_name: z.string().min(1).max(120),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const source = await assertGroupCompany(supabase, data.group_id, context.userId);
    if (!source.job_id) throw new Error("group_missing_job");

    // Create a new group under the same job (label + link).
    const { data: newGroup, error: gErr } = await supabase
      .from("groups")
      .insert({ job_id: source.job_id, name: data.new_group_name, status: "pending" })
      .select("id")
      .single();
    if (gErr) throw new Error(gErr.message);

    // Move the selected stops to the new group and re-index both sides.
    for (const stopId of data.stop_ids) {
      const { error } = await supabase
        .from("group_stops")
        .update({ group_id: newGroup.id })
        .eq("id", stopId)
        .eq("group_id", data.group_id);
      if (error) throw new Error(error.message);
    }
    for (const gid of [data.group_id, newGroup.id]) {
      const { data: rows } = await supabase
        .from("group_stops")
        .select("id")
        .eq("group_id", gid)
        .order("stop_index", { ascending: true });
      const ids = (rows ?? []).map((r: any) => r.id);
      for (let i = 0; i < ids.length; i++) {
        await supabase.from("group_stops").update({ stop_index: i }).eq("id", ids[i]);
      }
    }

    await supabase.rpc("record_trip_audit", {
      _job_id: source.job_id,
      _event_type: "stop_split",
      _new: { moved_stop_ids: data.stop_ids, new_group_id: newGroup.id } as any,
      _group_id: data.group_id,
      _approval_status: "approved",
      _actor_label: "coordinator",
    });
    return { ok: true, new_group_id: newGroup.id };
  });

export const mergeGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        target_group_id: z.string().uuid(),
        source_group_ids: z.array(z.string().uuid()).min(1),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const target = await assertGroupCompany(supabase, data.target_group_id, context.userId);

    // Find current max index on the target.
    const { data: existing } = await supabase
      .from("group_stops")
      .select("stop_index")
      .eq("group_id", data.target_group_id)
      .order("stop_index", { ascending: false })
      .limit(1);
    let nextIndex = (existing?.[0]?.stop_index ?? -1) + 1;

    for (const src of data.source_group_ids) {
      const { data: srcStops } = await supabase
        .from("group_stops")
        .select("id")
        .eq("group_id", src)
        .order("stop_index", { ascending: true });
      for (const s of srcStops ?? []) {
        await supabase
          .from("group_stops")
          .update({ group_id: data.target_group_id, stop_index: nextIndex++ })
          .eq("id", s.id);
      }
    }

    if (target.job_id) {
      await supabase.rpc("record_trip_audit", {
        _job_id: target.job_id,
        _event_type: "stop_merged",
        _new: { merged_from: data.source_group_ids } as any,
        _group_id: data.target_group_id,
        _approval_status: "approved",
        _actor_label: "coordinator",
      });
    }
    return { ok: true };
  });

/** Driver request to reorder stops — coordinator approval required. */
export const requestStopReorder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        group_id: z.string().uuid(),
        proposed_order: z.array(z.string().uuid()).min(1),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: driver } = await supabase
      .from("drivers")
      .select("id")
      .eq("linked_user_id", context.userId)
      .maybeSingle();

    const { data: req, error } = await supabase
      .from("group_stop_reorder_requests")
      .insert({
        group_id: data.group_id,
        requested_by_driver_id: driver?.id ?? null,
        proposed_order: data.proposed_order,
        status: "pending",
      })
      .select("id, group_id")
      .single();
    if (error) throw new Error(error.message);

    const { data: group } = await supabase
      .from("groups")
      .select("job_id")
      .eq("id", data.group_id)
      .maybeSingle();
    if (group?.job_id) {
      await supabase.rpc("record_trip_audit", {
        _job_id: group.job_id,
        _event_type: "stop_reorder_requested",
        _new: { request_id: req.id, proposed_order: data.proposed_order } as any,
        _group_id: data.group_id,
        _approval_status: "pending",
        _actor_label: "driver",
        _driver_id: driver?.id ?? null,
      });
    }
    return { ok: true, request_id: req.id };
  });
