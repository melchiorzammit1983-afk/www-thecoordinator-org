import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const portalType = z.enum(["corporate", "hr", "hotel", "crew_change", "conference", "event", "client", "custom"]);
const portalStatus = z.enum(["draft", "active", "disabled"]);

const portalConfiguration = z.object({
  branding: z.object({
    display_name: z.string().max(160).optional(),
    logo_url: z.string().url().nullable().optional(),
    accent: z.enum(["slate", "blue", "teal", "amber", "rose", "violet"]).optional(),
  }).optional(),
  capabilities: z.object({
    create_booking: z.boolean().optional(),
    view_own_submissions: z.boolean().optional(),
    create_operation_group: z.boolean().optional(),
    select_operation_group: z.boolean().optional(),
    add_passengers: z.boolean().optional(),
    add_stops: z.boolean().optional(),
    enter_flight_details: z.boolean().optional(),
    enter_ship_details: z.boolean().optional(),
    add_notes: z.boolean().optional(),
  }).optional(),
  submission_mode: z.enum(["direct", "approval_required"]).optional(),
}).default({});

async function companyId(userId: string, supabase: any): Promise<string | null> {
  const { data: owned } = await supabase.from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
  if (owned?.id) return owned.id;
  const { data: linked } = await supabase.from("drivers").select("company_id").eq("linked_user_id", userId).maybeSingle();
  return linked?.company_id ?? null;
}

const createInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  portal_type: portalType,
  configuration: portalConfiguration,
});

export const listPortalDefinitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) return [];
    const { data, error } = await context.supabase.from("portals" as any)
      .select("id, company_id, name, description, portal_type, status, configuration, created_by, created_at, updated_at")
      .eq("company_id", cid).order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createPortalDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) throw new Error("No company found.");
    const { data: row, error } = await context.supabase.from("portals" as any)
      .insert({ ...data, company_id: cid, created_by: context.userId })
      .select("id, company_id, name, description, portal_type, status, configuration, created_by, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updatePortalDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    id: z.string().uuid(),
    patch: z.object({
      name: z.string().trim().min(1).max(160).optional(),
      description: z.string().max(2000).nullable().optional(),
      portal_type: portalType.optional(),
      configuration: portalConfiguration.optional(),
    }),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) throw new Error("No company found.");
    const { data: row, error } = await context.supabase.from("portals" as any)
      .update(data.patch as any).eq("id", data.id).eq("company_id", cid)
      .select("id, company_id, name, description, portal_type, status, configuration, created_by, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const setPortalDefinitionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), status: portalStatus }).parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) throw new Error("No company found.");
    const { data: row, error } = await context.supabase.from("portals" as any)
      .update({ status: data.status }).eq("id", data.id).eq("company_id", cid)
      .select("id, company_id, name, description, portal_type, status, configuration, created_by, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const duplicatePortalDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(160).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) throw new Error("No company found.");
    const { data: source, error: sourceError } = await context.supabase.from("portals" as any)
      .select("name, description, portal_type, configuration").eq("id", data.id).eq("company_id", cid).single();
    if (sourceError || !source) throw new Error(sourceError?.message ?? "Portal not found.");
    const { data: row, error } = await context.supabase.from("portals" as any)
      .insert({ ...source, name: data.name ?? `${source.name} Copy`, company_id: cid, created_by: context.userId, status: "draft" })
      .select("id, company_id, name, description, portal_type, status, configuration, created_by, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
