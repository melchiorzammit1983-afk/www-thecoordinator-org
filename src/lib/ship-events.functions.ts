import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { maltaWallTimeToUtcIso } from "@/lib/time";

export type ShipEvent = {
  id: string;
  ship_name: string;
  eta: string;
  port: string;
  port_id?: string | null;
  berth_id?: string | null;
  ports?: { name: string; address: string } | null;
  berths?: { name: string } | null;
  status: "scheduled" | "arrived" | "departed" | "archived" | "cancelled";
  expected_departure: string | null;
  actual_arrival: string | null;
  actual_departure: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  archived_by?: string | null;
};

const shipEventSelect = "id, ship_name, eta, port, port_id, berth_id, status, expected_departure, actual_arrival, actual_departure, created_at, updated_at, archived_at, archived_by, ports(name, address), berths(name)";

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function shipEventsTable(sb: Awaited<ReturnType<typeof getAdmin>>) {
  // Generated Supabase types are refreshed after Lovable applies this migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sb as any;
}

async function getMyCompanyId(userId: string): Promise<string> {
  const sb = await getAdmin();
  const { data: byOwner, error: ownerError } = await sb
    .from("companies")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (ownerError) throw new Error(ownerError.message);
  if (byOwner) return byOwner.id as string;

  const { data: authUser, error: authError } = await sb.auth.admin.getUserById(userId);
  if (authError) throw new Error(authError.message);
  const phones = Array.from(
    new Set(
      [
        authUser?.user?.phone?.trim() ?? "",
        String(
          (authUser?.user?.user_metadata as { phone?: string | null } | undefined)?.phone ?? "",
        ).trim(),
      ].filter(Boolean),
    ),
  );
  for (const phone of phones) {
    const { data, error } = await sb
      .from("companies")
      .select("id")
      .eq("coordinator_phone", phone)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data.id as string;
  }
  throw new Error("No company assigned to this user");
}

// Server-function serialization can append seconds, milliseconds, or an ISO
// offset to the native datetime-local value. Normalize that transport shape
// once to the minute-precise Malta wall-clock representation used internally.
const localEtaTransport =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?$/;
const localEtaCanonical = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function normalizeLocalEta(value: unknown) {
  if (typeof value !== "string") return value;
  return value.match(localEtaTransport)?.[1] ?? value;
}

const localEta = z.preprocess(
  normalizeLocalEta,
  z.string().regex(localEtaCanonical, "Enter a valid ETA"),
);
const optionalLocalEta = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? null : normalizeLocalEta(value),
  z.string().regex(localEtaCanonical, "Enter a valid date and time").nullable(),
);
const shipEventInput = z.object({
  ship_name: z.string().trim().min(1, "Enter a ship name").max(200),
  eta: localEta,
  expected_departure: localEta,
  port: z.string().trim().min(1, "Enter a port").max(160),
  port_id: z.string().uuid().nullable().optional(),
  berth_id: z.string().uuid().nullable().optional(),
});

function etaToIso(eta: string) {
  const [date, time] = eta.split("T");
  return maltaWallTimeToUtcIso(date, time);
}

function optionalEtaToIso(eta: string | null | undefined) {
  return eta ? etaToIso(eta) : null;
}

/** Company-private manual ship events. No trip link or shared data is involved. */
export const listShipEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data, error } = await shipEventsTable(sb)
      .from("ship_events")
      .select(shipEventSelect)
      .eq("company_id", companyId)
      .order("eta", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ShipEvent[];
  });

/** Company-private choices for linking a job to a manually managed ship event. */
export const searchShipEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ search: z.string().trim().max(100).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    let query = shipEventsTable(sb)
      .from("ship_events")
      .select(shipEventSelect)
      .eq("company_id", companyId)
      .is("archived_at", null)
      .order("eta", { ascending: true })
      .limit(20);
    const term = data.search?.replace(/[^a-zA-Z0-9 .'-]/g, " ").trim();
    if (term) query = query.or(`ship_name.ilike.%${term}%,port.ilike.%${term}%`);
    const { data: events, error } = await query;
    if (error) throw new Error(error.message);
    return (events ?? []) as ShipEvent[];
  });

/** Reads an existing job link without requiring the ship to still be searchable. */
export const getLinkedShipEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: event, error } = await shipEventsTable(sb)
      .from("ship_events")
      .select(shipEventSelect)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!event) throw new Error("The linked ship event no longer exists.");
    return event as ShipEvent;
  });

export const createShipEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shipEventInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    let portName = data.port;
    if (data.berth_id && !data.port_id) throw new Error("A berth must belong to a selected port.");
    if (data.port_id) {
      const { data: selectedPort, error: portError } = await shipEventsTable(sb)
        .from("ports")
        .select("id, name")
        .eq("id", data.port_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (portError) throw new Error(portError.message);
      if (!selectedPort) throw new Error("Port not found for this company.");
      portName = selectedPort.name as string;
      if (data.berth_id) {
        const { data: selectedBerth, error: berthError } = await shipEventsTable(sb)
          .from("berths")
          .select("id")
          .eq("id", data.berth_id)
          .eq("port_id", data.port_id)
          .maybeSingle();
        if (berthError) throw new Error(berthError.message);
        if (!selectedBerth) throw new Error("Berth not found for the selected port.");
      }
    }
    const { data: event, error } = await shipEventsTable(sb)
      .from("ship_events")
      .insert({
        company_id: companyId,
        ship_name: data.ship_name,
        eta: etaToIso(data.eta),
        expected_departure: etaToIso(data.expected_departure),
        port: portName,
        port_id: data.port_id ?? null,
        berth_id: data.berth_id ?? null,
        status: "scheduled",
        created_by: context.userId,
      })
      .select(shipEventSelect)
      .single();
    if (error) throw new Error(error.message);
    return event as ShipEvent;
  });

export const updateShipEventEta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), eta: localEta }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: result, error } = await shipEventsTable(sb).rpc(
      "update_ship_event_eta_with_history",
      {
        p_ship_event_id: data.id,
        p_company_id: companyId,
        p_eta: etaToIso(data.eta),
        p_changed_by: context.userId,
      },
    );
    if (error) throw new Error(error.message);
    const event = Array.isArray(result) ? result[0] : result;
    if (!event) throw new Error("Ship event not found");
    return event as ShipEvent;
  });

export const updateShipEventLifecycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid(),
    expected_departure: optionalLocalEta.optional(),
    actual_arrival: optionalLocalEta.optional(),
    actual_departure: optionalLocalEta.optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const status = data.actual_departure ? "departed" : data.actual_arrival ? "arrived" : "scheduled";
    const { data: event, error } = await shipEventsTable(sb)
      .from("ship_events")
      .update({
        expected_departure: optionalEtaToIso(data.expected_departure),
        actual_arrival: optionalEtaToIso(data.actual_arrival),
        actual_departure: optionalEtaToIso(data.actual_departure),
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .is("archived_at", null)
      .neq("status", "cancelled")
      .select(shipEventSelect)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!event) throw new Error("Ship event not found or unavailable.");
    return event as ShipEvent;
  });

export const cancelShipEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: event, error } = await shipEventsTable(sb)
      .from("ship_events")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .is("archived_at", null)
      .select(shipEventSelect)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!event) throw new Error("Ship event not found or already archived.");
    return event as ShipEvent;
  });

export const archiveShipEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: event, error } = await shipEventsTable(sb)
      .from("ship_events")
      .update({ archived_at: new Date().toISOString(), archived_by: context.userId, status: "archived", updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .is("archived_at", null)
      .select(shipEventSelect)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!event) throw new Error("Ship event not found or already archived.");
    return event as ShipEvent;
  });

export const unarchiveShipEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: event, error } = await shipEventsTable(sb)
      .from("ship_events")
      .update({ archived_at: null, archived_by: null, status: "scheduled", updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .not("archived_at", "is", null)
      .select(shipEventSelect)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!event) throw new Error("Archived ship event not found.");
    return event as ShipEvent;
  });
