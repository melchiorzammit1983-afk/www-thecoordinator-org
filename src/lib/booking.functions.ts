import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
    return row;
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
        time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Time must be HH:MM"),
        promo_note: z.string().trim().max(200).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
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
      from_location: data.from_location,
      to_location: data.to_location,
      time: data.time.length === 5 ? `${data.time}:00` : data.time,
      promo_note: data.promo_note ? data.promo_note.trim() : null,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
