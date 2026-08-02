import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { maltaWallTimeToUtcIso } from "@/lib/time";

export type ShipEvent = {
  id: string;
  ship_name: string;
  eta: string;
  port: string;
  status: "scheduled";
  created_at: string;
  updated_at: string;
};

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

// datetime-local controls may include seconds, milliseconds, or an ISO offset
// after server-function serialization. The operational model is minute-precise,
// so retain the wall-clock minute selected in the form before converting Malta
// wall time to UTC.
const localEta = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
    "Enter a valid ETA",
  )
  .transform((value) => value.slice(0, 16));
const shipEventInput = z.object({
  ship_name: z.string().trim().min(1, "Enter a ship name").max(200),
  eta: localEta,
  port: z.string().trim().min(1, "Enter a port").max(160),
});

function etaToIso(eta: string) {
  const [date, time] = eta.split("T");
  return maltaWallTimeToUtcIso(date, time);
}

/** Company-private manual ship events. No trip link or shared data is involved. */
export const listShipEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data, error } = await shipEventsTable(sb)
      .from("ship_events")
      .select("id, ship_name, eta, port, status, created_at, updated_at")
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
      .select("id, ship_name, eta, port, status, created_at, updated_at")
      .eq("company_id", companyId)
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
      .select("id, ship_name, eta, port, status, created_at, updated_at")
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
    const { data: event, error } = await shipEventsTable(sb)
      .from("ship_events")
      .insert({
        company_id: companyId,
        ship_name: data.ship_name,
        eta: etaToIso(data.eta),
        port: data.port,
        status: "scheduled",
        created_by: context.userId,
      })
      .select("id, ship_name, eta, port, status, created_at, updated_at")
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
