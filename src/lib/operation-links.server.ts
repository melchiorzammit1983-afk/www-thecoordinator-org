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

export { hashOperationLinkToken };
