import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function hashOperationLinkToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type ResolvedOperationLink = {
  id: string;
  company_id: string;
  operation_group_id: string;
  recipient_name: string;
  recipient_type: string;
  permissions: Record<string, boolean>;
  expires_at: string;
};

const externalUpdateInput = z.object({
  token: z.string().min(32).max(256),
  action: z.enum(["update_ship_eta", "update_expected_departure", "request_port_change", "submit_operational_update"]),
  value: z.string().max(5000).optional(),
  port_id: z.string().uuid().optional(),
  berth_id: z.string().uuid().nullable().optional(),
});

/** Resolve one unexpired, unrevoked bearer token to its own operation only. */
export const resolveOperationLinkToken = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(32).max(256) }).parse(input))
  .handler(async ({ data }) => {
    const sb = await getAdminClient();
    const { data: link, error } = await sb
      .from("operation_links")
      .select("id, company_id, operation_group_id, recipient_name, recipient_type, permissions, expires_at")
      .eq("token_hash", hashOperationLinkToken(data.token))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!link) return null;
    await sb.from("operation_links").update({ last_accessed_at: new Date().toISOString() }).eq("id", link.id);
    return link as ResolvedOperationLink;
  });

export const getOperationLinkView = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(32).max(256) }).parse(input))
  .handler(async ({ data }) => {
    const link = await resolveOperationLinkToken({ data });
    if (!link) return null;
    const sb = await getAdminClient();
    const { data: group, error: groupError } = await sb.from("operation_groups")
      .select("id, reference, name, type, status, start_date, end_date")
      .eq("id", link.operation_group_id).eq("company_id", link.company_id).maybeSingle();
    if (groupError) throw new Error(groupError.message);
    if (!group) return null;
    const permissions = link.permissions ?? {};
    const viewTransport = permissions.view_transport === true;
    const viewTripStatus = permissions.view_trip_status === true;
    const [ships, flights, jobs] = await Promise.all([
      viewTransport ? sb.from("operation_group_ship_events").select("ship_events(ship_name, eta, expected_departure, actual_arrival, actual_departure, port, status, berths(name))").eq("operation_group_id", group.id).eq("company_id", link.company_id) : Promise.resolve({ data: [], error: null }),
      viewTransport ? sb.from("operation_group_flight_records").select("flight_schedule_records(flight_number, airline, origin, destination, scheduled_date, scheduled_time, direction)").eq("operation_group_id", group.id).eq("company_id", link.company_id) : Promise.resolve({ data: [], error: null }),
      viewTripStatus ? sb.from("jobs").select("id, status, date, time").eq("operation_group_id", group.id).eq("company_id", link.company_id) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [ships, flights, jobs]) if (result.error) throw new Error(result.error.message);
    return { link, group, ships: ships.data ?? [], flights: flights.data ?? [], jobs: jobs.data ?? [] };
  });

export const submitOperationLinkUpdate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => externalUpdateInput.parse(input))
  .handler(async ({ data }) => {
    const link = await resolveOperationLinkToken({ data: { token: data.token } });
    if (!link) throw new Error("Operation Link unavailable");
    const permissionKey = data.action === "update_ship_eta" ? "update_ship_eta"
      : data.action === "update_expected_departure" ? "update_expected_departure"
      : data.action === "request_port_change" ? "request_port_change"
      : "submit_operational_update";
    if (link.permissions?.[permissionKey] !== true) throw new Error("This Operation Link does not permit that update.");
    const sb = await getAdminClient();
    const { data: relation, error: relationError } = await sb.from("operation_group_ship_events")
      .select("ship_event_id").eq("operation_group_id", link.operation_group_id).eq("company_id", link.company_id).limit(1).maybeSingle();
    if (relationError) throw new Error(relationError.message);
    const shipId = relation?.ship_event_id ?? null;
    if (!shipId && data.action !== "submit_operational_update") throw new Error("No Ship Event is linked to this Operation Group.");
    let previous: Record<string, unknown> = {};
    let next: Record<string, unknown> = {};
    if (shipId && (data.action === "update_ship_eta" || data.action === "update_expected_departure" || data.action === "request_port_change")) {
      const { data: ship, error } = await sb.from("ship_events").select("eta, expected_departure, port_id, berth_id").eq("id", shipId).eq("company_id", link.company_id).single();
      if (error) throw new Error(error.message);
      previous = ship as Record<string, unknown>;
      if (data.action === "update_ship_eta") {
        if (!data.value) throw new Error("ETA is required.");
        const { error: updateError } = await sb.rpc("update_ship_event_eta_with_history", { p_ship_event_id: shipId, p_company_id: link.company_id, p_eta: data.value, p_changed_by: null });
        if (updateError) throw new Error(updateError.message);
        next = { eta: data.value };
        await sb.from("jobs").update({ needs_review: true }).eq("company_id", link.company_id).eq("ship_event_id", shipId);
      } else if (data.action === "update_expected_departure") {
        if (!data.value) throw new Error("Expected departure is required.");
        const { error: updateError } = await sb.from("ship_events").update({ expected_departure: data.value, updated_at: new Date().toISOString() }).eq("id", shipId).eq("company_id", link.company_id);
        if (updateError) throw new Error(updateError.message);
        next = { expected_departure: data.value };
      } else {
        if (!data.port_id) throw new Error("Port is required.");
        const { data: result, error: updateError } = await sb.rpc("update_ship_event_port_with_review", { p_ship_event_id: shipId, p_company_id: link.company_id, p_port_id: data.port_id, p_berth_id: data.berth_id ?? null, p_changed_by: null });
        if (updateError) throw new Error(updateError.message);
        next = { port_id: data.port_id, berth_id: data.berth_id ?? null, review: result ?? null };
      }
    } else if (data.action === "submit_operational_update") {
      if (!data.value?.trim()) throw new Error("Operational update is required.");
      next = { note: data.value.trim() };
    }
    const actionType = data.action === "update_ship_eta" ? "eta_updated" : data.action === "update_expected_departure" ? "departure_updated" : data.action === "request_port_change" ? "port_change_requested" : "operational_update_submitted";
    const { error: auditError } = await sb.from("operation_link_activity").insert({ operation_link_id: link.id, company_id: link.company_id, operation_group_id: link.operation_group_id, action_type: actionType, previous_values: previous, new_values: next });
    if (auditError) throw new Error(auditError.message);
    return { ok: true } as const;
  });

export { hashOperationLinkToken };
