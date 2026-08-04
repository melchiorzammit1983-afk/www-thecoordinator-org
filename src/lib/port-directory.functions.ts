import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PortDirectoryPort = {
  id: string;
  company_id: string;
  name: string;
  code: string | null;
  country: string;
  address: string;
  immigration_available: boolean;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type PortDirectoryBerth = {
  id: string;
  port_id: string;
  name: string;
  address_override: string | null;
  latitude_override: number | null;
  longitude_override: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function portsTable(sb: Awaited<ReturnType<typeof getAdmin>>) {
  // Generated Supabase types are refreshed after Lovable applies the migration.
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
        String((authUser?.user?.user_metadata as { phone?: string | null } | undefined)?.phone ?? "").trim(),
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

const idInput = z.object({ id: z.string().uuid() });
const coordinate = z.number().finite();
const portFields = {
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(32).nullable().optional(),
  country: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(300),
  immigration_available: z.boolean().optional().default(false),
  latitude: coordinate.min(-90).max(90).nullable().optional(),
  longitude: coordinate.min(-180).max(180).nullable().optional(),
};
const berthFields = {
  name: z.string().trim().min(1).max(200),
  address_override: z.string().trim().min(1).max(300).nullable().optional(),
  latitude_override: coordinate.min(-90).max(90).nullable().optional(),
  longitude_override: coordinate.min(-180).max(180).nullable().optional(),
};
const portCreateInput = z.object(portFields);
const portUpdateInput = idInput.extend(portFields).partial({
  name: true,
  code: true,
  country: true,
  address: true,
  latitude: true,
  longitude: true,
  immigration_available: true,
}).refine((value) => Object.keys(value).some((key) => key !== "id"), "At least one field is required");
const berthCreateInput = idInput.extend(berthFields).omit({ id: true });
const berthUpdateInput = idInput.extend(berthFields).partial({
  name: true,
  address_override: true,
  latitude_override: true,
  longitude_override: true,
}).refine((value) => Object.keys(value).some((key) => key !== "id"), "At least one field is required");

function isDuplicate(error: { code?: string | null }) {
  return error.code === "23505";
}

function mutationError(error: { code?: string | null; message: string }, noun: string) {
  if (isDuplicate(error)) throw new Error(`An active ${noun} with this name already exists.`);
  throw new Error(error.message);
}

async function requirePort(sb: any, portId: string, companyId: string): Promise<PortDirectoryPort> {
  const { data, error } = await sb.from("ports").select("*").eq("id", portId).eq("company_id", companyId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Port not found");
  return data as PortDirectoryPort;
}

async function requireBerth(sb: any, berthId: string, companyId: string): Promise<PortDirectoryBerth> {
  const { data, error } = await sb
    .from("berths")
    .select("*")
    .eq("id", berthId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Berth not found");
  await requirePort(sb, data.port_id as string, companyId);
  return data as PortDirectoryBerth;
}

export const listActivePorts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data, error } = await portsTable(sb)
      .from("ports")
      .select("id, name, code, country, address, latitude, longitude, immigration_available, active, created_at, updated_at")
      .eq("company_id", companyId)
      .eq("active", true)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Omit<PortDirectoryPort, "company_id">[];
  });

/** Lists the directory, including inactive records when requested for management. */
export const listPorts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ include_inactive: z.boolean().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    let query = portsTable(sb)
      .from("ports")
      .select("id, name, code, country, address, latitude, longitude, immigration_available, active, created_at, updated_at")
      .eq("company_id", companyId)
      .order("active", { ascending: false })
      .order("name", { ascending: true });
    if (!data.include_inactive) query = query.eq("active", true);
    const { data: ports, error } = await query;
    if (error) throw new Error(error.message);
    return (ports ?? []) as Omit<PortDirectoryPort, "company_id">[];
  });

export const getPortWithActiveBerths = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.extend({ include_inactive: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const port = await requirePort(sb, data.id, companyId);
    let query = portsTable(sb)
      .from("berths")
      .select("id, port_id, name, address_override, latitude_override, longitude_override, active, created_at, updated_at")
      .eq("port_id", port.id)
      .order("active", { ascending: false })
      .order("name", { ascending: true });
    if (!data.include_inactive) query = query.eq("active", true);
    const { data: berths, error } = await query;
    if (error) throw new Error(error.message);
    return { ...port, berths: (berths ?? []) as PortDirectoryBerth[] };
  });

export const createPort = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => portCreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: port, error } = await portsTable(sb)
      .from("ports")
      .insert({ company_id: companyId, ...data })
      .select("id, name, code, country, address, latitude, longitude, immigration_available, active, created_at, updated_at")
      .single();
    if (error) mutationError(error, "port");
    return port as Omit<PortDirectoryPort, "company_id">;
  });

export const updatePort = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => portUpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requirePort(sb, data.id, companyId);
    const { id, ...patch } = data;
    const { data: port, error } = await portsTable(sb)
      .from("ports")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id, name, code, country, address, latitude, longitude, immigration_available, active, created_at, updated_at")
      .single();
    if (error) mutationError(error, "port");
    return port as Omit<PortDirectoryPort, "company_id">;
  });

export const createBerth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => berthCreateInput.extend({ port_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requirePort(sb, data.port_id, companyId);
    const { data: berth, error } = await portsTable(sb)
      .from("berths")
      .insert(data)
      .select("id, port_id, name, address_override, latitude_override, longitude_override, active, created_at, updated_at")
      .single();
    if (error) mutationError(error, "berth");
    return berth as PortDirectoryBerth;
  });

export const updateBerth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => berthUpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireBerth(sb, data.id, companyId);
    const { id, ...patch } = data;
    const { data: berth, error } = await portsTable(sb)
      .from("berths")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, port_id, name, address_override, latitude_override, longitude_override, active, created_at, updated_at")
      .single();
    if (error) mutationError(error, "berth");
    return berth as PortDirectoryBerth;
  });

export const setPortActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.extend({ active: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requirePort(sb, data.id, companyId);
    const { data: port, error } = await portsTable(sb)
      .from("ports")
      .update({ active: data.active, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("id, name, code, country, address, latitude, longitude, immigration_available, active, created_at, updated_at")
      .single();
    if (error) mutationError(error, "port");
    return port as Omit<PortDirectoryPort, "company_id">;
  });

export const setBerthActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.extend({ active: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await requireBerth(sb, data.id, companyId);
    const { data: berth, error } = await portsTable(sb)
      .from("berths")
      .update({ active: data.active, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .select("id, port_id, name, address_override, latitude_override, longitude_override, active, created_at, updated_at")
      .single();
    if (error) mutationError(error, "berth");
    return berth as PortDirectoryBerth;
  });
