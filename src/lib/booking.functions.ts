import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveBookingJourney } from "./journey-resolver";
import { assertTokenPortSelection, listTokenScopedPorts } from "./port-directory-token.server";

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const getCompanyByLink = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().trim().min(8).max(128) }).parse(input),
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: row, error } = await supabaseAdmin
      .from("companies")
      .select("id, name, require_client_company, status, logo_url")
      .eq("custom_link", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.status !== "approved") return null;
    const ports = await listTokenScopedPorts(supabaseAdmin, row.id);
    return { ...row, ports };
  });

export const submitClientBooking = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().trim().min(8).max(128),
        name: z.string().trim().min(1).max(100),
        surname: z.string().trim().min(1).max(100),
        client_email: z.string().trim().email().max(255),
        room_number: z.string().trim().max(40).optional().or(z.literal("")),
        from_location: z.string().trim().min(1).max(255),
        to_location: z.string().trim().min(1).max(255),
        from_location_type: z.enum(["airport", "port", "local"]),
        to_location_type: z.enum(["airport", "port", "local"]),
        from_port_id: z.string().uuid().nullable().optional(),
        from_berth_id: z.string().uuid().nullable().optional(),
        to_port_id: z.string().uuid().nullable().optional(),
        to_berth_id: z.string().uuid().nullable().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
        time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Time must be HH:MM"),
        from_flight: z.string().trim().max(40).optional().or(z.literal("")),
        pax_count: z.number().int().min(1).max(200).optional(),
        notes: z.string().trim().max(2000).optional().or(z.literal("")),
        promo_note: z.string().trim().max(200).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const journey = resolveBookingJourney(data.from_location_type, data.to_location_type);
    const supabaseAdmin = await getAdminClient();
    const { data: company, error: cErr } = await supabaseAdmin
      .from("companies")
      .select("id, status")
      .eq("custom_link", data.token)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!company || company.status !== "approved") {
      throw new Error("This booking link is not active.");
    }
    const fromPort = await assertTokenPortSelection(supabaseAdmin, company.id, data.from_port_id, data.from_berth_id);
    const toPort = await assertTokenPortSelection(supabaseAdmin, company.id, data.to_port_id, data.to_berth_id);
    if ((fromPort && data.from_location_type !== "port") || (toPort && data.to_location_type !== "port")) {
      throw new Error("port_endpoint_type_required");
    }
    const { data: allowed, error: rlErr } = await supabaseAdmin.rpc(
      "register_client_booking_attempt" as any,
      { _company_id: company.id, _limit: 20 } as any,
    );
    if (rlErr) throw new Error(rlErr.message);
    if (allowed === false) {
      throw new Error("Too many booking submissions. Please try again in a minute.");
    }
    const { error } = await supabaseAdmin.from("client_bookings").insert({
      company_id: company.id,
      name: data.name,
      surname: data.surname,
      client_email: data.client_email,
      room_number: data.room_number || null,
      from_location: fromPort?.address ?? data.from_location,
      to_location: toPort?.address ?? data.to_location,
      from_port_id: data.from_port_id ?? null,
      from_berth_id: data.from_berth_id ?? null,
      to_port_id: data.to_port_id ?? null,
      to_berth_id: data.to_berth_id ?? null,
      date: data.date,
      time: data.time.length === 5 ? `${data.time}:00` : data.time,
      from_flight: data.from_flight ? data.from_flight.trim().toUpperCase() : null,
      pax_count: data.pax_count ?? 1,
      notes: data.notes ? data.notes.trim() : null,
      promo_note: data.promo_note ? data.promo_note.trim() : null,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true, journey };
  });
