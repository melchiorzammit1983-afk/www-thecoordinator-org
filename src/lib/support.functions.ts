import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function resolveMyCompanyId(userId: string): Promise<string | null> {
  const sb = await admin();
  const { data } = await sb.from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
  return data?.id ?? null;
}

async function isAdmin(userId: string): Promise<boolean> {
  const sb = await admin();
  const { data: u } = await sb.auth.admin.getUserById(userId);
  const email = u?.user?.email?.toLowerCase();
  if (!email) return false;
  const { data } = await sb.from("admin_emails").select("email").ilike("email", email).maybeSingle();
  return !!data;
}

/* ---------- Help Q&A logging ---------- */

export const logHelpQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({
      question: z.string().min(1).max(2000),
      answer: z.string().max(20000).optional(),
      route: z.string().max(200).optional(),
      confidence: z.number().min(0).max(1).optional(),
      sources_used: z.array(z.string()).optional(),
    }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const companyId = await resolveMyCompanyId(context.userId);
    const { data: row, error } = await sb.from("help_ai_log").insert({
      user_id: context.userId,
      company_id: companyId,
      route: data.route ?? null,
      question: data.question,
      answer: data.answer ?? null,
      confidence: data.confidence ?? null,
      sources_used: data.sources_used ? { list: data.sources_used } : null,
    }).select("id").single();
    if (error) throw new Error(error.message);

    // Try to spend a point; ignore failures so chat doesn't break.
    if (companyId) {
      await sb.rpc("spend_points", {
        _company_id: companyId,
        _feature_key: "ai_guide_chat",
        _job_id: null,
        _note: "Ask the Guide question",
        _cost_override: null,
      });
    }
    return { id: row.id };
  });

export const rateHelpAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ log_id: z.string().uuid(), thumbs: z.union([z.literal(-1), z.literal(1)]) }).parse(raw),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    await sb.from("help_ai_log").update({ thumbs: data.thumbs }).eq("id", data.log_id);
    return { ok: true };
  });

/* ---------- Tickets (user) ---------- */

export const createSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({
      subject: z.string().min(3).max(200),
      body: z.string().min(3).max(5000),
      route: z.string().max(200).optional(),
      viewport: z.string().max(50).optional(),
      ai_thread: z.array(z.object({ role: z.string(), text: z.string() })).optional(),
      from_log_id: z.string().uuid().optional(),
    }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const companyId = await resolveMyCompanyId(context.userId);
    const { data: ticket, error } = await sb.from("support_tickets").insert({
      user_id: context.userId,
      company_id: companyId,
      subject: data.subject,
      status: "open",
      priority: "medium",
      route: data.route ?? null,
      viewport: data.viewport ?? null,
      ai_thread: data.ai_thread ? { turns: data.ai_thread } : null,
      admin_unread: true,
      user_unread: false,
    }).select("id").single();
    if (error) throw new Error(error.message);
    await sb.from("support_ticket_messages").insert({
      ticket_id: ticket.id, author: "user", author_user_id: context.userId, body: data.body,
    });
    if (data.from_log_id) {
      await sb.from("help_ai_log").update({ escalated_ticket_id: ticket.id }).eq("id", data.from_log_id);
    }
    return { id: ticket.id };
  });

export const listMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await admin();
    const { data } = await sb.from("support_tickets")
      .select("id, subject, status, priority, updated_at, created_at, user_unread")
      .eq("user_id", context.userId).order("updated_at", { ascending: false }).limit(100);
    return data ?? [];
  });

export const getTicket = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const admin_ok = await isAdmin(context.userId);
    const { data: t } = await sb.from("support_tickets").select("*").eq("id", data.id).maybeSingle();
    if (!t) throw new Error("Ticket not found");
    if (t.user_id !== context.userId && !admin_ok) throw new Error("Forbidden");
    const { data: msgs } = await sb.from("support_ticket_messages")
      .select("*").eq("ticket_id", data.id).order("created_at", { ascending: true });
    // Clear unread flag for the reader
    if (admin_ok && t.admin_unread) {
      await sb.from("support_tickets").update({ admin_unread: false }).eq("id", data.id);
    } else if (!admin_ok && t.user_unread) {
      await sb.from("support_tickets").update({ user_unread: false }).eq("id", data.id);
    }
    return { ticket: t, messages: msgs ?? [] };
  });

export const addTicketMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ ticket_id: z.string().uuid(), body: z.string().min(1).max(5000) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const admin_ok = await isAdmin(context.userId);
    const { data: t } = await sb.from("support_tickets").select("user_id").eq("id", data.ticket_id).maybeSingle();
    if (!t) throw new Error("Ticket not found");
    if (t.user_id !== context.userId && !admin_ok) throw new Error("Forbidden");
    await sb.from("support_ticket_messages").insert({
      ticket_id: data.ticket_id,
      author: admin_ok ? "admin" : "user",
      author_user_id: context.userId,
      body: data.body,
    });
    await sb.from("support_tickets").update({
      updated_at: new Date().toISOString(),
      admin_unread: admin_ok ? false : true,
      user_unread: admin_ok ? true : false,
    }).eq("id", data.ticket_id);
    return { ok: true };
  });

/* ---------- Admin ---------- */

export const adminListTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ status: z.enum(["open", "resolved", "all"]).default("open") }).parse(raw ?? {}),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.userId))) throw new Error("Forbidden");
    const sb = await admin();
    let q = sb.from("support_tickets")
      .select("id, subject, status, priority, updated_at, created_at, admin_unread, company_id, user_id")
      .order("updated_at", { ascending: false }).limit(200);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows } = await q;
    return rows ?? [];
  });

export const adminSetTicketStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["open", "resolved"]).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.userId))) throw new Error("Forbidden");
    const sb = await admin();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status) {
      patch.status = data.status;
      if (data.status === "resolved") patch.resolved_at = new Date().toISOString();
    }
    if (data.priority) patch.priority = data.priority;
    await sb.from("support_tickets").update(patch).eq("id", data.id);
    return { ok: true };
  });

export const adminHelpInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isAdmin(context.userId))) throw new Error("Forbidden");
    const sb = await admin();
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const [recentQs, openTickets, thumbsDown, tickets7d] = await Promise.all([
      sb.from("help_ai_log")
        .select("id, question, answer, route, confidence, thumbs, escalated_ticket_id, created_at, company_id")
        .gte("created_at", since).order("created_at", { ascending: false }).limit(100),
      sb.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
      sb.from("help_ai_log").select("id", { count: "exact", head: true }).eq("thumbs", -1).gte("created_at", since),
      sb.from("support_tickets").select("id", { count: "exact", head: true }).gte("created_at", since),
    ]);
    return {
      recent: recentQs.data ?? [],
      openTicketsCount: openTickets.count ?? 0,
      thumbsDownCount: thumbsDown.count ?? 0,
      ticketsLast30d: tickets7d.count ?? 0,
    };
  });
