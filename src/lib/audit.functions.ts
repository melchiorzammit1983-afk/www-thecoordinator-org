import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordTripAudit } from "@/lib/trip-audit.server";


/** List audit rows for a trip + chain integrity check. */
export const listTripAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("trip_audit_log")
      .select(
        "id, event_type, approval_status, actor_label, actor_user_id, driver_id, notes, previous_state, new_state, gps_lat, gps_lng, gps_accuracy_m, street_address, speed_kmh, device_time, server_time, prev_hash, row_hash, created_at, group_id, stop_id",
      )
      .eq("job_id", data.job_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // The chain-verification function is a SECURITY DEFINER helper whose
    // EXECUTE privilege was revoked from authenticated users to avoid direct
    // exposure. Call it from the service-role client inside this server function
    // so the user still gets the integrity result without being able to invoke
    // it directly.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: chain } = await supabaseAdmin.rpc("verify_trip_audit_chain", {
      _job_id: data.job_id,
    });
    const okMap = new Map<string, boolean>();
    (chain ?? []).forEach((r: any) => okMap.set(r.row_id, r.ok));
    const chainOk = (chain ?? []).every((r: any) => r.ok);
    return {
      rows: (rows ?? []).map((r) => ({ ...r, chain_ok: okMap.get(r.id) ?? true })),
      chain_ok: chainOk,
    };
  });

/** Suspicious-activity view aggregated for the caller's company. */
export const listSuspiciousActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("v_suspicious_activity")
      .select("company_id, driver_id, signal, count, window")
      .limit(20);
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

/** Coordinator approves/rejects a driver's stop-reorder request. */
export const approveStopReorder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ request_id: z.string().uuid(), approve: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: req, error: reqErr } = await supabase
      .from("group_stop_reorder_requests")
      .select("id, group_id, proposed_order, status")
      .eq("id", data.request_id)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("request_not_found");
    if (req.status !== "pending") throw new Error("request_already_decided");

    const newStatus = data.approve ? "approved" : "rejected";
    const { error: updErr } = await supabase
      .from("group_stop_reorder_requests")
      .update({
        status: newStatus,
        decided_by_user_id: userId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", data.request_id);
    if (updErr) throw new Error(updErr.message);

    if (data.approve) {
      // Rewrite stop_index based on proposed_order.
      const order = req.proposed_order as string[];
      for (let i = 0; i < order.length; i++) {
        await supabase
          .from("group_stops")
          .update({ stop_index: i })
          .eq("id", order[i])
          .eq("group_id", req.group_id);
      }
    }

    // Fetch job_id for audit
    const { data: group } = await supabase
      .from("groups")
      .select("job_id")
      .eq("id", req.group_id)
      .maybeSingle();
    if (group?.job_id) {
      await recordTripAudit({
        job_id: group.job_id,
        event_type: "stop_reorder_decided",
        previous: { status: "pending" },
        new: { status: newStatus, proposed_order: req.proposed_order },
        group_id: req.group_id,
        approval_status: newStatus,
        actor_label: "coordinator",
        actor_user_id: userId,
      });
    }


    return { ok: true, status: newStatus };
  });
