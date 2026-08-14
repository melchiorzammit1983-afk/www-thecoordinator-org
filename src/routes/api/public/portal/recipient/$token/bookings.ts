import { createFileRoute } from "@tanstack/react-router";
import { createAuthoritativeJob } from "@/lib/coordinator.functions";
import { resolvePortalRecipientAccess } from "@/lib/portal-definitions.functions";
import { normalizePortalRecipientBooking, portalRecipientBookingInput } from "@/lib/portal-recipient-booking";

export const Route = createFileRoute("/api/public/portal/recipient/$token/bookings")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        let access;
        try {
          access = await resolvePortalRecipientAccess(params.token);
        } catch {
          return Response.json({ error: "portal_unavailable" }, { status: 403 });
        }
        const config = (access.portal.configuration ?? {}) as { capabilities?: { select_operation_group?: boolean } };
        if (config.capabilities?.select_operation_group !== true) return Response.json({ groups: [] });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.from("operation_groups")
          .select("id, reference, name, status")
          .eq("company_id", access.recipient.company_id)
          .in("status", ["draft", "active"])
          .order("name", { ascending: true });
        if (error) return Response.json({ error: "operation_groups_unavailable" }, { status: 500 });
        return Response.json({ groups: data ?? [] });
      },
      POST: async ({ params, request }) => {
        let access;
        try {
          access = await resolvePortalRecipientAccess(params.token);
        } catch {
          return Response.json({ error: "portal_unavailable" }, { status: 403 });
        }
        const config = (access.portal.configuration ?? {}) as {
          capabilities?: { create_booking?: boolean; select_operation_group?: boolean; add_notes?: boolean };
          submission_mode?: "direct" | "approval_required";
        };
        if (config.capabilities?.create_booking !== true) return Response.json({ error: "booking_not_allowed" }, { status: 403 });
        const parsed = portalRecipientBookingInput.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ error: "bad_input", details: parsed.error.flatten() }, { status: 400 });
        let input: ReturnType<typeof normalizePortalRecipientBooking>;
        try {
          input = normalizePortalRecipientBooking(parsed.data);
        } catch {
          return Response.json({ error: "date_time_required" }, { status: 400 });
        }
        if (input.operation_group_id && config.capabilities?.select_operation_group !== true) return Response.json({ error: "operation_group_not_allowed" }, { status: 403 });
        if (input.notes && config.capabilities?.add_notes !== true) return Response.json({ error: "notes_not_allowed" }, { status: 400 });
        const hasFlightFields = !!(input.from_flight || input.to_flight || input.flight_schedule_record_id || input.onward_flight_schedule_record_id);
        const hasShipFields = !!(input.ship_event_id || input.onward_ship_event_id);
        if (hasFlightFields && config.capabilities?.enter_flight_details !== true) return Response.json({ error: "flight_details_not_allowed" }, { status: 403 });
        if (hasShipFields && config.capabilities?.enter_ship_details !== true) return Response.json({ error: "ship_details_not_allowed" }, { status: 403 });
        if (input.passengers?.length && config.capabilities?.add_passengers !== true) return Response.json({ error: "passengers_not_allowed" }, { status: 403 });
        try {
          if (config.submission_mode === "approval_required") {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: submission, error } = await (supabaseAdmin as any).from("portal_submissions").insert({
              portal_id: access.portal.id,
              portal_recipient_id: access.recipient.id,
              company_id: access.recipient.company_id,
              status: "pending",
              payload: input,
            }).select("id, status").single();
            if (error) throw new Error(error.message);
            return Response.json({ id: submission.id, status: submission.status, requires_approval: true }, { status: 202 });
          }
          const job = await createAuthoritativeJob({
            ...input,
            qr_strict_mode: false,
            tracking_enabled: false,
            label_ids: undefined,
            pax: undefined,
          }, {
            company_id: access.recipient.company_id,
            actor_type: "portal",
            actor_user_id: null,
            source: `portal:${access.portal.id}:${access.recipient.id}`,
          });
          return Response.json({ id: job.id, journey: job.journey, requires_approval: false }, { status: 201 });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "booking_failed" }, { status: 400 });
        }
      },
    },
  },
});
