import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };

async function myCompany(ctx: Ctx) {
  const { data, error } = await ctx.supabase
    .from("companies").select("id, name")
    .eq("owner_user_id", ctx.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No company assigned");
  return data as { id: string; name: string };
}

const PERM_KEYS = [
  "view_jobs", "edit_jobs", "create_jobs",
  "view_drivers", "assign_drivers",
  "view_chat", "post_chat",
  "view_pax", "edit_pax",
] as const;
const permsSchema = z.record(z.enum(PERM_KEYS), z.boolean()).default({} as any);

// ---------- INVITES ----------

function randCode(len = 8) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export const createConnectionInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      mode: z.enum(["sync", "provider"]),
      permissions: permsSchema.optional(),
      ttlDays: z.number().int().min(1).max(90).default(7),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const code = randCode(8);
    const expires_at = new Date(Date.now() + data.ttlDays * 86_400_000).toISOString();
    const { data: row, error } = await context.supabase.from("connection_invites").insert({
      code,
      owner_company_id: c.id,
      mode: data.mode,
      permissions: data.mode === "sync" ? (data.permissions ?? {}) : {},
      expires_at,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMyInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await myCompany(context);
    const { data, error } = await context.supabase
      .from("connection_invites").select("*")
      .eq("owner_company_id", c.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const { error } = await context.supabase.from("connection_invites")
      .update({ expires_at: new Date().toISOString() })
      .eq("id", data.id).eq("owner_company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const redeemConnectionInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ code: z.string().trim().min(4).max(32) }).parse(i))
  .handler(async ({ data, context }) => {
    const partner = await myCompany(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invite, error: iErr } = await supabaseAdmin
      .from("connection_invites").select("*")
      .eq("code", data.code.toUpperCase()).maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!invite) throw new Error("Invalid code");
    if (invite.used_at) throw new Error("Code already used");
    if (new Date(invite.expires_at) < new Date()) throw new Error("Code expired");
    if (invite.owner_company_id === partner.id) throw new Error("Cannot connect to yourself");

    // upsert connection
    const { data: existing } = await supabaseAdmin.from("coordinator_connections")
      .select("id").or(
        `and(owner_company_id.eq.${invite.owner_company_id},partner_company_id.eq.${partner.id}),and(owner_company_id.eq.${partner.id},partner_company_id.eq.${invite.owner_company_id})`,
      ).maybeSingle();
    if (existing?.id) {
      await supabaseAdmin.from("coordinator_connections").update({
        status: "active", mode: invite.mode, permissions: invite.permissions, revoked_at: null,
      }).eq("id", existing.id);
    } else {
      const { error: cErr } = await supabaseAdmin.from("coordinator_connections").insert({
        owner_company_id: invite.owner_company_id,
        partner_company_id: partner.id,
        mode: invite.mode,
        permissions: invite.permissions,
        status: "active",
      });
      if (cErr) throw new Error(cErr.message);
    }
    await supabaseAdmin.from("connection_invites")
      .update({ used_at: new Date().toISOString(), used_by_company_id: partner.id })
      .eq("id", invite.id);
    return { ok: true };
  });

// ---------- CONNECTIONS ----------

export const listConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await myCompany(context);
    const { data, error } = await context.supabase
      .from("coordinator_connections")
      .select("id, owner_company_id, partner_company_id, mode, status, permissions, accepted_at, revoked_at, created_at, owner:owner_company_id(id,name), partner:partner_company_id(id,name)")
      .or(`owner_company_id.eq.${c.id},partner_company_id.eq.${c.id}`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      ...row,
      i_am_owner: row.owner_company_id === c.id,
      other: row.owner_company_id === c.id ? row.partner : row.owner,
    }));
  });

export const updateConnectionPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), permissions: permsSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const { error } = await context.supabase.from("coordinator_connections")
      .update({ permissions: data.permissions })
      .eq("id", data.id).eq("owner_company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const { error } = await context.supabase.from("coordinator_connections")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .or(`owner_company_id.eq.${c.id},partner_company_id.eq.${c.id}`);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- DISPATCH ----------

export const dispatchJobToPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      partner_company_id: z.string().uuid(),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    // Verify connection exists in provider or sync mode
    const { data: conn } = await context.supabase
      .from("coordinator_connections").select("id, mode, status")
      .or(`and(owner_company_id.eq.${c.id},partner_company_id.eq.${data.partner_company_id}),and(owner_company_id.eq.${data.partner_company_id},partner_company_id.eq.${c.id})`)
      .eq("status", "active").maybeSingle();
    if (!conn) throw new Error("No active connection with that partner");

    // Charge sender
    const { error: chErr } = await context.supabase.rpc("charge_feature", {
      _company_id: c.id, _feature: "dispatch_partner", _job_id: data.job_id, _note: "Dispatch to partner",
    });
    if (chErr) throw new Error(chErr.message);

    const { error } = await context.supabase.from("jobs").update({
      executor_company_id: data.partner_company_id,
      origin_company_id: c.id,
      dispatch_status: "pending",
      dispatched_at: new Date().toISOString(),
      dispatch_decided_at: null,
      dispatch_note: data.note ?? null,
    }).eq("id", data.job_id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listIncomingDispatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await myCompany(context);
    const { data, error } = await context.supabase
      .from("jobs")
      .select("id, from_location, to_location, date, time, pickup_at, vehicle, clientcompanyname, dispatch_status, dispatch_note, dispatched_at, origin_company_id, origin:origin_company_id(id,name), pax(id,name)")
      .eq("executor_company_id", c.id)
      .eq("dispatch_status", "pending")
      .order("pickup_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const respondToDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      decision: z.enum(["accepted", "rejected"]),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    if (data.decision === "accepted") {
      // Adopt the job into B's company so it appears on the dispatch board.
      const { error } = await context.supabase.from("jobs").update({
        company_id: c.id,
        dispatch_status: "accepted",
        dispatch_decided_at: new Date().toISOString(),
        dispatch_note: data.note ?? null,
      }).eq("id", data.job_id).eq("executor_company_id", c.id);
      if (error) throw new Error(error.message);
    } else {
      // Reject: hand back to origin
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: job } = await supabaseAdmin.from("jobs").select("origin_company_id")
        .eq("id", data.job_id).maybeSingle();
      const { error } = await context.supabase.from("jobs").update({
        executor_company_id: job?.origin_company_id ?? null,
        dispatch_status: "rejected",
        dispatch_decided_at: new Date().toISOString(),
        dispatch_note: data.note ?? null,
      }).eq("id", data.job_id).eq("executor_company_id", c.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// Jobs I dispatched out (read-only view for A)
export const listOutboundDispatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await myCompany(context);
    const { data, error } = await context.supabase
      .from("jobs")
      .select("id, from_location, to_location, date, time, pickup_at, status, dispatch_status, dispatch_note, dispatched_at, executor_company_id, executor:executor_company_id(id,name), driver_id, drivers(name), pax(id,name)")
      .eq("origin_company_id", c.id)
      .neq("executor_company_id", c.id)
      .order("pickup_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
