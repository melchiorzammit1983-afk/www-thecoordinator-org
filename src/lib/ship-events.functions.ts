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

type ShipEventListFilter = "active" | "arrived" | "departed" | "archived" | "all";

/** Archives only departed events whose current linked work and reviews are closed. */
async function autoArchiveCompletedShipEvents(sb: Awaited<ReturnType<typeof getAdmin>>, companyId: string, archivedBy: string) {
  const tables = shipEventsTable(sb);
  const jobScope = `company_id.eq.${companyId},executor_company_id.eq.${companyId},origin_company_id.eq.${companyId},dispatch_chain_company_ids.cs.{${companyId}}`;
  const [eventsResult, jobsResult, portReviewsResult, etaHistoryResult, etaCompletionsResult, readinessResult] = await Promise.all([
    tables.from("ship_events").select("id, actual_departure, status, archived_at").eq("company_id", companyId).is("archived_at", null).limit(10_000),
    tables.from("jobs").select("id, ship_event_id, status, needs_review").or(jobScope).not("ship_event_id", "is", null).limit(10_000),
    tables.from("ship_event_port_change_reviews").select("ship_event_id").eq("company_id", companyId).limit(10_000),
    tables.from("ship_event_eta_history").select("id, ship_event_id, changed_at, ship_events!inner(company_id)").eq("ship_events.company_id", companyId).order("changed_at", { ascending: false }).limit(10_000),
    tables.from("ship_eta_review_completions").select("eta_history_id").eq("company_id", companyId).limit(10_000),
    tables.from("ship_departure_readiness_warnings").select("ship_event_id").eq("company_id", companyId).eq("active", true).limit(10_000),
  ]);
  for (const result of [eventsResult, jobsResult, portReviewsResult, etaHistoryResult, etaCompletionsResult, readinessResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const openJobsByShip = new Map<string, number>();
  const linkedJobsByShip = new Map<string, number>();
  const pendingReviewByShip = new Map<string, number>();
  for (const job of (jobsResult.data ?? []) as Array<{ ship_event_id: string | null; status: string | null; needs_review: boolean | null }>) {
    if (job.ship_event_id) linkedJobsByShip.set(job.ship_event_id, (linkedJobsByShip.get(job.ship_event_id) ?? 0) + 1);
    if (job.ship_event_id && job.needs_review === true) pendingReviewByShip.set(job.ship_event_id, (pendingReviewByShip.get(job.ship_event_id) ?? 0) + 1);
    if (!job.ship_event_id || !["completed", "cancelled", "no_show"].includes((job.status ?? "").toLowerCase())) {
      if (job.ship_event_id) openJobsByShip.set(job.ship_event_id, (openJobsByShip.get(job.ship_event_id) ?? 0) + 1);
    }
  }
  const portReviewShipIds = new Set(((portReviewsResult.data ?? []) as Array<{ ship_event_id: string }>).map((row) => row.ship_event_id));
  const completedEtaHistoryIds = new Set(((etaCompletionsResult.data ?? []) as Array<{ eta_history_id: string }>).map((row) => row.eta_history_id));
  const latestEtaHistoryByShip = new Map<string, string>();
  for (const row of (etaHistoryResult.data ?? []) as Array<{ id: string; ship_event_id: string }>) {
    if (!latestEtaHistoryByShip.has(row.ship_event_id)) latestEtaHistoryByShip.set(row.ship_event_id, row.id);
  }
  const readinessShipIds = new Set(((readinessResult.data ?? []) as Array<{ ship_event_id: string }>).map((row) => row.ship_event_id));
  for (const event of (eventsResult.data ?? []) as Array<{ id: string; actual_departure: string | null; status: string | null; archived_at: string | null }>) {
    if (!event.actual_departure || event.archived_at || event.status === "cancelled") continue;
    if ((openJobsByShip.get(event.id) ?? 0) > 0) continue;
    if ((portReviewShipIds.has(event.id) && (pendingReviewByShip.get(event.id) ?? 0) > 0) || readinessShipIds.has(event.id)) continue;
    const latestEtaHistoryId = latestEtaHistoryByShip.get(event.id);
    if (latestEtaHistoryId && (linkedJobsByShip.get(event.id) ?? 0) > 0 && !completedEtaHistoryIds.has(latestEtaHistoryId)) continue;
    const { error } = await tables
      .from("ship_events")
      .update({ archived_at: new Date().toISOString(), archived_by: archivedBy, status: "archived", updated_at: new Date().toISOString() })
      .eq("id", event.id)
      .eq("company_id", companyId)
      .is("archived_at", null)
      .eq("actual_departure", event.actual_departure);
    if (error) throw new Error(error.message);
  }
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
  .inputValidator((input: unknown) => z.object({ filter: z.enum(["active", "arrived", "departed", "archived", "all"]).default("active") }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await autoArchiveCompletedShipEvents(sb, companyId, context.userId);
    const filter = data.filter as ShipEventListFilter;
    const query = shipEventsTable(sb)
      .from("ship_events")
      .select(shipEventSelect)
      .eq("company_id", companyId)
      .order("eta", { ascending: true });
    if (filter === "active") query.in("status", ["scheduled", "arrived", "departed"]).is("archived_at", null);
    if (filter === "arrived") query.eq("status", "arrived").is("archived_at", null);
    if (filter === "departed") query.eq("status", "departed").is("archived_at", null);
    if (filter === "archived") query.eq("status", "archived");
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return (result.data ?? []) as ShipEvent[];
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

export const updateShipEventPort = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid(),
    port_id: z.string().uuid(),
    berth_id: z.string().uuid().nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: result, error } = await shipEventsTable(sb).rpc("update_ship_event_port_with_review", {
      p_ship_event_id: data.id,
      p_company_id: companyId,
      p_port_id: data.port_id,
      p_berth_id: data.berth_id ?? null,
      p_changed_by: context.userId,
    });
    if (error) throw new Error(error.message);
    const changed = Boolean((result as { changed?: boolean } | null)?.changed);
    const { data: event, error: eventError } = await shipEventsTable(sb)
      .from("ship_events")
      .select(shipEventSelect)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .single();
    if (eventError) throw new Error(eventError.message);
    return { changed, event: event as ShipEvent };
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
