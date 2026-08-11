import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createAuthoritativeJob } from "@/lib/coordinator.functions";
import { resolvePortalRecipientAccess } from "@/lib/portal-definitions.functions";
import { isoToMaltaDateTime } from "@/lib/time";

const bookingInput = z.object({
  from_location: z.string().trim().min(1).max(255),
  to_location: z.string().trim().min(1).max(255),
  from_location_type: z.enum(["airport", "port", "local"]),
  to_location_type: z.enum(["airport", "port", "local"]),
  from_port_id: z.string().uuid().nullable().optional(),
  from_berth_id: z.string().uuid().nullable().optional(),
  to_port_id: z.string().uuid().nullable().optional(),
  to_berth_id: z.string().uuid().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  pickup_at: z.string().datetime().optional(),
  from_flight: z.string().trim().max(40).optional().or(z.literal("")),
  to_flight: z.string().trim().max(40).optional().or(z.literal("")),
  flight_schedule_record_id: z.string().uuid().nullable().optional(),
  ship_event_id: z.string().uuid().nullable().optional(),
  onward_flight_schedule_record_id: z.string().uuid().nullable().optional(),
  onward_ship_event_id: z.string().uuid().nullable().optional(),
  scheduled_transport_pickup_offset_minutes: z.number().int().min(0).max(1440).nullable().optional(),
  immigration_required: z.enum(["yes", "no", "unknown"]).optional(),
  clientcompanyname: z.string().trim().max(200).optional().or(z.literal("")),
  vehicle: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  contact_phone: z.string().trim().max(40).optional().or(z.literal("")),
  passengers: z.array(z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().max(40).optional().nullable(), note: z.string().trim().max(500).optional().nullable() })).max(200).optional(),
  operation_group_id: z.string().uuid().nullable().optional(),
});

export const Route = createFileRoute("/api/public/portal/recipient/$token/bookings")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        let access;
        try {
          access = await resolvePortalRecipientAccess(params.token);
        } catch {
          return Response.json({ error: "portal_unavailable" }, { status: 403 });
        }
        const config = (access.portal.configuration ?? {}) as { capabilities?: { create_booking?: boolean; select_operation_group?: boolean; add_notes?: boolean } };
        if (config.capabilities?.create_booking !== true) return Response.json({ error: "booking_not_allowed" }, { status: 403 });
        const parsed = bookingInput.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ error: "bad_input", details: parsed.error.flatten() }, { status: 400 });
        const input = parsed.data;
        if (input.operation_group_id && config.capabilities?.select_operation_group !== true) return Response.json({ error: "operation_group_not_allowed" }, { status: 403 });
        if (input.notes && config.capabilities?.add_notes !== true) return Response.json({ error: "notes_not_allowed" }, { status: 400 });
        const dateTime = input.pickup_at ? isoToMaltaDateTime(input.pickup_at) : null;
        if (!input.date && !dateTime?.date || !input.time && !dateTime?.time) return Response.json({ error: "date_time_required" }, { status: 400 });
        try {
          const job = await createAuthoritativeJob({
            ...input,
            date: input.date ?? dateTime!.date,
            time: input.time ?? dateTime!.time,
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
          return Response.json({ id: job.id, journey: job.journey }, { status: 201 });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "booking_failed" }, { status: 400 });
        }
      },
    },
  },
});
