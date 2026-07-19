import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LessonKind = z.enum(["parse_pattern", "qa", "suggestion_rule", "signal_fix"]);
const Surface = z.enum(["guide", "extract", "suggestion", "other"]);

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function myCompanyId(userId: string): Promise<string | null> {
  const sb = await adminClient();
  const { data } = await sb.from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
  return data?.id ?? null;
}

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const sb = await adminClient();
  const { data: u } = await sb.auth.admin.getUserById(userId);
  const email = u.user?.email?.toLowerCase();
  if (!email) return false;
  const { data } = await sb.from("admin_emails").select("email");
  return (data ?? []).some((r) => r.email?.toLowerCase() === email);
}

/** Submit a new lesson (company scope). Runs PII redaction first. */
export const submitLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      kind: LessonKind,
      title: z.string().min(3).max(140),
      example_input: z.string().min(1).max(40000),
      rule_text: z.string().min(3).max(20000),
      propose_global: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { redactPii, logPiiAudit } = await import("@/lib/ai-pii.server");
    const { embedText } = await import("@/lib/ai-embed.server");

    const companyId = await myCompanyId(context.userId);
    if (!companyId) throw new Error("No company for this user.");

    const exampleR = redactPii(data.example_input);
    const ruleR = redactPii(data.rule_text);
    if (!exampleR.safe) throw new Error(`Example rejected: ${exampleR.reason}`);
    if (!ruleR.safe) throw new Error(`Rule rejected: ${ruleR.reason}`);

    const stripped: Record<string, number> = { ...exampleR.stripped };
    for (const [k, v] of Object.entries(ruleR.stripped)) stripped[k] = (stripped[k] ?? 0) + v;

    await logPiiAudit({
      companyId,
      userId: context.userId,
      source: "submitLesson",
      stripped,
      inputLength: data.example_input.length + data.rule_text.length,
      outputLength: exampleR.text.length + ruleR.text.length,
    });

    const embedding = await embedText(`${data.title}\n${ruleR.text}\n${exampleR.text}`);

    const sb = await adminClient();
    const { data: row, error } = await sb
      .from("ai_lessons")
      .insert({
        kind: data.kind,
        scope: "company",
        company_id: companyId,
        title: data.title,
        example_input_redacted: exampleR.text,
        rule_text: ruleR.text,
        embedding: embedding as unknown as string,
        status: data.propose_global ? "pending" : "approved",
        submitted_by: context.userId,
      })
      .select("id, status, scope")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, status: row.status, propose_global: data.propose_global };
  });

/** Vote / correction on any AI output. Fully redacted before storage. */
export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      surface: Surface,
      vote: z.enum(["up", "down"]),
      question: z.string().max(4000).optional(),
      answer: z.string().max(8000).optional(),
      correction: z.string().max(2000).optional(),
      route: z.string().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { redactPii, logPiiAudit } = await import("@/lib/ai-pii.server");
    const companyId = await myCompanyId(context.userId);
    const q = data.question ? redactPii(data.question) : null;
    const a = data.answer ? redactPii(data.answer) : null;
    const c = data.correction ? redactPii(data.correction) : null;

    const stripped: Record<string, number> = {};
    for (const r of [q, a, c]) if (r) for (const [k, v] of Object.entries(r.stripped)) stripped[k] = (stripped[k] ?? 0) + v;
    if (Object.keys(stripped).length) {
      await logPiiAudit({
        companyId,
        userId: context.userId,
        source: `feedback:${data.surface}`,
        stripped,
        inputLength: (data.question?.length ?? 0) + (data.answer?.length ?? 0) + (data.correction?.length ?? 0),
        outputLength: (q?.text.length ?? 0) + (a?.text.length ?? 0) + (c?.text.length ?? 0),
      });
    }

    const sb = await adminClient();
    const { error } = await sb.from("ai_lesson_feedback").insert({
      user_id: context.userId,
      company_id: companyId,
      surface: data.surface,
      vote: data.vote,
      question_redacted: q?.text ?? null,
      answer_redacted: a?.text ?? null,
      correction_redacted: c?.text ?? null,
      route: data.route ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Search lessons semantically relevant to a piece of input. */
export const searchRelevantLessons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ kind: LessonKind, input: z.string().min(1).max(4000), limit: z.number().int().min(1).max(10).default(5) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { embedText } = await import("@/lib/ai-embed.server");
    const companyId = await myCompanyId(context.userId);
    if (!companyId) return { lessons: [] };
    const vec = await embedText(data.input);
    if (!vec) return { lessons: [] };
    const sb = await adminClient();
    const { data: rows, error } = await sb.rpc("match_ai_lessons", {
      query_embedding: vec as unknown as string,
      _company_id: companyId,
      _kind: data.kind,
      _limit: data.limit,
    });
    if (error) return { lessons: [] };
    return { lessons: rows ?? [] };
  });

/** Company toggle: contribute / consume global brain. */
export const getShareSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await myCompanyId(context.userId);
    if (!companyId) return null;
    const sb = await adminClient();
    const { data } = await sb.from("ai_lesson_share_settings").select("*").eq("company_id", companyId).maybeSingle();
    return data ?? { company_id: companyId, contribute_to_global: false, consume_global: true };
  });

export const setShareSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contribute_to_global: z.boolean(), consume_global: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const companyId = await myCompanyId(context.userId);
    if (!companyId) throw new Error("No company.");
    const sb = await adminClient();
    const { error } = await sb.from("ai_lesson_share_settings").upsert({
      company_id: companyId,
      contribute_to_global: data.contribute_to_global,
      consume_global: data.consume_global,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Company: list own lessons. */
export const listMyLessons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await myCompanyId(context.userId);
    if (!companyId) return [];
    const sb = await adminClient();
    const { data } = await sb
      .from("ai_lessons")
      .select("id, kind, title, rule_text, example_input_redacted, status, scope, usage_count, positive_count, negative_count, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const archiveMyLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const companyId = await myCompanyId(context.userId);
    if (!companyId) throw new Error("No company.");
    const sb = await adminClient();
    const { error } = await sb.from("ai_lessons").update({ status: "archived" }).eq("id", data.id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: curation queue. */
export const adminListLessons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ status: z.enum(["pending","approved","rejected","archived","all"]).default("pending") }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isPlatformAdmin(context.userId))) throw new Error("Forbidden");
    const sb = await adminClient();
    let q = sb.from("ai_lessons").select("*").order("created_at", { ascending: false }).limit(200);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminDecideLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      action: z.enum(["approve_global", "approve_company", "reject", "archive"]),
      reason: z.string().max(500).optional(),
      edited_rule: z.string().max(2000).optional(),
      edited_title: z.string().max(140).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isPlatformAdmin(context.userId))) throw new Error("Forbidden");
    const sb = await adminClient();
    type LessonPatch = {
      approved_by: string;
      rule_text?: string;
      title?: string;
      scope?: "company" | "global";
      status?: "pending" | "approved" | "rejected" | "archived";
      reject_reason?: string | null;
    };
    const patch: LessonPatch = { approved_by: context.userId };
    if (data.edited_rule) patch.rule_text = data.edited_rule;
    if (data.edited_title) patch.title = data.edited_title;
    if (data.action === "approve_global") { patch.scope = "global"; patch.status = "approved"; }
    if (data.action === "approve_company") { patch.scope = "company"; patch.status = "approved"; }
    if (data.action === "reject") { patch.status = "rejected"; patch.reject_reason = data.reason ?? null; }
    if (data.action === "archive") { patch.status = "archived"; }
    const { error } = await sb.from("ai_lessons").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
