import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

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
      company_id: companyId ?? undefined,
      route: data.route,
      question: data.question,
      answer: data.answer,
      confidence: data.confidence,
      sources_used: data.sources_used ? { list: data.sources_used } : undefined,
    }).select("id").single();
    if (error) throw new Error(error.message);

    // Try to spend a point; ignore failures so chat doesn't break.
    if (companyId) {
      await sb.rpc("spend_points", {
        _company_id: companyId,
        _feature_key: "ai_guide_chat",
        _job_id: undefined,
        _note: "Ask the Guide question",
        _cost_override: undefined,
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
    await sb.from("support_tickets").update({
      updated_at: new Date().toISOString(),
      status: data.status,
      resolved_at: data.status === "resolved" ? new Date().toISOString() : undefined,
      priority: data.priority,
    }).eq("id", data.id);
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

/**
 * Analyze the latest Guide turn: returns a confidence score, clarifying
 * questions the AI would like the user to answer, and whether it recommends
 * escalating to a human admin. Uses a small structured JSON call.
 */
export const analyzeHelpTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
    thread: z.array(z.object({ role: z.string(), text: z.string() })).max(20).optional(),
  }).parse(raw))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { confidence: 0.5, clarifying: [], escalate: false, suggested_subject: null };

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3.1-flash-lite");

    const transcript = (data.thread ?? [{ role: "user", text: data.question }, { role: "assistant", text: data.answer }])
      .slice(-8)
      .map((t) => `${t.role.toUpperCase()}: ${t.text}`)
      .join("\n\n");

    const prompt = `You are a QA reviewer for an in-app AI Help Guide.
Given the recent conversation, output STRICT JSON (no markdown, no code fences) with:
- "confidence": number 0..1 — how likely the assistant's LAST answer fully resolves the user's problem
- "clarifying": array of up to 3 short questions (<=80 chars each) the assistant should ask to resolve the issue. Empty if none needed.
- "escalate": boolean — true if a human admin should take over (low confidence, missing data only an admin has, bug report, billing dispute, or the user seems stuck)
- "suggested_subject": short (<=60 chars) support-ticket subject if escalate=true, else null

CONVERSATION:
${transcript}

JSON:`;

    try {
      const { text } = await generateText({ model, prompt });
      const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleaned) as {
        confidence?: number; clarifying?: unknown; escalate?: boolean; suggested_subject?: string | null;
      };
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));
      const clarifying = Array.isArray(parsed.clarifying)
        ? parsed.clarifying.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 3).map((s) => s.slice(0, 120))
        : [];
      const escalate = Boolean(parsed.escalate) || confidence < 0.4;
      const suggested_subject = typeof parsed.suggested_subject === "string" && parsed.suggested_subject.trim()
        ? parsed.suggested_subject.slice(0, 80)
        : null;
      return { confidence, clarifying, escalate, suggested_subject };
    } catch {
      return { confidence: 0.5, clarifying: [], escalate: false, suggested_subject: null };
    }
  });
