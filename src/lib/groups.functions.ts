import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordTripAudit } from "@/lib/trip-audit.server";


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
        _driver_id: driver?.id ?? undefined,
      });
    }
    return { ok: true, request_id: req.id };
  });

/**
 * Coordinator: ensure a group exists for a job, then return its id.
 * Used before adding intermediate stops from the Create/Edit trip dialog
 * when the job doesn't already have one.
 */
async function ensureGroupForJob(supabase: any, jobId: string) {
  const { data: existing } = await supabase
    .from("groups")
    .select("id")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: newGroup, error } = await supabase
    .from("groups")
    .insert({ job_id: jobId, name: "Trip stops", status: "pending" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (newGroup as any).id as string;
}

/**
 * Coordinator: add a stop to a job. Creates the group on demand. The stop
 * is appended (highest stop_index) unless `insert_at` is provided, in
 * which case existing indices shift down.
 */
export const addStopToJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      address: z.string().min(1).max(400),
      lat: z.number().gte(-90).lte(90).nullish(),
      lng: z.number().gte(-180).lte(180).nullish(),
      place_id: z.string().max(200).nullish(),
      insert_at: z.number().int().min(0).nullish(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const groupId = await ensureGroupForJob(supabase, data.job_id);
    // Compute next index (or insert-at with shift).
    const { data: rows } = await supabase
      .from("group_stops")
      .select("id, stop_index")
      .eq("group_id", groupId)
      .order("stop_index", { ascending: true });
    const list = (rows ?? []) as Array<{ id: string; stop_index: number }>;
    const insertAt = typeof data.insert_at === "number" ? Math.min(data.insert_at, list.length) : list.length;
    // Shift later stops down by 1 so we can slot into insertAt.
    for (const r of list) {
      if (r.stop_index >= insertAt) {
        await supabase.from("group_stops").update({ stop_index: r.stop_index + 1 } as any).eq("id", r.id);
      }
    }
    const { data: stop, error } = await supabase
      .from("group_stops")
      .insert({
        group_id: groupId,
        stop_index: insertAt,
        address: data.address,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        place_id: data.place_id ?? null,
      } as any)
      .select("id, stop_index")
      .single();
    if (error) throw new Error(error.message);
    await supabase.rpc("record_trip_audit", {
      _job_id: data.job_id,
      _event_type: "stop_added",
      _new: { stop_id: (stop as any).id, address: data.address, stop_index: insertAt } as any,
      _group_id: groupId,
      _approval_status: "approved",
      _actor_label: "coordinator",
    });
    return { ok: true, group_id: groupId, stop_id: (stop as any).id as string, stop_index: (stop as any).stop_index as number };
  });

/** Coordinator: remove a stop and compact indices. */
export const removeStopFromJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ stop_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: stop } = await supabase
      .from("group_stops")
      .select("id, group_id, stop_index, groups:group_id(job_id)")
      .eq("id", data.stop_id)
      .maybeSingle();
    if (!stop) throw new Error("stop_not_found");
    const groupId = (stop as any).group_id as string;
    const removedIndex = (stop as any).stop_index as number;
    const jobId = (stop as any).groups?.job_id as string | null;
    const { error } = await supabase.from("group_stops").delete().eq("id", data.stop_id);
    if (error) throw new Error(error.message);
    // Compact remaining indices.
    const { data: rest } = await supabase
      .from("group_stops")
      .select("id, stop_index")
      .eq("group_id", groupId)
      .order("stop_index", { ascending: true });
    for (const r of (rest ?? []) as Array<{ id: string; stop_index: number }>) {
      if (r.stop_index > removedIndex) {
        await supabase.from("group_stops").update({ stop_index: r.stop_index - 1 } as any).eq("id", r.id);
      }
    }
    if (jobId) {
      await supabase.rpc("record_trip_audit", {
        _job_id: jobId,
        _event_type: "stop_removed",
        _new: { stop_id: data.stop_id, removed_index: removedIndex } as any,
        _group_id: groupId,
        _approval_status: "approved",
        _actor_label: "coordinator",
      });
    }
    return { ok: true };
  });

/** Coordinator: convenience — list stops for a job (creates no group). */
export const listStopsForJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: group } = await supabase
      .from("groups")
      .select("id")
      .eq("job_id", data.job_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!group?.id) return { group_id: null as string | null, stops: [] as Array<{ id: string; stop_index: number; address: string; lat: number | null; lng: number | null }> };
    const { data: stops } = await supabase
      .from("group_stops")
      .select("id, stop_index, address, lat, lng")
      .eq("group_id", group.id)
      .order("stop_index", { ascending: true });
    return { group_id: group.id as string, stops: (stops ?? []) as any };
  });

