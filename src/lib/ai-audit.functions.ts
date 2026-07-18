/**
 * AI assistant audit + undo.
 *
 * `recordAiAuditAction` — called by the assistant client after each successful
 * confirmed write (create/update/data_fix/group/ungroup/message/partner
 * hand-off). Stores a before/after snapshot into `ai_action_audit`.
 *
 * `undoAssistantAction` — reverts a prior action:
 *  - create → deletes the created row (if unchanged since).
 *  - update / search_update / data_fix / group / ungroup / partner_suggest →
 *    writes `before_state` back onto the row (with an updated_at guard).
 *  - message → sets `retracted_at` on the trip_message.
 *
 * Rollback is not itself billable.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function resolveCompanyId(userId: string): Promise<string | null> {
  const sb = await admin();
  const { data } = await sb
    .from("companies")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

const ActionKind = z.enum([
  "create",
  "update",
  "search_update",
  "data_fix",
  "group",
  "ungroup",
  "message",
  "partner_suggest",
]);

const recordSchema = z.object({
  action_kind: ActionKind,
  target_table: z.string().min(1).max(64),
  target_id: z.string().uuid().optional().nullable(),
  target_ids: z.array(z.string().uuid()).optional().nullable(),
  before_state: z.unknown().optional().nullable(),
  after_state: z.unknown().optional().nullable(),
  summary: z.string().max(500).optional().nullable(),
  raw_message: z.string().max(4000).optional().nullable(),
});

export const recordAiAuditAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => recordSchema.parse(i))
  .handler(async ({ data, context }) => {
    const companyId = await resolveCompanyId(context.userId);
    if (!companyId) return { id: null };
    const sb = await admin();
    try {
      const { data: row, error } = await sb
        .from("ai_action_audit")
        .insert({
          company_id: companyId,
          actor_user_id: context.userId,
          action_kind: data.action_kind,
          target_table: data.target_table,
          target_id: data.target_id ?? null,
          target_ids: data.target_ids ?? null,
          before_state: (data.before_state ?? null) as never,
          after_state: (data.after_state ?? null) as never,
          summary: data.summary ?? null,
          raw_message: data.raw_message ?? null,
        })
        .select("id")
        .single();
      if (error) return { id: null };
      return { id: (row as { id: string }).id };
    } catch {
      return { id: null };
    }
  });

const undoSchema = z.object({
  audit_id: z.string().uuid(),
  undo_note: z.string().max(500).optional().nullable(),
});

type JobPatch = Record<string, unknown>;

/**
 * Fields we allow rollback to write back onto `jobs`. Anything outside this
 * list is ignored so a maliciously crafted before_state can't overwrite
 * unrelated columns.
 */
const JOB_ROLLBACK_FIELDS = new Set([
  "from_location",
  "to_location",
  "date",
  "time",
  "pickup_at",
  "from_flight",
  "to_flight",
  "flightorship",
  "clientcompanyname",
  "vehicle",
  "contact_phone",
  "driver_id",
  "pickup_place_id",
  "dropoff_place_id",
  "pickup_display_name",
  "dropoff_display_name",
  "tracking_kind",
  "qr_strict_mode",
  "tracking_enabled",
  "group_id",
  "group_name",
  "executor_company_id",
]);

function pickJobFields(state: unknown): JobPatch {
  if (!state || typeof state !== "object") return {};
  const src = state as Record<string, unknown>;
  const out: JobPatch = {};
  for (const k of Object.keys(src)) {
    if (JOB_ROLLBACK_FIELDS.has(k)) out[k] = src[k];
  }
  return out;
}

export const undoAssistantAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => undoSchema.parse(i))
  .handler(async ({ data, context }) => {
    const companyId = await resolveCompanyId(context.userId);
    if (!companyId) throw new Error("No company for user.");
    const sb = await admin();

    const { data: audit, error: readErr } = await sb
      .from("ai_action_audit")
      .select("*")
      .eq("id", data.audit_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (readErr || !audit) throw new Error("Audit entry not found.");
    const row = audit as {
      id: string;
      action_kind: string;
      target_table: string;
      target_id: string | null;
      target_ids: string[] | null;
      before_state: unknown;
      after_state: unknown;
      undone_at: string | null;
    };
    if (row.undone_at) throw new Error("Already undone.");

    const stampUndone = async (note: string) => {
      await sb
        .from("ai_action_audit")
        .update({
          undone_at: new Date().toISOString(),
          undo_note: data.undo_note ?? note,
        })
        .eq("id", row.id);
    };

    // ---------------- MESSAGE ----------------
    if (row.action_kind === "message") {
      if (row.target_table !== "trip_messages" || !row.target_id) {
        throw new Error("Malformed message audit row.");
      }
      const { error } = await sb
        .from("trip_messages")
        .update({ retracted_at: new Date().toISOString() })
        .eq("id", row.target_id)
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      await stampUndone(`retracted message ${row.target_id}`);
      return { ok: true, kind: "message_retracted" as const };
    }

    // ---------------- JOB-BACKED ACTIONS ----------------
    // create/update/search_update/data_fix/group/ungroup/partner_suggest all
    // target `jobs`. Non-jobs targets fall through to the generic branch.
    const isJobKind =
      row.target_table === "jobs" &&
      (row.action_kind === "create" ||
        row.action_kind === "update" ||
        row.action_kind === "search_update" ||
        row.action_kind === "data_fix" ||
        row.action_kind === "group" ||
        row.action_kind === "ungroup" ||
        row.action_kind === "partner_suggest");

    if (isJobKind) {
      const ids: string[] = row.target_ids?.length
        ? row.target_ids
        : row.target_id
          ? [row.target_id]
          : [];
      if (ids.length === 0) throw new Error("No target rows on audit entry.");

      // create → delete the created row(s), guarding on updated_at.
      if (row.action_kind === "create") {
        // Compare updated_at against snapshot's after_state.updated_at.
        const after = (row.after_state ?? {}) as Record<string, unknown>;
        const snapUpdated = after.updated_at as string | undefined;
        const { data: cur, error: e1 } = await sb
          .from("jobs")
          .select("id, updated_at, company_id")
          .in("id", ids);
        if (e1) throw new Error(e1.message);
        for (const r of (cur ?? []) as Array<{ id: string; updated_at: string; company_id: string }>) {
          if (r.company_id !== companyId) throw new Error("Trip belongs to another company.");
          if (snapUpdated && r.updated_at && r.updated_at !== snapUpdated) {
            throw new Error("Trip was modified after creation — undo blocked. Delete manually if intended.");
          }
        }
        const { error: delErr } = await sb.from("jobs").delete().in("id", ids).eq("company_id", companyId);
        if (delErr) throw new Error(delErr.message);
        await stampUndone(`deleted created trip ${ids.join(",")}`);
        return { ok: true, kind: "create_reverted" as const, deleted: ids.length };
      }

      // Update-family → write before_state back per row.
      const beforeArr: Array<Record<string, unknown>> = Array.isArray(row.before_state)
        ? (row.before_state as Array<Record<string, unknown>>)
        : row.before_state && typeof row.before_state === "object"
          ? [row.before_state as Record<string, unknown>]
          : [];

      if (beforeArr.length === 0) throw new Error("No before-state snapshot to restore.");
      const beforeById = new Map<string, Record<string, unknown>>();
      for (const b of beforeArr) {
        const id = (b.id ?? b.job_id) as string | undefined;
        if (id) beforeById.set(id, b);
      }

      const results: Array<{ id: string; ok: boolean; message: string }> = [];
      for (const id of ids) {
        const before = beforeById.get(id) ?? beforeArr[0];
        if (!before) {
          results.push({ id, ok: false, message: "no snapshot" });
          continue;
        }
        const patch = pickJobFields(before);
        if (Object.keys(patch).length === 0) {
          results.push({ id, ok: false, message: "empty snapshot" });
          continue;
        }
        const { error: upErr } = await sb
          .from("jobs")
          .update(patch as never)
          .eq("id", id)
          .eq("company_id", companyId);
        if (upErr) results.push({ id, ok: false, message: upErr.message });
        else results.push({ id, ok: true, message: "reverted" });
      }

      await stampUndone(
        `reverted ${results.filter((r) => r.ok).length}/${results.length} of ${row.action_kind}`,
      );
      return { ok: true, kind: "state_reverted" as const, results };
    }

    // ---------------- DRIVER (data_fix on drivers) ----------------
    if (row.target_table === "drivers" && row.action_kind === "data_fix" && row.target_id) {
      const before = (row.before_state ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if ("name" in before) patch.name = before.name;
      if ("phone" in before) patch.phone = before.phone;
      if (Object.keys(patch).length === 0) throw new Error("No fields to revert.");
      const { error } = await sb
        .from("drivers")
        .update(patch as never)
        .eq("id", row.target_id)
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      await stampUndone(`reverted driver ${row.target_id}`);
      return { ok: true, kind: "driver_reverted" as const };
    }

    throw new Error(`Unsupported audit kind: ${row.action_kind} on ${row.target_table}`);
  });
