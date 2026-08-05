import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const operationGroupTypes = [
  "crew_change",
  "conference",
  "event",
  "charter",
  "hotel_operation",
  "airport_operation",
  "vip_movement",
  "other",
] as const;

export const operationGroupStatuses = ["draft", "active", "completed", "cancelled"] as const;

export type OperationGroup = {
  id: string;
  company_id: string;
  reference: string;
  name: string;
  type: (typeof operationGroupTypes)[number];
  status: (typeof operationGroupStatuses)[number];
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function groupsTable(sb: Awaited<ReturnType<typeof getAdmin>>) {
  // Generated Supabase types are refreshed after the migration is applied.
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
  const phones = Array.from(new Set([
    authUser?.user?.phone?.trim() ?? "",
    String((authUser?.user?.user_metadata as { phone?: string | null } | undefined)?.phone ?? "").trim(),
  ].filter(Boolean)));
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

const idInput = z.object({ id: z.string().uuid() });
const groupType = z.enum(operationGroupTypes);
const groupStatus = z.enum(operationGroupStatuses);
const groupFields = {
  reference: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  type: groupType,
  status: groupStatus,
  start_date: z.string().date().nullable().optional(),
  end_date: z.string().date().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
};
const createInput = z.object(groupFields).superRefine((value, ctx) => {
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date must be on or after start date" });
  }
});
const updateInput = idInput.extend(groupFields).partial({
  reference: true,
  name: true,
  type: true,
  status: true,
  start_date: true,
  end_date: true,
  notes: true,
}).superRefine((value, ctx) => {
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date must be on or after start date" });
  }
  if (Object.keys(value).length === 1) {
    ctx.addIssue({ code: "custom", message: "At least one field is required" });
  }
});
const relationInput = z.object({ operation_group_id: z.string().uuid() });
const shipRelationInput = relationInput.extend({ ship_event_id: z.string().uuid() });
const flightRelationInput = relationInput.extend({ flight_schedule_record_id: z.string().uuid() });
const jobRelationInput = relationInput.extend({ job_id: z.string().uuid() });

function mutationError(error: { code?: string | null; message: string }, noun: string) {
  if (error.code === "23505") throw new Error(`This ${noun} is already linked or the reference is already in use.`);
  throw new Error(error.message);
}

async function requireGroup(sb: any, id: string, companyId: string): Promise<OperationGroup> {
  const { data, error } = await sb
    .from("operation_groups")
    .select("id, company_id, reference, name, type, status, start_date, end_date, notes, created_by, created_at, updated_at")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Operation Group not found");
  return data as OperationGroup;
}

async function requireShipEvent(sb: any, id: string, companyId: string) {
  const { data, error } = await sb.from("ship_events").select("id, ship_name, eta, port, berth_id").eq("id", id).eq("company_id", companyId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Ship Event not found");
  return data;
}

async function requireFlightRecord(sb: any, id: string) {
  const { data, error } = await sb
    .from("flight_schedule_records")
    .select("id, flight_number, airline, origin, destination, scheduled_date, scheduled_time, direction")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Flight Schedule Record not found");
  return data;
}

async function requireJob(sb: any, id: string, companyId: string) {
  const { data, error } = await sb.from("jobs").select("id, operation_group_id").eq("id", id).eq("company_id", companyId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Job not found");
  return data;
}

export const listOperationGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data, error } = await groupsTable(sb)
      .from("operation_groups")
      .select("id, company_id, reference, name, type, status, start_date, end_date, notes, created_by, created_at, updated_at")
      .eq("company_id", companyId)
      .order("start_date", { ascending: true, nullsFirst: false })
      .order("reference", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as OperationGroup[];
  });

export const getOperationGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const group = await requireGroup(sb, data.id, companyId);
    const [ships, flights, jobs] = await Promise.all([
      groupsTable(sb).from("operation_group_ship_events").select("ship_event_id, ship_events(id, ship_name, eta, port, berth_id)").eq("operation_group_id", group.id).eq("company_id", companyId),
      groupsTable(sb).from("operation_group_flight_records").select("flight_schedule_record_id, flight_schedule_records(id, flight_number, airline, origin, destination, scheduled_date, scheduled_time, direction)").eq("operation_group_id", group.id).eq("company_id", companyId),
      groupsTable(sb).from("jobs").select("id, date, time, from_location, to_location, status, operation_group_id").eq("operation_group_id", group.id).eq("company_id", companyId),
    ]);
    for (const result of [ships, flights, jobs]) if (result.error) throw new Error(result.error.message);
    return { ...group, ship_events: ships.data ?? [], flight_records: flights.data ?? [], jobs: jobs.data ?? [] };
  });

export const createOperationGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: group, error } = await groupsTable(sb)
      .from("operation_groups")
      .insert({ ...data, company_id: companyId, created_by: context.userId })
      .select("id, company_id, reference, name, type, status, start_date, end_date, notes, created_by, created_at, updated_at")
      .single();
    if (error) mutationError(error, "Operation Group");
    return group as OperationGroup;
  });

export const updateOperationGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireGroup(sb, data.id, companyId);
    const { id, ...patch } = data;
    const { data: group, error } = await groupsTable(sb)
      .from("operation_groups")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id, company_id, reference, name, type, status, start_date, end_date, notes, created_by, created_at, updated_at")
      .single();
    if (error) mutationError(error, "Operation Group");
    return group as OperationGroup;
  });

export const changeOperationGroupStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.extend({ status: groupStatus }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireGroup(sb, data.id, companyId);
    const { data: group, error } = await groupsTable(sb)
      .from("operation_groups")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("id, company_id, reference, name, type, status, start_date, end_date, notes, created_by, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return group as OperationGroup;
  });

export const linkShipEventToOperationGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shipRelationInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireGroup(sb, data.operation_group_id, companyId);
    await requireShipEvent(sb, data.ship_event_id, companyId);
    const { data: link, error } = await groupsTable(sb).from("operation_group_ship_events").insert({ ...data, company_id: companyId }).select("id, operation_group_id, company_id, ship_event_id, created_at").single();
    if (error) mutationError(error, "Ship Event link");
    return link;
  });

export const unlinkShipEventFromOperationGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shipRelationInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireGroup(sb, data.operation_group_id, companyId);
    const { error } = await groupsTable(sb).from("operation_group_ship_events").delete().eq("operation_group_id", data.operation_group_id).eq("ship_event_id", data.ship_event_id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });

export const linkFlightRecordToOperationGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => flightRelationInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireGroup(sb, data.operation_group_id, companyId);
    await requireFlightRecord(sb, data.flight_schedule_record_id);
    const { data: link, error } = await groupsTable(sb).from("operation_group_flight_records").insert({ ...data, company_id: companyId }).select("id, operation_group_id, company_id, flight_schedule_record_id, created_at").single();
    if (error) mutationError(error, "Flight Schedule link");
    return link;
  });

export const unlinkFlightRecordFromOperationGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => flightRelationInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireGroup(sb, data.operation_group_id, companyId);
    const { error } = await groupsTable(sb).from("operation_group_flight_records").delete().eq("operation_group_id", data.operation_group_id).eq("flight_schedule_record_id", data.flight_schedule_record_id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });

export const assignJobToOperationGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => jobRelationInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireGroup(sb, data.operation_group_id, companyId);
    await requireJob(sb, data.job_id, companyId);
    const { data: job, error } = await groupsTable(sb).from("jobs").update({ operation_group_id: data.operation_group_id }).eq("id", data.job_id).eq("company_id", companyId).select("id, operation_group_id").single();
    if (error) throw new Error(error.message);
    return job;
  });

export const removeJobFromOperationGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.extend({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireGroup(sb, data.id, companyId);
    const { error } = await groupsTable(sb).from("jobs").update({ operation_group_id: null }).eq("id", data.job_id).eq("company_id", companyId).eq("operation_group_id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });
