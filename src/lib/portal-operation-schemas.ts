import { z } from "zod";

export const operationActorSide = z.enum(["coordinator", "client"]);
export const operationServiceType = z.enum([
  "flight",
  "hotel",
  "transfer",
  "driver",
  "meet_greet",
  "visitor",
  "document",
  "other",
]);

const actor = { actor_name: z.string().trim().min(1).max(160) };
const operationId = { operation_group_id: z.string().uuid() };

const serviceFields = {
  service_type: operationServiceType,
  title: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(200).nullable().optional(),
  location_name: z.string().trim().max(200).nullable().optional(),
  location_address: z.string().trim().max(500).nullable().optional(),
  location_place_id: z.string().trim().max(250).nullable().optional(),
  location_lat: z.number().min(-90).max(90).nullable().optional(),
  location_lng: z.number().min(-180).max(180).nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  amount: z.number().min(0).max(10000000).nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("EUR"),
  booking_state: z.enum(["draft", "on_hold"]).default("draft"),
  hold_expires_at: z.string().datetime().nullable().optional(),
};

export const portalOperationActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_operation"),
    ...actor,
    reference: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(200),
    start_date: z.string().date().nullable().optional(),
    end_date: z.string().date().nullable().optional(),
    crew_count: z.number().int().min(0).max(10000).default(0),
    visitor_count: z.number().int().min(0).max(10000).default(0),
    notes: z.string().trim().max(5000).nullable().optional(),
  }),
  z.object({
    action: z.literal("add_member"),
    ...actor,
    ...operationId,
    side: operationActorSide,
    role: z.enum([
      "lead_coordinator",
      "operations_member",
      "coordinator_approver",
      "client_editor",
      "client_approver",
      "client_viewer",
      "driver",
    ]),
    name: z.string().trim().min(1).max(160),
    email: z.string().email().nullable().optional(),
    is_primary_approver: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("save_emergency_policy"),
    ...actor,
    enabled: z.boolean(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    per_booking_limit: z.number().min(0).max(10000000),
    per_operation_limit: z.number().min(0).max(10000000),
    allowed_service_types: z.array(operationServiceType).min(1),
    starts_at: z.string().datetime().nullable().optional(),
    ends_at: z.string().datetime().nullable().optional(),
    supporting_document_required: z.boolean(),
  }),
  z.object({ action: z.literal("approve_emergency_policy"), ...actor }),
  z.object({ action: z.literal("add_service"), ...actor, ...operationId, ...serviceFields }),
  z.object({
    action: z.literal("update_service"),
    ...actor,
    service_id: z.string().uuid(),
    expected_revision: z.number().int().min(1),
    patch: z.object(serviceFields).partial(),
  }),
  z.object({
    action: z.literal("submit_service"),
    ...actor,
    service_id: z.string().uuid(),
    expected_revision: z.number().int().min(1),
  }),
  z.object({
    action: z.literal("approve_service"),
    ...actor,
    service_id: z.string().uuid(),
    expected_revision: z.number().int().min(1),
  }),
  z.object({
    action: z.literal("request_change"),
    ...actor,
    service_id: z.string().uuid(),
    expected_revision: z.number().int().min(1),
    reason: z.string().trim().min(3).max(2000),
  }),
  z.object({
    action: z.literal("confirm_service"),
    ...actor,
    service_id: z.string().uuid(),
    expected_revision: z.number().int().min(1),
    confirmation_reference: z.string().trim().min(1).max(300),
  }),
  z.object({
    action: z.literal("emergency_book"),
    ...actor,
    service_id: z.string().uuid(),
    expected_revision: z.number().int().min(1),
    reason: z.string().trim().min(3).max(2000),
    confirmation_reference: z.string().trim().min(1).max(300),
    supporting_document_reference: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal("acknowledge_emergency"),
    ...actor,
    service_id: z.string().uuid(),
    expected_revision: z.number().int().min(1),
  }),
]);

export type PortalOperationAction = z.infer<typeof portalOperationActionSchema>;
