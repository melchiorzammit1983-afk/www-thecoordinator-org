import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}


async function myCompany(ctx: Ctx) {
  const supabaseAdmin = await getAdminClient();
  const { data, error } = await supabaseAdmin
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
    const supabaseAdmin = await getAdminClient();
    const code = randCode(8);
    const expires_at = new Date(Date.now() + data.ttlDays * 86_400_000).toISOString();
    const { data: row, error } = await supabaseAdmin.from("connection_invites").insert({
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
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
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
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("connection_invites")
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
    const supabaseAdmin = await getAdminClient();
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
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
      .from("coordinator_connections")
      .select("id, owner_company_id, partner_company_id, mode, status, permissions, accepted_at, revoked_at, created_at")
      .or(`owner_company_id.eq.${c.id},partner_company_id.eq.${c.id}`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const ids = Array.from(new Set(rows.flatMap((r: any) => [r.owner_company_id, r.partner_company_id])));
    const { data: comps } = await supabaseAdmin.from("companies").select("id, name").in("id", ids);
    const nameById = new Map((comps ?? []).map((x: any) => [x.id, x.name]));
    return rows.map((row: any) => ({
      ...row,
      owner: { id: row.owner_company_id, name: nameById.get(row.owner_company_id) ?? "Unknown" },
      partner: { id: row.partner_company_id, name: nameById.get(row.partner_company_id) ?? "Unknown" },
      i_am_owner: row.owner_company_id === c.id,
      other: {
        id: row.owner_company_id === c.id ? row.partner_company_id : row.owner_company_id,
        name: nameById.get(row.owner_company_id === c.id ? row.partner_company_id : row.owner_company_id) ?? "Unknown",
      },
    }));
  });


export const updateConnectionPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), permissions: permsSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("coordinator_connections")
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
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("coordinator_connections")
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
    const supabaseAdmin = await getAdminClient();
    const { data: conn } = await supabaseAdmin
      .from("coordinator_connections").select("id, mode, status")
      .or(`and(owner_company_id.eq.${c.id},partner_company_id.eq.${data.partner_company_id}),and(owner_company_id.eq.${data.partner_company_id},partner_company_id.eq.${c.id})`)
      .eq("status", "active").maybeSingle();
    if (!conn) throw new Error("No active connection with that partner");

    const { data: job, error: jobError } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids")
      .eq("id", data.job_id)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Trip not found");
    if ((job.executor_company_id ?? job.company_id) !== c.id) throw new Error("Only the current executor can dispatch this trip");
    if (data.partner_company_id === c.id) throw new Error("Cannot dispatch to yourself");
    const chain: string[] = Array.isArray(job.dispatch_chain_company_ids) ? job.dispatch_chain_company_ids : [job.company_id];
    if (chain.includes(data.partner_company_id)) throw new Error("This dispatch would create a loop");


    const { data: hops, error: hopReadError } = await supabaseAdmin
      .from("job_dispatch_hops")
      .select("hop_index")
      .eq("job_id", data.job_id)
      .order("hop_index", { ascending: false })
      .limit(1);
    if (hopReadError) throw new Error(hopReadError.message);
    const nextIndex = Number(hops?.[0]?.hop_index ?? -1) + 1;
    const { error: hopError } = await supabaseAdmin.from("job_dispatch_hops").insert({
      job_id: data.job_id,
      hop_index: nextIndex,
      from_company_id: c.id,
      to_company_id: data.partner_company_id,
      status: "pending",
      note: data.note ?? "",
    });
    if (hopError) throw new Error(hopError.message);
    const { error: updateError } = await supabaseAdmin.from("jobs").update({
      origin_company_id: job.origin_company_id ?? job.company_id,
      executor_company_id: data.partner_company_id,
      dispatch_status: "pending",
      dispatched_at: new Date().toISOString(),
      dispatch_decided_at: null,
      dispatch_note: data.note ?? "",
      dispatch_chain_company_ids: [...chain, data.partner_company_id],
    }).eq("id", data.job_id);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  });

export const recallPartnerDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: jobError } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, executor_company_id, dispatch_chain_company_ids, dispatch_status")
      .eq("id", data.job_id)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Trip not found");
    if (job.company_id !== c.id) throw new Error("Only the trip creator can recall a hand-off");

    const { data: hops, error: hopReadError } = await supabaseAdmin
      .from("job_dispatch_hops")
      .select("id, hop_index, from_company_id, to_company_id, status")
      .eq("job_id", data.job_id)
      .order("hop_index", { ascending: false })
      .limit(1);
    if (hopReadError) throw new Error(hopReadError.message);
    const latest = hops?.[0];
    if (!latest) throw new Error("No hand-off to recall");
    if (latest.status !== "pending") throw new Error("Only pending hand-offs can be recalled");

    const { error: delError } = await supabaseAdmin
      .from("job_dispatch_hops").delete().eq("id", latest.id);
    if (delError) throw new Error(delError.message);

    const chain: string[] = Array.isArray(job.dispatch_chain_company_ids) ? job.dispatch_chain_company_ids : [job.company_id];
    const nextChain = chain.filter((id) => id !== latest.to_company_id);
    const { error: updateError } = await supabaseAdmin.from("jobs").update({
      executor_company_id: latest.from_company_id,
      dispatch_status: nextChain.length > 1 ? "accepted" : null,
      dispatch_decided_at: new Date().toISOString(),
      dispatch_chain_company_ids: nextChain.length ? nextChain : [job.company_id],
    }).eq("id", data.job_id);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  });


export const listIncomingDispatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await myCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
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
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: jobError } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, executor_company_id, dispatch_chain_company_ids")
      .eq("id", data.job_id)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Trip not found");
    if (job.executor_company_id !== c.id) throw new Error("This dispatch is not waiting for your company");
    const { data: hops, error: hopReadError } = await supabaseAdmin
      .from("job_dispatch_hops")
      .select("id, from_company_id")
      .eq("job_id", data.job_id)
      .eq("to_company_id", c.id)
      .eq("status", "pending")
      .order("hop_index", { ascending: false })
      .limit(1);
    if (hopReadError) throw new Error(hopReadError.message);
    const hop = hops?.[0];
    if (!hop) throw new Error("No pending dispatch found");
    const decidedAt = new Date().toISOString();
    const { error: hopError } = await supabaseAdmin.from("job_dispatch_hops").update({
      status: data.decision,
      decided_at: decidedAt,
      note: data.note ?? null,
    }).eq("id", hop.id);
    if (hopError) throw new Error(hopError.message);
    if (data.decision === "accepted") {
      // Keep company_id = creator so the trip stays owned by A across the chain.
      // executor_company_id already points to the accepting partner.
      const { error: updateError } = await supabaseAdmin.from("jobs").update({
        dispatch_status: "accepted",
        dispatch_decided_at: decidedAt,
        dispatch_note: data.note ?? null,
      }).eq("id", data.job_id);
      if (updateError) throw new Error(updateError.message);
    } else {
      const chain: string[] = Array.isArray(job.dispatch_chain_company_ids) ? job.dispatch_chain_company_ids : [];
      const { error: updateError } = await supabaseAdmin.from("jobs").update({
        executor_company_id: hop.from_company_id,
        dispatch_status: "rejected",
        dispatch_decided_at: decidedAt,
        dispatch_note: data.note ?? null,
        dispatch_chain_company_ids: chain.filter((id) => id !== c.id),
      }).eq("id", data.job_id);
      if (updateError) throw new Error(updateError.message);
    }
    const { data: acceptedRow } = await supabaseAdmin
      .from("jobs").select("id, date").eq("id", data.job_id).maybeSingle();
    return { ok: true, id: data.job_id, date: acceptedRow?.date ?? null, decision: data.decision };
  });


// Jobs anywhere in a chain I originated (read-only view for A across all downstream hops)
export const listOutboundDispatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await myCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
      .from("jobs")
      .select("id, from_location, to_location, date, time, pickup_at, status, dispatch_status, dispatch_note, dispatched_at, executor_company_id, executor:executor_company_id(id,name), driver_id, drivers(name), pax(id,name), dispatch_chain_company_ids, origin_company_id")
      .contains("dispatch_chain_company_ids", [c.id])
      .neq("executor_company_id", c.id)
      .order("pickup_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// Full hop history for a single job — used by the "chain" timeline dialog.
export const listJobChain = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, executor_company_id, origin_company_id, status, driver_id, drivers(name), executor:executor_company_id(id,name), origin:origin_company_id(id,name), dispatch_chain_company_ids")
      .eq("id", data.job_id).maybeSingle();
    const visible = !!job && (
      job.company_id === c.id ||
      job.executor_company_id === c.id ||
      job.origin_company_id === c.id ||
      (Array.isArray(job.dispatch_chain_company_ids) && job.dispatch_chain_company_ids.includes(c.id))
    );
    if (!visible) throw new Error("Trip not found");
    const { data: hops, error } = await supabaseAdmin
      .from("job_dispatch_hops")
      .select("id, hop_index, from_company_id, to_company_id, status, note, dispatched_at, decided_at, from_company:from_company_id(id,name), to_company:to_company_id(id,name)")
      .eq("job_id", data.job_id)
      .order("hop_index", { ascending: true });
    if (error) throw new Error(error.message);
  });

// ---------- PRICE PROPOSALS (private per-hop) ----------

// Get the previous coordinator in the chain (the one who dispatched to me).
async function previousHopSender(supabaseAdmin: any, jobId: string, myCompanyId: string) {
  const { data: hops } = await supabaseAdmin
    .from("job_dispatch_hops")
    .select("id, hop_index, from_company_id, to_company_id, status")
    .eq("job_id", jobId)
    .eq("to_company_id", myCompanyId)
    .order("hop_index", { ascending: false })
    .limit(1);
  return hops?.[0] ?? null;
}

// A receiving coordinator proposes a price back to the sender (previous hop).
export const proposePartnerPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      amount_eur: z.number().positive().max(99999.99),
      note: z.string().trim().max(300).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const supabaseAdmin = await getAdminClient();
    const hop = await previousHopSender(supabaseAdmin, data.job_id, c.id);
    if (!hop) throw new Error("No sender to propose price to");
    // Supersede any prior open proposals from me to that sender on this job.
    await supabaseAdmin.from("job_price_proposals")
      .update({ status: "superseded", responded_at: new Date().toISOString() } as never)
      .eq("job_id", data.job_id)
      .eq("from_company_id", c.id)
      .eq("to_company_id", hop.from_company_id)
      .in("status", ["proposed", "countered"]);
    const { data: row, error } = await supabaseAdmin.from("job_price_proposals").insert({
      job_id: data.job_id,
      hop_id: hop.id,
      from_party_kind: "company",
      from_company_id: c.id,
      to_company_id: hop.from_company_id,
      amount_eur: data.amount_eur,
      status: "proposed",
      note: data.note ?? null,
    } as never).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

// Coordinator responds to any proposal on a job where they are a party.
export const respondToPriceProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      proposal_id: z.string().uuid(),
      action: z.enum(["accept", "counter", "reject_price", "recall_assignment", "withdraw"]),
      counter_amount_eur: z.number().positive().max(99999.99).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: prop, error: readErr } = await supabaseAdmin.from("job_price_proposals")
      .select("*").eq("id", data.proposal_id).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!prop) throw new Error("Proposal not found");
    const iAmFrom = prop.from_company_id === c.id;
    const iAmTo = prop.to_company_id === c.id;
    if (!iAmFrom && !iAmTo) throw new Error("forbidden");
    if (!["proposed", "countered"].includes(prop.status)) throw new Error("Proposal already closed");
    const now = new Date().toISOString();

    if (data.action === "withdraw") {
      if (!iAmFrom) throw new Error("Only the proposer can withdraw");
      const { error } = await supabaseAdmin.from("job_price_proposals").update({
        status: "recalled", responded_at: now, responded_by_user_id: context.userId,
      } as never).eq("id", data.proposal_id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    if (!iAmTo) throw new Error("Only the receiver can act on this proposal");

    if (data.action === "accept") {
      const { error } = await supabaseAdmin.from("job_price_proposals").update({
        status: "accepted", responded_at: now, responded_by_user_id: context.userId,
      } as never).eq("id", data.proposal_id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    if (data.action === "reject_price") {
      const { error } = await supabaseAdmin.from("job_price_proposals").update({
        status: "recalled", responded_at: now, responded_by_user_id: context.userId,
      } as never).eq("id", data.proposal_id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    if (data.action === "counter") {
      if (!data.counter_amount_eur) throw new Error("counter_amount_eur required");
      // Mark original as countered.
      await supabaseAdmin.from("job_price_proposals").update({
        status: "countered", responded_at: now, responded_by_user_id: context.userId,
      } as never).eq("id", data.proposal_id);
      // Insert new proposal from me back to them (driver or company).
      const insertPayload: Record<string, unknown> = {
        job_id: prop.job_id,
        hop_id: prop.hop_id,
        from_party_kind: "company",
        from_company_id: c.id,
        to_company_id: prop.from_party_kind === "company" ? prop.from_company_id : null,
        to_driver_id: prop.from_party_kind === "driver" ? prop.from_driver_id : null,
        amount_eur: data.counter_amount_eur,
        status: "proposed",
        parent_id: prop.id,
      };
      const { data: newRow, error } = await supabaseAdmin.from("job_price_proposals")
        .insert(insertPayload as never).select("*").single();
      if (error) throw new Error(error.message);
      return { ok: true, proposal: newRow };
    }

    if (data.action === "recall_assignment") {
      // Mark proposal recalled + unassign on the job.
      await supabaseAdmin.from("job_price_proposals").update({
        status: "recalled", responded_at: now, responded_by_user_id: context.userId,
      } as never).eq("id", data.proposal_id);
      if (prop.from_party_kind === "driver") {
        // Clear the driver from the job (return to unassigned).
        const { error } = await supabaseAdmin.from("jobs").update({
          driver_id: null,
          driver_accepted_at: null,
        } as never).eq("id", prop.job_id);
        if (error) throw new Error(error.message);
      } else {
        // Partner recall: revert executor to previous sender and remove the hop.
        const { data: job } = await supabaseAdmin.from("jobs")
          .select("id, dispatch_chain_company_ids").eq("id", prop.job_id).maybeSingle();
        if (job && prop.hop_id) {
          const { data: hopRow } = await supabaseAdmin.from("job_dispatch_hops")
            .select("id, from_company_id, to_company_id").eq("id", prop.hop_id).maybeSingle();
          if (hopRow) {
            await supabaseAdmin.from("job_dispatch_hops").delete().eq("id", hopRow.id);
            const chain: string[] = Array.isArray((job as any).dispatch_chain_company_ids)
              ? (job as any).dispatch_chain_company_ids : [];
            await supabaseAdmin.from("jobs").update({
              executor_company_id: hopRow.from_company_id,
              dispatch_status: "rejected",
              dispatch_decided_at: now,
              dispatch_chain_company_ids: chain.filter((id) => id !== hopRow.to_company_id),
            } as never).eq("id", prop.job_id);
          }
        }
      }
      return { ok: true };
    }
    throw new Error("Unknown action");
  });

// Return all proposals on a job where my company is a party.
export const listPriceProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await myCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: rows, error } = await supabaseAdmin.from("job_price_proposals")
      .select("id, from_party_kind, from_company_id, from_driver_id, to_company_id, to_driver_id, amount_eur, status, parent_id, note, created_at, responded_at, hop_id")
      .eq("job_id", data.job_id)
      .or(`from_company_id.eq.${c.id},to_company_id.eq.${c.id}`)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // Attach display names for parties (drivers + companies).
    const driverIds = Array.from(new Set((rows ?? []).flatMap((r: any) => [r.from_driver_id, r.to_driver_id].filter(Boolean))));
    const companyIds = Array.from(new Set((rows ?? []).flatMap((r: any) => [r.from_company_id, r.to_company_id].filter(Boolean))));
    const [{ data: drvs }, { data: comps }] = await Promise.all([
      driverIds.length ? supabaseAdmin.from("drivers").select("id,name").in("id", driverIds) : Promise.resolve({ data: [] as any[] }),
      companyIds.length ? supabaseAdmin.from("companies").select("id,name").in("id", companyIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const dName = new Map((drvs ?? []).map((d: any) => [d.id, d.name]));
    const cName = new Map((comps ?? []).map((x: any) => [x.id, x.name]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      i_am_from: r.from_company_id === c.id,
      i_am_to: r.to_company_id === c.id,
      from_label: r.from_party_kind === "driver" ? (dName.get(r.from_driver_id) ?? "Driver") : (cName.get(r.from_company_id) ?? "Coordinator"),
      to_label: r.to_driver_id ? (dName.get(r.to_driver_id) ?? "Driver") : (cName.get(r.to_company_id) ?? "Coordinator"),
    }));
  });

// Count of open price proposals awaiting my response (dashboard flash).
export const countOpenPriceProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await myCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { count, error } = await supabaseAdmin.from("job_price_proposals")
      .select("id", { count: "exact", head: true })
      .eq("to_company_id", c.id)
      .in("status", ["proposed"]);
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });


