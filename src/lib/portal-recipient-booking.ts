import { z } from "zod";
import { isoToMaltaDateTime } from "@/lib/time";

export const portalRecipientBookingInput = z.object({
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
  passengers: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(40).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  })).max(200).optional(),
  operation_group_id: z.string().uuid().nullable().optional(),
  person_type: z.enum(["crew", "visitor"]).optional(),
  organisation: z.string().trim().max(200).nullable().optional(),
  movement_type: z.enum(["on_signing", "off_signing", "visitor", "other"]).optional(),
  flight_information: z.string().trim().max(300).nullable().optional(),
  hotel_required: z.boolean().optional(),
  transport_required: z.boolean().optional(),
  visit_start_date: z.string().date().nullable().optional(),
  visit_end_date: z.string().date().nullable().optional(),
});

export type PortalRecipientBookingInput = z.infer<typeof portalRecipientBookingInput>;

export function normalizePortalRecipientBooking(input: PortalRecipientBookingInput) {
  const dateTime = input.pickup_at ? isoToMaltaDateTime(input.pickup_at) : null;
  if ((!input.date && !dateTime?.date) || (!input.time && !dateTime?.time)) {
    throw new Error("date_time_required");
  }
  return {
    ...input,
    date: input.date ?? dateTime!.date,
    time: input.time ?? dateTime!.time,
  };
}
