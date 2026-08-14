import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePortalRecipientBooking, portalRecipientBookingInput } from "@/lib/portal-recipient-booking";

const portalType = z.enum(["corporate", "hr", "hotel", "crew_change", "conference", "event", "client", "custom"]);
const portalStatus = z.enum(["draft", "active", "disabled"]);
const portalFieldSetting = z.object({ mode: z.enum(["hidden", "optional", "required"]) });

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
  booking_fields: z.object({
    pickup: portalFieldSetting.optional(),
    destination: portalFieldSetting.optional(),
    pickup_date: portalFieldSetting.optional(),
    pickup_time: portalFieldSetting.optional(),
    passenger: portalFieldSetting.optional(),
    contact_phone: portalFieldSetting.optional(),
    operation_group: portalFieldSetting.optional(),
    notes: portalFieldSetting.optional(),
  }).optional(),
  submission_mode: z.enum(["direct", "approval_required"]).optional(),
}).default({});

async function companyId(userId: string, supabase: any): Promise<string | null> {
  const { data: owned } = await supabase.from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
  if (owned?.id) return owned.id;
  const { data: linked } = await supabase.from("drivers").select("company_id").eq("linked_user_id", userId).maybeSingle();
  return linked?.company_id ?? null;
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
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
    const src = source as unknown as { name: string; description: string | null; portal_type: string; configuration: any };
    const { data: row, error } = await context.supabase.from("portals" as any)
      .insert({ ...src, name: data.name ?? `${src.name} Copy`, company_id: cid, created_by: context.userId, status: "draft" })
      .select("id, company_id, name, description, portal_type, status, configuration, created_by, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const recipientInput = z.object({
  portal_id: z.string().uuid(),
  recipient_company: z.string().trim().min(1).max(160),
  recipient_name: z.string().trim().min(1).max(160),
  contact_display_name: z.string().max(160).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

export const listPortalRecipients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ portal_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) return [];
    const { data: rows, error } = await context.supabase.from("portal_recipients" as any)
      .select("id, portal_id, recipient_company, recipient_name, contact_display_name, expires_at, revoked_at, disabled_at, last_accessed_at, created_at")
      .eq("portal_id", data.portal_id).eq("company_id", cid).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const issuePortalRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => recipientInput.parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) throw new Error("No company found.");
    const token = randomBytes(32).toString("base64url");
    const a = await adminClient();
    const { data: portal } = await a.from("portals").select("id, company_id, status").eq("id", data.portal_id).eq("company_id", cid).maybeSingle();
    if (!portal) throw new Error("Portal not found.");
    if (portal.status === "disabled") throw new Error("Disabled portals cannot be issued.");
    const { data: row, error } = await a.from("portal_recipients").insert({
      portal_id: data.portal_id, company_id: cid, recipient_company: data.recipient_company,
      recipient_name: data.recipient_name, contact_display_name: data.contact_display_name ?? null,
      token_hash: tokenHash(token), expires_at: data.expires_at ?? null, created_by: context.userId,
    }).select("id, portal_id, recipient_company, recipient_name, contact_display_name, expires_at, revoked_at, disabled_at, last_accessed_at, created_at").single();
    if (error) throw new Error(error.message);
    await a.from("portal_recipient_activity").insert({ portal_recipient_id: row.id, portal_id: data.portal_id, company_id: cid, action: "issued" });
    return { recipient: row, token };
  });

export const setPortalRecipientState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), action: z.enum(["revoke", "disable", "reactivate"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) throw new Error("No company found.");
    const a = await adminClient();
    const { data: recipient } = await a.from("portal_recipients").select("id, portal_id, company_id, revoked_at, disabled_at").eq("id", data.id).eq("company_id", cid).maybeSingle();
    if (!recipient) throw new Error("Recipient not found.");
    const patch = data.action === "revoke" ? { revoked_at: new Date().toISOString() } : data.action === "disable" ? { disabled_at: new Date().toISOString() } : { disabled_at: null, revoked_at: null };
    const { data: row, error } = await a.from("portal_recipients").update(patch).eq("id", data.id).eq("company_id", cid)
      .select("id, portal_id, recipient_company, recipient_name, contact_display_name, expires_at, revoked_at, disabled_at, last_accessed_at, created_at").single();
    if (error) throw new Error(error.message);
    await a.from("portal_recipient_activity").insert({ portal_recipient_id: data.id, portal_id: recipient.portal_id, company_id: cid, action: data.action === "revoke" ? "revoked" : data.action === "disable" ? "disabled" : "reactivated" });
    return row;
  });

export const resolvePortalRecipient = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().min(32).max(256) }).parse(input))
  .handler(async ({ data }) => {
    const resolved = await resolvePortalRecipientAccess(data.token);
    return { portal: resolved.portal, recipient: { recipient_company: resolved.recipient.recipient_company, recipient_name: resolved.recipient.recipient_name, contact_display_name: resolved.recipient.contact_display_name } };
  });

/** Server-only resolver used by portal booking handlers. It returns trusted
 * identity/configuration and never accepts a browser-supplied company id. */
export async function resolvePortalRecipientAccess(token: string) {
    const a = await adminClient();
    const { data: recipient } = await a.from("portal_recipients").select("id, portal_id, company_id, recipient_company, recipient_name, contact_display_name, expires_at, revoked_at, disabled_at")
      .eq("token_hash", tokenHash(token)).maybeSingle();
    if (!recipient || recipient.revoked_at || recipient.disabled_at || (recipient.expires_at && new Date(recipient.expires_at).getTime() <= Date.now())) throw new Error("Portal unavailable.");
    const { data: portal } = await a.from("portals").select("id, name, description, portal_type, status, configuration").eq("id", recipient.portal_id).eq("company_id", recipient.company_id).maybeSingle();
    if (!portal || portal.status !== "active") throw new Error("Portal unavailable.");
    await a.from("portal_recipients").update({ last_accessed_at: new Date().toISOString() }).eq("id", recipient.id);
    await a.from("portal_recipient_activity").insert({ portal_recipient_id: recipient.id, portal_id: recipient.portal_id, company_id: recipient.company_id, action: "accessed" });
    return { portal, recipient };
}

export const listPortalSubmissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ portal_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) return [];
    const a = await adminClient();
    const tables = a as any;
    const { data: rows, error } = await tables.from("portal_submissions")
      .select("id, portal_id, portal_recipient_id, company_id, status, payload, job_id, created_at, portal_recipients(recipient_company, recipient_name)")
      .eq("portal_id", data.portal_id)
      .eq("company_id", cid)
      .in("status", ["pending", "approving"])
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const approvePortalSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) throw new Error("No company found.");
    const a = await adminClient();
    const tables = a as any;
    const select = "id, portal_id, portal_recipient_id, company_id, status, payload, job_id";
    let { data: submission, error: loadError } = await tables.from("portal_submissions")
      .select(select).eq("id", data.id).eq("company_id", cid).maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!submission) throw new Error("Submission not found.");
    if (submission.status === "approved" && submission.job_id) {
      return { ok: true, job_id: submission.job_id, already_approved: true };
    }
    if (submission.status === "rejected") throw new Error("Submission has been rejected.");

    let claimed = false;
    if (submission.status === "pending") {
      const { data: claimedRow, error: claimError } = await tables.from("portal_submissions")
        .update({ status: "approving" }).eq("id", data.id).eq("company_id", cid).eq("status", "pending")
        .select(select).maybeSingle();
      if (claimError) throw new Error(claimError.message);
      if (claimedRow) {
        submission = claimedRow;
        claimed = true;
      } else {
        const { data: latest } = await tables.from("portal_submissions").select(select)
          .eq("id", data.id).eq("company_id", cid).maybeSingle();
        submission = latest;
      }
    }
    if (!submission) throw new Error("Submission not found.");
    const approvalSubmission = submission;

    const source = `portal:${approvalSubmission.portal_id}:${approvalSubmission.portal_recipient_id}:submission:${approvalSubmission.id}`;
    const findExistingJob = async () => {
      const { data: job } = await a.from("jobs").select("id").eq("company_id", cid).eq("source", source).maybeSingle();
      return job?.id as string | undefined;
    };
    const finishApproval = async (jobId: string) => {
      const { data: approved, error } = await tables.from("portal_submissions").update({
        status: "approved", job_id: jobId, decided_by: context.userId, decided_at: new Date().toISOString(), rejection_reason: null,
      }).eq("id", approvalSubmission.id).eq("company_id", cid).eq("status", "approving").select("id, job_id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!approved) throw new Error("Submission approval could not be completed.");
      return { ok: true, job_id: jobId, already_approved: !claimed };
    };

    const existingJobId = await findExistingJob();
    if (existingJobId) return finishApproval(existingJobId);
    if (!claimed) throw new Error("Submission approval is already in progress.");

    let input: ReturnType<typeof normalizePortalRecipientBooking>;
    try {
      input = normalizePortalRecipientBooking(portalRecipientBookingInput.parse(approvalSubmission.payload));
      const { createAuthoritativeJob } = await import("@/lib/coordinator.functions");
      const job = await createAuthoritativeJob({
        ...input,
        qr_strict_mode: false,
        tracking_enabled: false,
        label_ids: undefined,
        pax: undefined,
      }, {
        company_id: cid,
        actor_type: "portal",
        actor_user_id: context.userId,
        source,
      });
      return finishApproval(job.id);
    } catch (error) {
      const recoveredJobId = await findExistingJob();
      if (recoveredJobId) return finishApproval(recoveredJobId);
      await tables.from("portal_submissions").update({ status: "pending" })
        .eq("id", approvalSubmission.id).eq("company_id", cid).eq("status", "approving");
      throw error;
    }
  });

export const rejectPortalSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const cid = await companyId(context.userId, context.supabase);
    if (!cid) throw new Error("No company found.");
    const a = await adminClient();
    const tables = a as any;
    const { data: rejected, error } = await tables.from("portal_submissions").update({
      status: "rejected", rejection_reason: data.reason || null, decided_by: context.userId, decided_at: new Date().toISOString(),
    }).eq("id", data.id).eq("company_id", cid).eq("status", "pending").select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (rejected) return { ok: true };
    const { data: existing } = await tables.from("portal_submissions").select("status")
      .eq("id", data.id).eq("company_id", cid).maybeSingle();
    if (existing?.status === "rejected") return { ok: true, already_rejected: true };
    throw new Error(existing ? "Submission can no longer be rejected." : "Submission not found.");
  });
