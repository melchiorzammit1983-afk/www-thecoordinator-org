/**
 * AI coordinator assistant — minimal, text-only.
 *
 * Answers coordinator questions, OR drafts a single trip create/edit as a
 * structured proposal. Never writes to the DB — the client confirms and calls
 * the existing createJob / updateJob server functions.
 *
 * Gated behind `ai_coordinator_assist` and metered via `spend_points` (1pt).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const screenSchema = z
  .object({
    path: z.string().max(200).optional().nullable(),
    trip: z
      .object({
        id: z.string().uuid(),
        trip_no: z.number().int().nullable().optional(),
        from_location: z.string().nullable().optional(),
        to_location: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
        time: z.string().nullable().optional(),
        driver_id: z.string().uuid().nullable().optional(),
        driver_name: z.string().nullable().optional(),
        from_flight: z.string().nullable().optional(),
        to_flight: z.string().nullable().optional(),
        vehicle: z.string().nullable().optional(),
        contact_phone: z.string().nullable().optional(),
        clientcompanyname: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

const inputSchema = z.object({
  message: z.string().trim().min(1).max(20000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(40000),
      }),
    )
    .max(20)
    .optional(),
  screen: screenSchema,
});

export type AssistantDraft = {
  kind: "draft";
  action: "create" | "update";
  target_trip_id: string | null;
  fields: {
    from_location?: string | null;
    to_location?: string | null;
    date?: string | null; // yyyy-mm-dd
    time?: string | null; // HH:mm
    driver_id?: string | null;
    driver_name?: string | null;
    vehicle?: string | null;
    contact_phone?: string | null;
    from_flight?: string | null;
    to_flight?: string | null;
    clientcompanyname?: string | null;
    /** Passenger / crew names extracted for this trip (max 200, ≤200 chars each). */
    pax?: string[] | null;
  };
  summary: string;
  /** Parse-time warnings surfaced to the UI so silent extraction gaps are visible. */
  warnings?: string[];
};

export type AssistantAnswer = {
  kind: "answer";
  text: string;
};

export type AssistantBatch = {
  kind: "batch";
  drafts: AssistantDraft[]; // mixed action: all "create" (multi-trip create) OR all "update" (multi-trip edit)
  clarify?: string | null; // question to ask coordinator about missing/ambiguous bits
};

/**
 * Single-record data correction (typo fix) draft. Shown as an old→new diff
 * card. On confirm the UI reuses the existing update function for the
 * target record type (trip → updateJob, driver → updateDriverBasic) and
 * meters via meterAssistantConfirm(assistant_data_fix).
 *
 * `field` for trips is one of the writable jobInput keys (from_location,
 * to_location, contact_phone, clientcompanyname, from_flight, to_flight,
 * vehicle). For drivers it's `name` or `phone`.
 */
export type AssistantDataFix = {
  kind: "data_fix";
  target: "trip" | "driver";
  target_id: string;
  target_label: string; // e.g. "Trip · Airport → Hilton · 10:00" or "Driver · John Doe"
  field: string;
  field_label: string;  // human label e.g. "From location", "Driver phone"
  old_value: string | null;
  new_value: string;
  summary: string;
};

/**
 * Suggest handing off one or more trips to partner companies in the
 * coordinator's existing Collaborate network. SUGGESTION ONLY — the client
 * renders Confirm/Cancel per item and only then calls the existing
 * `dispatchJobToPartner` server function. The assistant never triggers the
 * hand-off itself, and it never accesses any cross-company data beyond
 * partner company id/name (which the coordinator already sees in the
 * Collaborate UI via `listConnections`).
 */
export type AssistantPartnerSuggest = {
  kind: "partner_suggest";
  items: {
    job_id: string;
    job_label: string;        // "10:00 · Hilton → Airport"
    partner_company_id: string;
    partner_name: string;
    reason?: string | null;   // short "why this partner" line, from model
  }[];
  summary: string;
};

/**
 * Structured multi-action proposal (group/ungroup trips, send a driver or
 * client message, and future kinds handled by the OLD Command Bar's execution
 * layer). The assistant returns a validated list; the client stages it into
 * `ai_command_log` via `stageAssistantActions` and applies confirmed items
 * with the existing `applyAiCommandActions` server function — no
 * reimplementation of the underlying writes.
 *
 * `type` mirrors ai_command_log action shapes: assign | unassign | reschedule
 * | status | group | ungroup | message | dispatch | note. We limit the
 * assistant to `group | ungroup | message` for now (create/update trips still
 * go through draft/batch cards, so those write-paths keep their existing
 * verification UI).
 */
export type AssistantCommandActions = {
  kind: "command_actions";
  actions: Array<{
    type: "group" | "ungroup" | "message";
    job_id?: string | null;
    job_ids?: string[] | null;
    group_name?: string | null;
    thread?: "driver" | "client" | "group" | null;
    body?: string | null;
    label: string; // human-readable, e.g. "Group 2 trips as 'Asso 25'"
  }>;
  summary: string;
};

/**
 * Merge duplicate trip cards after coordinator approval. This reuses the
 * existing mergeTrips server function client-side, so passengers are copied to
 * the kept trip and dropped duplicates are cancelled through the same manual
 * merge pathway already used in the UI.
 */
export type AssistantMergeTrips = {
  kind: "merge_trips";
  keep_job_id: string;
  drop_job_ids: string[];
  summary: string;
};

/**
 * Trigger card for the existing AI Auto-Coordinate flow. The server fn
 * `aiAutoCoordinate` is invoked on Confirm from the client and its proposals
 * are then applied one-by-one via `applyAutoCoordinateProposal` — the SAME
 * pathway the AI Auto-Coordinate button used before. No new metering, no
 * duplicate logic.
 */
export type AssistantAutoCoordinate = {
  kind: "auto_coordinate";
  intro: string; // one-line preamble to show above the run button
  /** Verbatim coordinator instruction to inject into the planning prompt. */
  directive?: string | null;
  /** Resolved target when the coordinator named a specific driver or partner. */
  resolved_target?:
    | { type: "driver"; id: string; name: string }
    | { type: "partner"; id: string; name: string }
    | null;
};

/**
 * Confirm-first setting toggle. Currently scoped to `ai_configuration`
 * (owner-controllable). Feature-entitlement changes are admin-only per RLS
 * (see `company_feature_entitlements` policies) — the assistant surfaces
 * those as an answer telling the coordinator to ask their admin.
 */
export type AssistantSettingChange = {
  kind: "setting_change";
  target: "ai_configuration";
  key:
    | "auto_assign_enabled"
    | "auto_extract_bulk"
    | "auto_reply_drafts"
    | "ai_command_enabled"
    | "voice_to_trip_enabled"
    | "auto_coordinate_enabled";
  label: string;
  old_value: boolean;
  new_value: boolean;
  summary: string;
};

/**
 * On-demand mistake/duplicate scan. READ-ONLY — surfaces trips the
 * coordinator should manually review. Metered once per check via the
 * `assistant_data_check` feature. Runs SQL against this company only.
 */
export type AssistantDataCheck = {
  kind: "data_check";
  items: Array<{
    job_id: string;
    label: string;
    issue_type: "duplicate" | "missing_field" | "stale_pending";
    detail: string;
  }>;
  summary: string;
};

export type AssistantResult =
  | AssistantAnswer
  | AssistantDraft
  | AssistantBatch
  | AssistantDataFix
  | AssistantPartnerSuggest
  | AssistantCommandActions
  | AssistantMergeTrips
  | AssistantAutoCoordinate
  | AssistantSettingChange
  | AssistantDataCheck;

/** Human labels for the six ai_configuration toggles the assistant can flip. */
const AI_CONFIG_TOGGLE_LABELS: Record<AssistantSettingChange["key"], string> = {
  auto_assign_enabled: "Auto-assign driver",
  auto_extract_bulk: "AI bulk-paste extraction",
  auto_reply_drafts: "AI reply drafter",
  ai_command_enabled: "AI command bar",
  voice_to_trip_enabled: "Voice-note → trip",
  auto_coordinate_enabled: "AI Auto-Coordinate",
};


/**
 * Detect silent passenger-parsing failures so the UI can warn the coordinator
 * before they confirm a trip with an empty/mismatched passenger list.
 *
 * Codes:
 *  - no_pax_extracted : user message mentions passengers but nothing was parsed
 *  - count_mismatch   : message says "N pax" (or similar) but parsed count differs
 *  - single_blob      : one entry likely still contains multiple unsplit names
 */
export function computePaxWarnings(
  userMessage: string,
  rawFields: Record<string, unknown>,
  pax: string[] | null,
): string[] {
  const warnings: string[] = [];
  const msg = (userMessage ?? "").toLowerCase();
  const mentionsPax =
    /\bpax\b|\bpassenger|\bguest|\bcrew\b|\bjoiner|\bsign[- ]?off|\bnames?\s*[:：]/i.test(msg);
  const count = pax?.length ?? 0;
  if (mentionsPax && count === 0) {
    warnings.push("no_pax_extracted: No passenger names were detected — the driver will see an empty list.");
  }
  // Compare against explicit numeric hints in the message or a pax_count field.
  const numMatch = msg.match(/\b(\d{1,3})\s*(pax|passengers?|persons?|adults?|guests?|crew)\b/i);
  const stated = numMatch ? Number(numMatch[1]) : (typeof (rawFields as { pax_count?: unknown }).pax_count === "number"
    ? (rawFields as { pax_count: number }).pax_count
    : null);
  if (stated != null && Number.isFinite(stated) && stated > 0 && count !== stated) {
    warnings.push(`count_mismatch: Expected ${stated} passenger${stated === 1 ? "" : "s"}, parsed ${count}.`);
  }
  if (count === 1 && pax && (pax[0].length > 60 || (pax[0].match(/[,;&]|\band\b/gi)?.length ?? 0) >= 2)) {
    warnings.push("single_blob: Passenger entry may contain multiple unsplit names — please review.");
  }
  return warnings;
}







export const askCoordinatorAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ data, context }): Promise<AssistantResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured on this workspace.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve company (mirror resolveCompany from coordinator.functions.ts).
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id, name")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (!company) throw new Error("No company assigned to this account.");

    // Feature gate.
    const { data: ent } = await supabaseAdmin
      .from("company_feature_entitlements")
      .select("enabled, expires_at")
      .eq("company_id", company.id)
      .eq("feature", "ai_coordinator_assist")
      .maybeSingle();
    if (ent) {
      const expired = ent.expires_at ? new Date(ent.expires_at).getTime() <= Date.now() : false;
      if (!ent.enabled || expired) {
        throw new Error("The AI coordinator assistant is disabled by your administrator.");
      }
    }

    // Per-action pricing (see ai_feature_costs rows: assistant_qa,
    // assistant_trip_action, assistant_data_fix). We meter Q&A turns here
    // once we know the response was an answer. Trip actions and data fixes
    // are metered separately on Confirm via `meterAssistantConfirm` — one
    // charge per confirmed trip, so a 3-trip batch = 3× assistant_trip_action.
    // All soft-metered (block_on_empty=false).
    const meter = async (featureKey: "assistant_qa", note: string) => {
      try {
        await supabaseAdmin.rpc("spend_points", {
          _company_id: company.id,
          _feature_key: featureKey,
          _job_id: undefined as unknown as string,
          _note: note,
          _cost_override: undefined as unknown as number,
        });
      } catch {
        // never break the primary action on metering hiccups
      }
    };

    // Load minimal roster for name→id mapping.
    const { data: driverRows } = await supabaseAdmin
      .from("drivers")
      .select("id, name")
      .eq("company_id", company.id)
      .limit(80);
    const drivers = (driverRows ?? []) as { id: string; name: string | null }[];

    // Per-company glossary (term → meaning). CANONICAL SOURCE: `ai_lessons`
    // with kind='glossary' — the same shared lessons store the AI Learning
    // page manages. Company-scoped rows always visible; approved global
    // glossary terms are surfaced only if the coordinator has opted in via
    // `ai_lesson_share_settings.consume_global`.
    const { data: shareRow } = await supabaseAdmin
      .from("ai_lesson_share_settings")
      .select("consume_global")
      .eq("company_id", company.id)
      .maybeSingle();
    const consumeGlobal = shareRow?.consume_global ?? true;
    const glossaryQuery = supabaseAdmin
      .from("ai_lessons")
      .select("id, title, rule_text, company_id, scope, status")
      .eq("kind", "glossary")
      .eq("status", "approved")
      .order("title", { ascending: true })
      .limit(200);
    const { data: glossRows } = consumeGlobal
      ? await glossaryQuery.or(`company_id.eq.${company.id},scope.eq.global`)
      : await glossaryQuery.eq("company_id", company.id);
    const glossary = ((glossRows ?? []) as Array<{ id: string; title: string; rule_text: string; company_id: string | null; scope: string }>).map(
      (g) => ({ id: g.id, term: g.title, meaning: g.rule_text, owned: g.company_id === company.id }),
    );

    // Coordinator-authored business rules from the AI Center → Rules tab.
    // These are HARD company rules and should be applied before soft biases.
    const { data: ruleRows } = await supabaseAdmin
      .from("company_ai_rules")
      .select("title, rule_text")
      .eq("company_id", company.id)
      .eq("enabled", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(50);
    const rules = (ruleRows ?? []) as { title: string; rule_text: string }[];

    // ---- Current AI toggles + feature entitlements (for setting_change / cost advisor) ----
    const [{ data: cfgRow }, { data: entRows }] = await Promise.all([
      supabaseAdmin.from("ai_configuration").select("*").eq("company_id", company.id).maybeSingle(),
      supabaseAdmin
        .from("company_feature_entitlements")
        .select("feature, enabled, expires_at")
        .eq("company_id", company.id),
    ]);
    const aiConfig = {
      auto_assign_enabled: cfgRow?.auto_assign_enabled ?? false,
      auto_extract_bulk: cfgRow?.auto_extract_bulk ?? true,
      auto_reply_drafts: cfgRow?.auto_reply_drafts ?? true,
      ai_command_enabled: cfgRow?.ai_command_enabled ?? true,
      voice_to_trip_enabled: cfgRow?.voice_to_trip_enabled ?? true,
      auto_coordinate_enabled: cfgRow?.auto_coordinate_enabled ?? false,
    };
    const aiConfigBlock = (Object.keys(aiConfig) as (keyof typeof aiConfig)[])
      .map((k) => `- ${k} (${AI_CONFIG_TOGGLE_LABELS[k]}): ${aiConfig[k] ? "ON" : "OFF"}`)
      .join("\n");
    const entitlements = (entRows ?? []) as { feature: string; enabled: boolean; expires_at: string | null }[];
    const entitlementsBlock = entitlements.length
      ? entitlements
          .map((e) => `- ${e.feature}: ${e.enabled && (!e.expires_at || new Date(e.expires_at).getTime() > Date.now()) ? "ON" : "OFF"} [admin-controlled]`)
          .join("\n")
      : "(none configured — all defaults)";


    // Silent-learning bias summary (see AI Learning page).
    const { data: biasRows } = await supabaseAdmin
      .from("ai_lessons")
      .select("title, rule_text")
      .eq("kind", "suggestion_rule")
      .eq("status", "approved")
      .eq("company_id", company.id)
      .order("updated_at", { ascending: false })
      .limit(20);
    const biases = (biasRows ?? []) as { title: string; rule_text: string }[];

    // ---- Relevance pre-filter (cost optimisation) ----
    // Only inject glossary/rules/biases whose keywords plausibly match this
    // turn. Falls back to a small top-N when nothing scores, so brand-new
    // coordinators still get some context.
    const msgLower = data.message.toLowerCase();
    const historyLower = (data.history ?? []).slice(-4).map((m) => (m.text ?? "").toLowerCase()).join(" ");
    const haystack = `${msgLower}\n${historyLower}`;
    const tokenize = (s: string): string[] => Array.from(new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []));
    const msgTokens = new Set(tokenize(haystack));
    const scoreText = (t: string): number => {
      let score = 0;
      for (const w of tokenize(t)) if (msgTokens.has(w)) score += 1;
      return score;
    };
    const pickTop = <T,>(items: T[], score: (x: T) => number, cap: number, fallback: number): T[] => {
      const hits = items.map((x) => ({ x, s: score(x) })).filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s).slice(0, cap).map((r) => r.x);
      return hits.length > 0 ? hits : items.slice(0, fallback);
    };
    const glossaryPick = pickTop(glossary, (g) => scoreText(g.term) * 2 + scoreText(g.meaning), 15, Math.min(6, glossary.length));
    const rulesPick = pickTop(rules, (r) => scoreText(r.title) * 2 + scoreText(r.rule_text), 10, Math.min(6, rules.length));
    const biasesPick = pickTop(biases, (r) => scoreText(r.title) + scoreText(r.rule_text), 8, Math.min(4, biases.length));

    const glossaryBlock = glossaryPick.length
      ? glossaryPick.map((g) => `- ${g.term} = ${g.meaning}${g.owned ? "" : "  [shared]"}`).join("\n")
      : "(empty — nothing taught yet)";
    const rulesBlock = rulesPick.length
      ? rulesPick.map((r, i) => `${i + 1}. ${r.title}: ${r.rule_text}`).join("\n")
      : "(no custom rules configured)";
    const learnedBlock = biasesPick.length
      ? biasesPick.map((r) => `• ${r.rule_text}`).join("\n")
      : "(no learned preferences yet)";



    // Active Collaborate partners (same source the Collaborate UI reads via
    // listConnections). We only surface {company_id, company_name} to the
    // model — the exact information the coordinator already sees when
    // dispatching a trip manually. No cross-company internal data.
    const { data: connRows } = await supabaseAdmin
      .from("coordinator_connections")
      .select("owner_company_id, partner_company_id, status")
      .or(`owner_company_id.eq.${company.id},partner_company_id.eq.${company.id}`)
      .eq("status", "active");
    const partnerIds = Array.from(
      new Set(
        (connRows ?? [])
          .map((r: any) => (r.owner_company_id === company.id ? r.partner_company_id : r.owner_company_id))
          .filter((id: string) => id && id !== company.id),
      ),
    );
    let partners: { id: string; name: string }[] = [];
    if (partnerIds.length > 0) {
      const { data: partnerRows } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .in("id", partnerIds);
      partners = (partnerRows ?? []).map((p: any) => ({ id: p.id, name: p.name ?? "Unknown" }));
    }
    const partnersBlock = partners.length
      ? partners.map((p) => `${p.id} — ${p.name}`).join("\n")
      : "(no active Collaborate partners)";

    // Upcoming trips this company is currently the executor for. Used so the
    // assistant can point at real trip IDs when the coordinator asks to hand
    // work off (e.g. "close for the day, cover these"). Scoped to next 48h
    // and to trips NOT already dispatched out to a partner.
    const nowIso = new Date().toISOString();
    const soonIso = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const { data: upcomingRows } = await supabaseAdmin
      .from("jobs")
      .select("id, trip_no, date, time, from_location, to_location, driver_id, dispatch_status, pickup_at, clientcompanyname")
      .eq("executor_company_id", company.id)
      .not("status", "in", "(completed,cancelled)")
      .gte("pickup_at", nowIso)
      .lte("pickup_at", soonIso)
      .order("pickup_at", { ascending: true })
      .limit(15);
    const upcoming = (upcomingRows ?? []) as any[];
    const upcomingBlock = upcoming.length
      ? upcoming
          .map((r) => `#${r.trip_no ?? "?"} · ${r.id} — ${r.date ?? ""} ${(r.time ?? "").slice(0, 5)} · ${r.from_location ?? "?"} → ${r.to_location ?? "?"}${r.driver_id ? " · (driver assigned)" : " · (no driver)"}${r.dispatch_status === "pending" ? " · (already sent to partner)" : ""}`)
          .join("\n")
      : "(none in the next 48h)";

    // Serial-number resolver: parse the coordinator's message for references
    // like "#123", "card 45", "trip 7" and look up the matching trips in this
    // company. Surface them to the model so a bare number reliably resolves
    // to the right trip even when it isn't in the 48h window.
    const serialMatches = Array.from(
      new Set(
        (data.message.match(/(?:#|\bcard\s*#?|\btrip\s*#?)\s*(\d{1,7})/gi) ?? [])
          .map((m) => Number((m.match(/(\d{1,7})/) ?? [])[1]))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ).slice(0, 10);
    let referencedBlock = "(none)";
    if (serialMatches.length) {
      const { data: refRows } = await supabaseAdmin
        .from("jobs")
        .select("id, trip_no, date, time, from_location, to_location, driver_id, status, clientcompanyname")
        .eq("company_id", company.id)
        .in("trip_no", serialMatches);
      if (refRows && refRows.length) {
        referencedBlock = refRows
          .map((r: any) => `#${r.trip_no} · ${r.id} — ${r.date ?? ""} ${(r.time ?? "").slice(0, 5)} · ${r.from_location ?? "?"} → ${r.to_location ?? "?"} · status:${r.status}${r.driver_id ? " · (driver assigned)" : ""}`)
          .join("\n");
      }
    }

    // Client notes (per-company coordinator memory keyed by normalized client name).
    // Injected into the prompt so the assistant can mention them in summaries.
    const { data: noteRows } = await supabaseAdmin
      .from("client_notes")
      .select("client_display, note")
      .eq("company_id", company.id)
      .limit(200);
    const clientNotes = (noteRows ?? []) as Array<{ client_display: string; note: string }>;
    const clientNotesBlock = clientNotes.length
      ? clientNotes.map((n) => `- ${n.client_display}: ${n.note.slice(0, 200)}`).join("\n")
      : "(no client notes saved)";


    const today = new Date().toISOString().slice(0, 10);
    const trip = data.screen?.trip ?? null;

    // Character-overage billing. Anything past the free threshold is billed
    // via `ai_char_overage`; if the wallet is empty the input is truncated
    // (oldest history first, then message tail) so the call still succeeds.
    const { chargeCharOverage } = await import("@/lib/ai-overage.functions");
    const historyForBilling = (data.history ?? []).slice(-8);
    const billed = await chargeCharOverage(
      company.id,
      data.message,
      historyForBilling,
      "AI assistant characters",
    );
    const effectiveMessage = billed.message;
    const effectiveHistory = billed.history;
    const overageNotice = billed.truncated
      ? `\n\n[Notice: your message was shortened to the free limit of ${billed.settings.free_char_threshold} characters because your points balance is empty. Top up to send longer prompts.]`
      : "";

    const historyLines = effectiveHistory
      .map((m) => `${(m.role ?? "user").toUpperCase()}: ${m.text}`)
      .join("\n");

    // Cost optimisation: only pay to load and inject the folded Guide
    // knowledge and billing snapshot when this turn actually looks like a
    // how-to / billing question. Trip create/edit turns don't need either.
    const helpIntent = /\b(how|what|why|where|when|help|guide|explain|troubleshoot|meaning|means|show me|walk me)\b|\?/.test(msgLower);
    const billingIntent = /\b(point|points|credit|credits|balance|charge|charged|cost|costs|costing|price|pricing|bill|billing|top[- ]?up|topup|invoice|payment|spend|spending|reduce|save|cheaper|expensive)\b/.test(msgLower);
    const costAdvisorIntent = /\b(reduce|save|cheaper|cut|lower|too much|what am i paying|unused|not using)\b/.test(msgLower) && billingIntent;
    const dataCheckIntent = /\b(mistake|mistakes|duplicate|duplicates|dupes|dup|check.*(trip|today|tomorrow|data)|scan.*(trip|today)|forgotten|missing|any issues|anything wrong)\b/.test(msgLower);

    let guideKnowledge = "";
    if (helpIntent) {
      try {
        const { buildSystemPrompt } = await import("@/lib/help-ai.server");
        guideKnowledge = buildSystemPrompt({ mode: "coach" });
      } catch {
        /* non-fatal */
      }
    }

    let billingBlock = "";
    if (billingIntent) {
      const monthAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const [{ data: balRow }, { data: recentLedger }, { data: featureCostRows }, { data: usage30 }] = await Promise.all([
        supabaseAdmin.from("companies").select("points_balance").eq("id", company.id).maybeSingle(),
        supabaseAdmin.from("points_ledger").select("points_deducted, note, feature_key, created_at").eq("company_id", company.id).order("created_at", { ascending: false }).limit(10),
        supabaseAdmin.from("ai_feature_costs").select("feature_key, label, points_cost, enabled, block_on_empty").order("feature_key"),
        supabaseAdmin.from("points_ledger").select("feature_key, points_deducted").eq("company_id", company.id).gte("created_at", monthAgoIso),
      ]);
      const pointsBalance = Number(balRow?.points_balance ?? 0);
      const ledgerBlock = (recentLedger ?? []).length
        ? (recentLedger ?? []).map((l: { points_deducted: number | string; note: string | null; feature_key: string | null; created_at: string }) => `${l.created_at.slice(0, 16).replace("T", " ")}  -${l.points_deducted}  ${l.feature_key ?? "-"}  ${l.note ?? ""}`).join("\n")
        : "(no ledger entries yet)";
      const featureCostBlock = (featureCostRows ?? []).length
        ? (featureCostRows ?? []).map((c: { feature_key: string; label: string | null; points_cost: number | string; enabled: boolean; block_on_empty: boolean }) => `- ${c.feature_key} (${c.label ?? c.feature_key}): ${c.points_cost} pts${c.enabled ? "" : " [disabled]"}${c.block_on_empty ? " [hard block when empty]" : ""}`).join("\n")
        : "(no priced features)";
      // 30-day rollup grouped by feature_key (Postgres does the totals for us via JS reduce, still cheap).
      const rollup = new Map<string, { count: number; total: number }>();
      for (const r of (usage30 ?? []) as { feature_key: string | null; points_deducted: number | string }[]) {
        const k = r.feature_key ?? "-";
        const cur = rollup.get(k) ?? { count: 0, total: 0 };
        cur.count += 1;
        cur.total += Number(r.points_deducted ?? 0);
        rollup.set(k, cur);
      }
      const usageBlock = rollup.size
        ? Array.from(rollup.entries()).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => `- ${k}: ${v.count} uses · ${v.total.toFixed(2)} pts`).join("\n")
        : "(no spend in the last 30 days)";
      // Enabled surfaces the coordinator might toggle off. Combines ai_configuration + entitlements.
      const enabledCandidates: string[] = [];
      for (const k of Object.keys(aiConfig) as (keyof typeof aiConfig)[]) {
        if (aiConfig[k]) enabledCandidates.push(`${k} (${AI_CONFIG_TOGGLE_LABELS[k]})`);
      }
      for (const e of entitlements) {
        if (e.enabled) enabledCandidates.push(`${e.feature} [admin-controlled]`);
      }
      const enabledBlock = enabledCandidates.length ? enabledCandidates.map((s) => `- ${s}`).join("\n") : "(nothing extra enabled)";
      billingBlock = `\n===================== BILLING CONTEXT (for kind:"answer" on billing / cost / cost-reduction questions) =====================\nCurrent points balance: ${pointsBalance}\n\nFeature price list (points per action):\n${featureCostBlock}\n\nMost recent point-spend entries (newest first):\n${ledgerBlock}\n\nSPEND — LAST 30 DAYS (grouped by feature_key, highest total first):\n${usageBlock}\n\nCURRENTLY ENABLED surfaces the coordinator could toggle off:\n${enabledBlock}\n\nWhen answering cost-reduction questions: cross-reference ENABLED surfaces with SPEND. Flag any enabled AI toggle with ZERO or very low 30-day spend as a candidate to turn off (route via kind:"setting_change" for owner-controllable ai_configuration keys; for admin-controlled entitlements, tell the coordinator to ask their admin). Use ONLY the real numbers above — never estimate.\n`;
    }


    const system = `You are the built-in AI dispatch assistant for The Coordinator, a transport-dispatch platform in Malta. You have ALSO absorbed the responsibilities of the retired "Ask the Guide" in-app coach — when the coordinator asks a how-to / troubleshooting / product question, answer it in kind:"answer" using the coach guidance and live facts below.

You do these things:
1) ANSWER on-topic questions using the folded Guide knowledge at the bottom of this prompt.
2) When the coordinator asks to CREATE or EDIT a SINGLE trip, return a DRAFT.
3) MULTIPLE NEW trips → BATCH of create drafts.
4) EDIT MULTIPLE EXISTING trips by shared reference → SEARCH_UPDATE.
5) Small typo on a single record → DATA_FIX.
6) GLOSSARY MANAGEMENT (kind:"glossary_save" / "glossary_list" / "glossary_delete"). Glossary entries live in the shared AI Lessons store so the coordinator can also see and edit them from AI Learning.
7) SUGGEST PARTNER HAND-OFF → kind:"partner_suggest" (see below).
8) STRUCTURED ACTIONS on existing trips — group / ungroup / send a message to the driver or client on a trip. Return kind:"command_actions" with an array. This is the same execution layer as the old Command Bar, so the writes are trusted and audited. Use this when the coordinator says things like "group these two trips", "ungroup that trip", "message the driver that pickup is delayed 10 minutes", "tell the client we're 5 min away". Do NOT use command_actions for creating/updating trip content — those still go through draft / batch / search_update / data_fix.
9) COORDINATE THE BACKLOG — when the coordinator says things like "coordinate my backlog", "review unassigned trips", "auto-coordinate", "sort out today", return kind:"auto_coordinate" with a one-line intro. The client then runs the existing AI Auto-Coordinate engine and presents its proposals for per-item approval.
10) BILLING Q&A + COST-REDUCTION ADVICE — when the coordinator asks about points balance, a specific charge, feature price, or how to reduce cost / what they're paying for, ANSWER in kind:"answer" using the BILLING CONTEXT block below. Quote real numbers only. For cost reduction, cross-reference ENABLED surfaces with 30-day SPEND and name enabled toggles with zero use as candidates to turn off. If the coordinator then says "turn off X", return kind:"setting_change" for the matching ai_configuration key. For admin-controlled entitlements, tell them to ask their admin.
11) MERGE DUPLICATE TRIPS — when the coordinator says "merge these trips", "merge duplicates", or asks to combine duplicate cards, return kind:"merge_trips". Pick the best complete trip as keep_job_id and put the duplicates in drop_job_ids. Only use trip UUIDs from UPCOMING TRIPS, TRIPS REFERENCED BY SERIAL NUMBER, or the currently open trip.
12) SETTING TOGGLE — when the coordinator asks to turn a feature/automation on or off (e.g. "stop tracking flights so I don't get charged", "turn on auto-assign", "disable voice input"), fuzzy-match against CURRENT AI TOGGLES below. If it maps to an ai_configuration key, return kind:"setting_change". If the match falls under CURRENT FEATURE ENTITLEMENTS (admin-controlled), return kind:"answer" telling the coordinator that entitlement is admin-controlled and to ask their admin. If it doesn't clearly map to anything, return kind:"answer" listing 2–3 nearest ai_configuration toggles the coordinator could mean.
13) DATA CHECK — when the coordinator explicitly asks something like "check for mistakes", "any duplicates today", "scan my trips", return kind:"data_check". The server runs the real duplicate / missing-field / stale-pending scan itself — you only trigger.


Rules:
- Return STRICT JSON only. No markdown. One of:
  { "kind": "answer", "text": "..." }
  { "kind": "draft", "action": "create" | "update", "target_trip_id": "<uuid or null>",
    "fields": { "from_location"?, "to_location"?, "date"? (yyyy-mm-dd), "time"? (HH:mm 24h Malta local),
                "driver_id"? (uuid from roster below or null), "driver_name"?,
                "vehicle"?, "contact_phone"?, "from_flight"?, "to_flight"?, "clientcompanyname"?,
                "pax"? (array of passenger / crew names for this trip, e.g. ["M. Harris – Master", "J. Cooper – C/O"]) },
    "summary": "one short sentence" }
  { "kind": "batch",
    "drafts": [ { "kind":"draft", "action":"create", "target_trip_id": null, "fields": {...}, "summary": "..." }, ... ],
    "clarify": "one short question covering all missing/ambiguous bits across the trips, or null" }
  { "kind": "search_update",
    "criteria": "short human phrase describing which trips to match, e.g. 'Asso 25 trips today'",
    "criteria_terms": ["asso 25"],
    "date": "yyyy-mm-dd" | null,
    "changes": { same field keys as "fields" above — ONLY the fields to change on every matched trip },
    "summary": "..." }
  { "kind": "data_fix",
    "target": "trip" | "driver",
    "target_id": "<uuid>",
    "field": "<one of: from_location | to_location | contact_phone | clientcompanyname | from_flight | to_flight | vehicle   (trip);   name | phone   (driver)>",
    "new_value": "<corrected value>",
    "summary": "..." }
  { "kind": "glossary_save", "term": "<shorthand>", "meaning": "<full meaning>" }
  { "kind": "glossary_list" }
  { "kind": "glossary_delete", "term": "<shorthand>" }
  { "kind": "setting_change", "target": "ai_configuration", "key": "<one of: auto_assign_enabled | auto_extract_bulk | auto_reply_drafts | ai_command_enabled | voice_to_trip_enabled | auto_coordinate_enabled>", "new_value": true|false, "summary": "one short sentence explaining what will change" }
  { "kind": "data_check" }

  { "kind": "answer", "text": "..." }
  { "kind": "draft", "action": "create" | "update", "target_trip_id": "<uuid or null>",
    "fields": { "from_location"?, "to_location"?, "date"? (yyyy-mm-dd), "time"? (HH:mm 24h Malta local),
                "driver_id"? (uuid from roster below or null), "driver_name"?,
                "vehicle"?, "contact_phone"?, "from_flight"?, "to_flight"?, "clientcompanyname"?,
                "pax"? (array of passenger / crew names for this trip, e.g. ["M. Harris – Master", "J. Cooper – C/O"]) },
    "summary": "one short sentence" }
  { "kind": "batch",
    "drafts": [ { "kind":"draft", "action":"create", "target_trip_id": null, "fields": {...}, "summary": "..." }, ... ],
    "clarify": "one short question covering all missing/ambiguous bits across the trips, or null" }
  { "kind": "search_update",
    "criteria": "short human phrase describing which trips to match, e.g. 'Asso 25 trips today'",
    "criteria_terms": ["asso 25"],
    "date": "yyyy-mm-dd" | null,
    "changes": { same field keys as "fields" above — ONLY the fields to change on every matched trip },
    "summary": "..." }
  { "kind": "data_fix",
    "target": "trip" | "driver",
    "target_id": "<uuid>",
    "field": "<one of: from_location | to_location | contact_phone | clientcompanyname | from_flight | to_flight | vehicle   (trip);   name | phone   (driver)>",
    "new_value": "<corrected value>",
    "summary": "..." }
  { "kind": "glossary_save", "term": "<shorthand>", "meaning": "<full meaning>" }
  { "kind": "glossary_list" }
  { "kind": "glossary_delete", "term": "<shorthand>" }
  { "kind": "partner_suggest",
    "items": [ { "job_id": "<uuid from UPCOMING TRIPS>", "partner_company_id": "<uuid from ACTIVE PARTNERS>", "reason": "one short line, or null" } ],
    "summary": "..." }
  { "kind": "command_actions",
    "actions": [
      { "type": "group",   "job_ids": ["<uuid>","<uuid>", ...], "group_name": "<optional name>" },
      { "type": "ungroup", "job_id": "<uuid>" },
      { "type": "message", "job_id": "<uuid>", "thread": "driver" | "client" | "group", "body": "<short message>" }
    ],
    "summary": "..." }
  { "kind": "merge_trips", "keep_job_id": "<uuid>", "drop_job_ids": ["<uuid>", ...], "summary": "..." }
  { "kind": "auto_coordinate", "intro": "<one short sentence>", "directive": "<verbatim rewrite of the coordinator's instruction, e.g. 'assign all unassigned trips to driver Mark Evans' or 'dispatch all unassigned trips to partner Baygors Cab Ltd', or null>", "target_name": "<the driver or partner company name the coordinator named, or null>" }
- For "update" or "search_update", only include fields that CHANGE.
- For "create" (single or batched), omit target_trip_id (null).
- Batch of creates: each element MUST be action:"create".
- Times are Malta local, 24h.
- For a multi-trip CREATE batch, if any trip is missing pickup time / passenger count / exact pickup or drop-off / ambiguous driver, STILL include it and put ONE targeted question in "clarify".
- Use "batch" only when 2+ new trips.
- Use "search_update" for ANY multi-existing-trip edit by a shared reference.
- Use "data_fix" ONLY for spelling/phone/flight-code fixes.
- PASSENGER EXTRACTION: When the message lists people (crew changes, joiners, sign-offs, guest lists, "PAX:", numbered lines with names), put every name into the trip's "pax" array. Preserve rank/role suffixes if given ("M. Harris – Master"). Skip generic role words like "Driver", "Coordinator", "Inspector" only when they clearly refer to staff, not passengers.
- ONE TRIP PER FLIGHT+DIRECTION+DATE: Group people who share the SAME flight number, SAME date, and SAME route (e.g. all 3 joiners on KM103 LHR/MLA on 20 Jul → airport→hotel/vessel) into ONE draft with all their names in "pax". Do NOT create one draft per person. Different flights or different dates → separate drafts. Hotel transfers, vessel attendance, and sign-offs are their own drafts.
- CLIENT NAME: Use the sender / agency / vessel name as clientcompanyname (e.g. "Ship Agency Malta Ltd." or "MV Ocean Pioneer"). If a saved client note exists (see CLIENT NOTES below), mention it briefly in the trip summary.
- If a request is genuinely too vague, kind:"answer" with ONE short clarifying question.
- Structured actions: prefer command_actions for grouping and messages. Use merge_trips only for true duplicate/merge requests. Only include job_ids/job_id values that appear in UPCOMING TRIPS, TRIPS REFERENCED BY SERIAL NUMBER, or the currently open trip. Keep messages short and professional; the coordinator sees each one before it is sent.
- Auto-coordinate: return kind:"auto_coordinate" only when the coordinator clearly asks to sweep the backlog. Do not combine with any other kind. If the coordinator names a SPECIFIC driver or partner company as the destination (e.g. "send all unassigned trips to Baygorscab", "assign the whole backlog to Mark"), you MUST fill "directive" with a clear verbatim rewrite of the instruction AND "target_name" with the driver or partner name they used. Otherwise set both to null.
- GLOSSARY EXPANSION: BEFORE producing any other kind, silently expand any glossary term found in the coordinator's message using COMPANY GLOSSARY below (case-insensitive).
- GLOSSARY SAVE: use kind:"glossary_save" ONLY when the message is clearly a teaching statement about a term → meaning. Do NOT combine with any other action in the same turn.
- SERIAL NUMBER RESOLUTION: The coordinator may refer to any trip by its per-company serial number ("#123", "card 45", "trip 7"). ALWAYS resolve these against TRIPS REFERENCED BY SERIAL NUMBER first, then UPCOMING TRIPS. Use the UUID (not the "#N" string) as job_id / target_trip_id. If a referenced serial does not appear in either list, ask a short clarifying question instead of guessing.
- Answers are plain text (no markdown).

Today's date (Malta): ${today}
Company: ${company.name}

COMPANY BUSINESS RULES (HARD rules — apply to every proposal you make):
${rulesBlock}

COMPANY GLOSSARY (per-company shorthand — apply these to the user's message BEFORE deciding the action):
${glossaryBlock}

LEARNED PREFERENCES for this coordinator (SOFT BIASES, NOT RULES). Gentle nudges only. NEVER apply silently and NEVER skip draft/confirm because of them:
${learnedBlock}

Driver roster (id — name), pick by fuzzy name match when the user names a driver:
${drivers.map((d) => `${d.id} — ${d.name ?? "(no name)"}`).join("\n") || "(no drivers yet)"}

ACTIVE PARTNERS in your Collaborate network (id — name). ONLY companies you can suggest handing trips to.
${partnersBlock}

UPCOMING TRIPS your company is currently the executor for (next 48h). Each line starts with the per-company SERIAL NUMBER (e.g. #123), followed by the UUID:
${upcomingBlock}

TRIPS REFERENCED BY SERIAL NUMBER in the current message (resolve any bare "#N" / "card N" / "trip N" to these UUIDs before choosing an action):
${referencedBlock}

CLIENT NOTES (per-client coordinator memory — mention briefly in trip summaries when relevant):
${clientNotesBlock}

CURRENT AI TOGGLES (owner-controllable via kind:"setting_change"):
${aiConfigBlock}

CURRENT FEATURE ENTITLEMENTS (admin-controlled — do NOT return setting_change for these; respond with an answer explaining they must ask their admin):
${entitlementsBlock}

Current screen: ${data.screen?.path ?? "(unknown)"}
Currently open trip: ${trip ? JSON.stringify(trip) : "(none)"}

Recent conversation:
${historyLines || "(none)"}
${billingBlock}${guideKnowledge ? `\n===================== FOLDED GUIDE KNOWLEDGE (for kind:"answer") =====================\n${guideKnowledge}\n` : ""}`;





    const assistStart = Date.now();
    const assistModel = "google/gemini-3.5-flash";
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "raw-fetch",
      },
      body: JSON.stringify({
        model: assistModel,
        response_format: { type: "json_object" },
        // Trip extraction can return several draft cards with passenger lists.
        // 1200 tokens was too small for real crew-change emails and caused the
        // model response to be cut mid-JSON, which then surfaced raw JSON in the
        // chat instead of proposal cards.
        max_tokens: 5000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: effectiveMessage },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const status = res.status === 429 ? "rate_limited" : res.status === 402 ? "no_credits" : "error";
      try {
        const { recordAiCost } = await import("./ai-cost.server");
        await recordAiCost({
          feature_key: "assistant_qa",
          model: assistModel,
          company_id: company.id,
          actor_user_id: context.userId,
          surface: "coordinator_assistant",
          duration_ms: Date.now() - assistStart,
          status,
          aig_run_id: res.headers.get("X-Lovable-AIG-Run-ID") ?? undefined,
          aig_log_id: res.headers.get("X-Lovable-AIG-Log-ID") ?? undefined,
        });
      } catch { /* noop */ }
      if (res.status === 429) throw new Error("AI rate limit hit — try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted — top up to continue.");
      throw new Error(`AI error (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      const { recordAiCost } = await import("./ai-cost.server");
      await recordAiCost({
        feature_key: "assistant_qa",
        model: assistModel,
        usage: {
          input_tokens: json.usage?.prompt_tokens ?? 0,
          output_tokens: json.usage?.completion_tokens ?? 0,
        },
        company_id: company.id,
        actor_user_id: context.userId,
        surface: "coordinator_assistant",
        duration_ms: Date.now() - assistStart,
        aig_run_id: res.headers.get("X-Lovable-AIG-Run-ID") ?? undefined,
        aig_log_id: res.headers.get("X-Lovable-AIG-Log-ID") ?? undefined,
      });
    } catch { /* noop */ }
    const content = json.choices?.[0]?.message?.content ?? "";
    const finishReason = json.choices?.[0]?.finish_reason ?? null;
    const answer = async (text: string): Promise<AssistantAnswer> => {
      await meter("assistant_qa", "assistant Q&A turn");
      return { kind: "answer", text: text + overageNotice };
    };

    let parsed: unknown;
    // Some model turns wrap JSON in ```json fences, prefix it with the
    // user's pasted text, or append trailing prose. Strip fences first,
    // then fall back to extracting balanced {...} blocks before giving up.
    const extractJson = (raw: string): unknown | null => {
      const s = raw.trim();
      if (!s) return null;
      const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidates: string[] = [];
      if (fenced?.[1]) candidates.push(fenced[1].trim());
      candidates.push(s);
      // Sliced by outermost braces.
      const first = s.indexOf("{");
      const last = s.lastIndexOf("}");
      if (first >= 0 && last > first) candidates.push(s.slice(first, last + 1));
      // Balanced-object scan that ignores braces inside JSON strings. This
      // recovers when the model adds prose before/after a valid JSON object.
      let depth = 0;
      let start = -1;
      let inString = false;
      let escaped = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === "{") {
          if (depth === 0) start = i;
          depth += 1;
        } else if (ch === "}" && depth > 0) {
          depth -= 1;
          if (depth === 0 && start >= 0) candidates.push(s.slice(start, i + 1));
        }
      }
      for (const c of candidates) {
        try { return JSON.parse(c); } catch { /* keep trying */ }
      }
      return null;
    };
    const extracted = extractJson(content);
    const aigRunId = res.headers.get("X-Lovable-AIG-Run-ID");
    const aigLogId = res.headers.get("X-Lovable-AIG-Log-ID");
    try {
      const { logRawAiResponse } = await import("./ai-raw-log.server");
      await logRawAiResponse({
        feature_key: "assistant_qa",
        surface: "coordinator_assistant",
        model: assistModel,
        aig_run_id: aigRunId,
        aig_log_id: aigLogId,
        finish_reason: finishReason,
        parse_ok: extracted !== null,
        parse_error: extracted === null ? "extractJson returned null" : null,
        raw_content: content,
        company_id: company.id,
        actor_user_id: context.userId,
        meta: { message_length: data.message?.length ?? 0 },
      });
    } catch { /* noop */ }
    if (extracted === null) {
      if (finishReason === "length" || /^\s*[{[]/.test(content)) {
        return answer("I started extracting the trips, but the structured result was incomplete. Please send the same message again and I'll return it as trip cards, not raw JSON.");
      }
      return answer(content || "Sorry, I couldn't parse that.");
    }
    parsed = extracted;
    const p = parsed as Record<string, unknown>;
    const toDraft = (raw: unknown, forceCreate = false): AssistantDraft => {
      const d = (raw ?? {}) as Record<string, unknown>;
      const rawFields = (d.fields ?? {}) as Record<string, unknown>;
      const rawPax =
        rawFields.pax ??
        rawFields.passengers ??
        rawFields.passenger_names ??
        rawFields.names ??
        d.pax ??
        d.passengers ??
        d.passenger_names ??
        d.names;
      let pax: string[] | null = null;
      if (Array.isArray(rawPax) || typeof rawPax === "string") {
        const rawNames = Array.isArray(rawPax)
          ? rawPax
          : rawPax.split(/\r?\n|;|\s+[&+]\s+|,(?=\s*[A-ZÀ-ÖØ-Þ])/).map((name) => name.replace(/^[-•\d.)\s]+/, ""));
        pax = rawNames
          .map((n) => {
            if (typeof n === "string") return n.trim();
            if (n && typeof n === "object" && "name" in n) return String((n as { name?: unknown }).name ?? "").trim();
            return "";
          })
          .filter((n) => n.length > 0 && n.length <= 200)
          .slice(0, 200);
        if (pax.length === 0) pax = null;
      }
      const fields = { ...(rawFields as AssistantDraft["fields"]), pax };
      const warnings = computePaxWarnings(data.message, rawFields, pax);
      return {
        kind: "draft",
        action: !forceCreate && d.action === "update" ? "update" : "create",
        target_trip_id: !forceCreate && typeof d.target_trip_id === "string" ? d.target_trip_id : null,
        fields,
        summary: typeof d.summary === "string" ? d.summary : "Proposed trip",
        warnings: warnings.length ? warnings : undefined,
      };
    };
    // ---- Glossary management via the shared ai_lessons store ----
    // Writes go through the same table the AI Learning page reads/manages, so
    // coordinators can see and curate them there too. Company-scope + status
    // 'approved' means they're immediately usable, and PII redaction still
    // applies (the shared submit path enforces that policy).
    if (p.kind === "glossary_save") {
      const term = typeof p.term === "string" ? p.term.trim() : "";
      const meaning = typeof p.meaning === "string" ? p.meaning.trim() : "";
      if (!term || !meaning) {
        return answer("Tell me the shorthand and what it means, e.g. \"MSV means Medserv, based at Freeport\".");
      }
      if (term.length > 80 || meaning.length > 400) {
        return answer("Please keep the shorthand under 80 characters and the meaning under 400.");
      }
      // Redact PII from the meaning before storage (matches submitLesson).
      const { redactPii } = await import("@/lib/ai-pii.server");
      const meaningR = redactPii(meaning);
      if (!meaningR.safe) return answer(`I can't store that shortcut — ${meaningR.reason}. Try again without personal contact details.`);
      // Upsert by case-insensitive title match against the caller's own rows.
      const existing = glossary.find((g) => g.owned && g.term.toLowerCase() === term.toLowerCase());
      if (existing) {
        const { error } = await supabaseAdmin
          .from("ai_lessons")
          .update({ rule_text: meaningR.text, example_input_redacted: term, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("company_id", company.id);
        if (error) return answer(`Couldn't save that: ${error.message}`);
      } else {
        const { error } = await supabaseAdmin.from("ai_lessons").insert({
          kind: "glossary",
          scope: "company",
          company_id: company.id,
          title: term,
          example_input_redacted: term,
          rule_text: meaningR.text,
          status: "approved",
          submitted_by: context.userId,
        });
        if (error) return answer(`Couldn't save that: ${error.message}`);
      }
      return answer(`Got it — ${term} = ${meaningR.text}. Manage all shortcuts on the AI Learning page. Say "forget ${term}" to remove it.`);
    }
    if (p.kind === "glossary_list") {
      if (glossary.length === 0) {
        return answer("No shortcuts saved yet. Teach me one with something like: \"MSV means Medserv, based at Freeport\".");
      }
      const lines = glossary.map((g) => `• ${g.term} = ${g.meaning}${g.owned ? "" : "  (shared)"}`).join("\n");
      return answer(`Here's what I know for ${company.name}:\n${lines}\n\nSay "forget <term>" to remove one, or open AI Learning to edit.`);
    }
    if (p.kind === "glossary_delete") {
      const rawTerm = typeof p.term === "string" ? p.term.trim() : "";
      if (!rawTerm) return answer("Which shortcut should I forget?");
      const target = glossary.find((g) => g.owned && g.term.toLowerCase() === rawTerm.toLowerCase());
      if (!target) return answer(`I don't have a company shortcut for "${rawTerm}". Shared/global entries can only be removed by an admin.`);
      // Archive (not delete) to match how the AI Learning page manages lessons.
      const { error } = await supabaseAdmin
        .from("ai_lessons")
        .update({ status: "archived" })
        .eq("id", target.id)
        .eq("company_id", company.id);
      if (error) return answer(`Couldn't remove that: ${error.message}`);
      return answer(`Forgotten — ${target.term} is no longer a shortcut.`);
    }

    // ---- Structured multi-action proposals (group / ungroup / message) ----
    // We validate here to avoid staging bad ids into ai_command_log later. The
    // client stages the returned actions and applies them via the EXISTING
    // applyAiCommandActions server function.
    if (p.kind === "command_actions") {
      const rawActions = Array.isArray(p.actions) ? (p.actions as unknown[]) : [];
      const upcomingIds = new Set(upcoming.map((r: any) => r.id as string));
      const openId = trip?.id ?? null;
      const validJobId = (id: unknown): id is string =>
        typeof id === "string" && (upcomingIds.has(id) || id === openId);
      const cleaned: AssistantCommandActions["actions"] = [];
      for (const raw of rawActions.slice(0, 20)) {
        const it = (raw ?? {}) as Record<string, unknown>;
        const type = it.type as string;
        if (type === "group") {
          const ids = Array.isArray(it.job_ids)
            ? (it.job_ids as unknown[]).filter(validJobId).slice(0, 20)
            : [];
          if (ids.length < 2) continue;
          const group_name = typeof it.group_name === "string" && it.group_name.trim() ? it.group_name.trim().slice(0, 80) : null;
          cleaned.push({
            type: "group",
            job_ids: ids,
            group_name,
            label: `Group ${ids.length} trips${group_name ? ` as "${group_name}"` : ""}`,
          });
        } else if (type === "ungroup") {
          if (!validJobId(it.job_id)) continue;
          cleaned.push({
            type: "ungroup",
            job_id: it.job_id,
            label: `Ungroup trip ${(it.job_id as string).slice(0, 8)}`,
          });
        } else if (type === "message") {
          if (!validJobId(it.job_id)) continue;
          const body = typeof it.body === "string" ? it.body.trim().slice(0, 800) : "";
          if (!body) continue;
          const thread = (it.thread === "driver" || it.thread === "client" || it.thread === "group") ? it.thread : "driver";
          cleaned.push({
            type: "message",
            job_id: it.job_id,
            thread,
            body,
            label: `Message (${thread}) on ${(it.job_id as string).slice(0, 8)}: ${body.slice(0, 80)}`,
          });
        }
      }
      if (cleaned.length === 0) {
        return answer("I couldn't line up any actions on trips I can see. Open the trip(s) you mean and try again.");
      }
      return {
        kind: "command_actions",
        actions: cleaned,
        summary: typeof p.summary === "string" && p.summary.trim() ? p.summary : `${cleaned.length} action${cleaned.length === 1 ? "" : "s"} pending your approval`,
      };
    }

    // ---- Merge duplicate trips ----
    if (p.kind === "merge_trips") {
      const upcomingIds = new Set(upcoming.map((r: any) => r.id as string));
      const referencedIds = new Set(
        referencedBlock === "(none)"
          ? []
          : Array.from(referencedBlock.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)).map((m) => m[0]),
      );
      const openId = trip?.id ?? null;
      const validJobId = (id: unknown): id is string =>
        typeof id === "string" && (upcomingIds.has(id) || referencedIds.has(id) || id === openId);
      const keep_job_id = validJobId(p.keep_job_id) ? p.keep_job_id : "";
      const drop_job_ids = Array.isArray(p.drop_job_ids)
        ? Array.from(new Set((p.drop_job_ids as unknown[]).filter(validJobId))).filter((id) => id !== keep_job_id).slice(0, 10)
        : [];
      if (!keep_job_id || drop_job_ids.length === 0) {
        return answer("Which duplicate trips should I merge? Open the trips or refer to their card numbers, then tell me which one to keep.");
      }
      return {
        kind: "merge_trips",
        keep_job_id,
        drop_job_ids,
        summary: typeof p.summary === "string" && p.summary.trim()
          ? p.summary.trim().slice(0, 300)
          : `Merge ${drop_job_ids.length + 1} duplicate trips`,
      };
    }

    // ---- Auto-coordinate trigger ----
    if (p.kind === "auto_coordinate") {
      const intro = typeof p.intro === "string" && p.intro.trim() ? p.intro.trim().slice(0, 240) : "Reviewing your unassigned backlog and grouping opportunities.";
      const directive = typeof p.directive === "string" && p.directive.trim() ? p.directive.trim().slice(0, 500) : null;
      const targetName = typeof p.target_name === "string" && p.target_name.trim() ? p.target_name.trim().slice(0, 200) : null;

      // If the coordinator named a specific destination, resolve it against
      // the driver roster and the ACTIVE_PARTNERS list before running the
      // planner. If nothing matches, ask a short clarifying question rather
      // than silently running a generic auto-coordinate.
      let resolved_target: AssistantAutoCoordinate["resolved_target"] = null;
      if (targetName) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
        const nt = norm(targetName);
        const driverMatch = drivers.find((d) => {
          const n = norm(d.name ?? "");
          return n && (n === nt || n.includes(nt) || nt.includes(n));
        });
        const partnerMatch = !driverMatch
          ? partners.find((pp) => {
              const n = norm(pp.name ?? "");
              return n && (n === nt || n.includes(nt) || nt.includes(n));
            })
          : null;
        if (driverMatch) {
          resolved_target = { type: "driver", id: driverMatch.id, name: driverMatch.name ?? targetName };
        } else if (partnerMatch) {
          resolved_target = { type: "partner", id: partnerMatch.id, name: partnerMatch.name ?? targetName };
        } else {
          return answer(
            `I couldn't find a driver or partner company named "${targetName}" in your roster or your Collaborate network. Double-check the spelling, or tell me the exact name and I'll try again.`,
          );
        }
      }

      return { kind: "auto_coordinate", intro, directive, resolved_target };
    }




    if (p.kind === "batch" && Array.isArray(p.drafts)) {

      const drafts = (p.drafts as unknown[]).map((d) => toDraft(d, true));
      // Drafts/batches are NOT metered here — assistant_trip_action is charged
      // on Confirm (once per trip) via meterAssistantConfirm.
      if (drafts.length >= 2) {
        return {
          kind: "batch",
          drafts,
          clarify: typeof p.clarify === "string" && p.clarify.trim() ? p.clarify : null,
        };
      }
      if (drafts.length === 1) return drafts[0];
    }
    if (p.kind === "search_update") {
      const rawTerms = Array.isArray(p.criteria_terms)
        ? (p.criteria_terms as unknown[]).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
        : [];
      const terms = rawTerms.slice(0, 3);
      const changes = (p.changes as AssistantDraft["fields"]) ?? {};
      const criteria = typeof p.criteria === "string" ? p.criteria : "";
      const dateScope = typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null;
      if (terms.length === 0 || Object.keys(changes).length === 0) {
        return answer("Which trips should I edit, and what should change? Give me a shared reference (e.g. group name, flight, hotel) and the new value.");
      }
      // Match ILIKE across the fields most likely to carry the shared reference.
      const searchable = [
        "clientcompanyname",
        "group_name",
        "from_flight",
        "to_flight",
        "from_location",
        "to_location",
      ] as const;
      let q = supabaseAdmin
        .from("jobs")
        .select("id, from_location, to_location, date, time, clientcompanyname, from_flight, to_flight, driver_id")
        .eq("company_id", company.id)
        .not("status", "in", "(completed,cancelled)")
        .limit(50);
      if (dateScope) q = q.eq("date", dateScope);
      // Require every term to appear in ANY of the searchable fields.
      for (const term of terms) {
        const escaped = term.replace(/[%_,()]/g, " ");
        const or = searchable.map((c) => `${c}.ilike.%${escaped}%`).join(",");
        q = q.or(or);
      }
      const { data: matches, error } = await q;
      if (error) return answer(`Couldn't search trips: ${error.message}`);
      const rows = matches ?? [];
      if (rows.length === 0) {
        return answer(`I couldn't find any active trips matching "${criteria || terms.join(" ")}"${dateScope ? ` on ${dateScope}` : ""}. Try a different reference (client, flight, hotel, group).`);
      }
      const summaryOf = typeof p.summary === "string" && p.summary.trim() ? p.summary : `Edit ${rows.length} matched trips`;
      const drafts: AssistantDraft[] = rows.map((r) => ({
        kind: "draft",
        action: "update",
        target_trip_id: r.id as string,
        fields: changes,
        summary: `${r.date ?? ""} ${r.time ?? ""} · ${r.from_location ?? "?"} → ${r.to_location ?? "?"}${r.clientcompanyname ? ` · ${r.clientcompanyname}` : ""}`.trim(),
      }));
      if (drafts.length === 1) return drafts[0];
      return {
        kind: "batch",
        drafts,
        clarify: `${summaryOf}. Uncheck any you don't want changed, then Confirm all.`,
      };
    }
    if (p.kind === "data_fix") {
      const target = p.target === "driver" ? "driver" : "trip";
      const target_id = typeof p.target_id === "string" ? p.target_id : "";
      const field = typeof p.field === "string" ? p.field : "";
      const new_value = typeof p.new_value === "string" ? p.new_value.trim() : "";
      const TRIP_FIELDS: Record<string, string> = {
        from_location: "From location",
        to_location: "To location",
        contact_phone: "Passenger phone",
        clientcompanyname: "Client / company",
        from_flight: "From flight",
        to_flight: "To flight",
        vehicle: "Vehicle",
      };
      const DRIVER_FIELDS: Record<string, string> = { name: "Driver name", phone: "Driver phone" };
      const allowed = target === "trip" ? TRIP_FIELDS : DRIVER_FIELDS;
      if (!target_id || !allowed[field] || !new_value) {
        return answer(
          "Which record and which field should I fix, and what's the correct value? (e.g. 'fix spelling of Cervignano on this trip')",
        );
      }
      // Verify the record exists and belongs to this company; capture old value.
      if (target === "trip") {
        const { data: row } = await supabaseAdmin
          .from("jobs")
          .select(`id, from_location, to_location, contact_phone, clientcompanyname, from_flight, to_flight, vehicle, date, time`)
          .eq("id", target_id)
          .eq("company_id", company.id)
          .maybeSingle();
        if (!row) return answer("I couldn't find that trip on your company's roster. Open the trip you want to fix and try again.");
        const old_value = (row as Record<string, unknown>)[field];
        const label = `Trip · ${row.from_location ?? "?"} → ${row.to_location ?? "?"}${row.date ? ` · ${row.date}${row.time ? " " + row.time.slice(0, 5) : ""}` : ""}`;
        return {
          kind: "data_fix",
          target,
          target_id,
          target_label: label,
          field,
          field_label: allowed[field],
          old_value: old_value == null ? null : String(old_value),
          new_value,
          summary: typeof p.summary === "string" && p.summary.trim() ? p.summary : `Fix ${allowed[field].toLowerCase()}`,
        };
      }
      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("id, name, phone")
        .eq("id", target_id)
        .eq("company_id", company.id)
        .maybeSingle();
      if (!drv) return answer("I couldn't find that driver on your roster.");
      const old_value = (drv as Record<string, unknown>)[field];
      return {
        kind: "data_fix",
        target,
        target_id,
        target_label: `Driver · ${drv.name ?? "(no name)"}`,
        field,
        field_label: allowed[field],
        old_value: old_value == null ? null : String(old_value),
        new_value,
        summary: typeof p.summary === "string" && p.summary.trim() ? p.summary : `Fix ${allowed[field].toLowerCase()}`,
      };
    }
    if (p.kind === "partner_suggest") {
      if (partners.length === 0) {
        return answer(
          "You don't have any active Collaborate partners yet. Open Collaborate to invite another company or accept an invite, and I'll be able to suggest hand-offs.",
        );
      }
      const rawItems = Array.isArray(p.items) ? (p.items as unknown[]) : [];
      const partnerById = new Map(partners.map((x) => [x.id, x.name]));
      const upcomingById = new Map(upcoming.map((r: any) => [r.id, r]));
      const openTripId = trip?.id ?? null;
      const items: AssistantPartnerSuggest["items"] = [];
      for (const raw of rawItems.slice(0, 20)) {
        const it = (raw ?? {}) as Record<string, unknown>;
        const job_id = typeof it.job_id === "string" ? it.job_id : "";
        const partner_company_id = typeof it.partner_company_id === "string" ? it.partner_company_id : "";
        const reason = typeof it.reason === "string" && it.reason.trim() ? it.reason.trim().slice(0, 200) : null;
        if (!job_id || !partner_company_id) continue;
        if (!partnerById.has(partner_company_id)) continue;
        // Trip must be either the currently open trip OR one of the upcoming trips we surfaced.
        const row = upcomingById.get(job_id) ?? (openTripId === job_id ? trip : null);
        if (!row) continue;
        // Cross-check ownership on the currently-open trip since it wasn't in the pre-loaded list.
        if (!upcomingById.has(job_id)) {
          const { data: check } = await supabaseAdmin
            .from("jobs")
            .select("id, executor_company_id, dispatch_status, from_location, to_location, date, time")
            .eq("id", job_id)
            .eq("executor_company_id", company.id)
            .maybeSingle();
          if (!check) continue;
          if (check.dispatch_status === "pending") continue;
          items.push({
            job_id,
            job_label: `${(check.time ?? "").slice(0, 5)} · ${check.from_location ?? "?"} → ${check.to_location ?? "?"}`.trim(),
            partner_company_id,
            partner_name: partnerById.get(partner_company_id)!,
            reason,
          });
          continue;
        }
        if (row.dispatch_status === "pending") continue;
        items.push({
          job_id,
          job_label: `${(row.time ?? "").slice(0, 5)} · ${row.from_location ?? "?"} → ${row.to_location ?? "?"}`.trim(),
          partner_company_id,
          partner_name: partnerById.get(partner_company_id)!,
          reason,
        });
      }
      if (items.length === 0) {
        return answer("I couldn't match your request to a specific trip and partner. Open the trip you want to hand off and try again, or name the trip and partner.");
      }
      return {
        kind: "partner_suggest",
        items,
        summary: typeof p.summary === "string" && p.summary.trim() ? p.summary : `Suggest forwarding ${items.length} trip${items.length === 1 ? "" : "s"} to your partners`,
      };
    }
    if (p.kind === "draft") return toDraft(p);
    return answer(typeof p.text === "string" ? p.text : "Sorry, I couldn't answer that.");
  });


/**
 * Load the minimum fields required by `jobInput` so the client can merge an
 * assistant draft and call the existing `updateJob` server function. Scoped
 * to the caller's company.
 */
export const getJobForAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (!company) throw new Error("No company assigned to this account.");
    const { data: row, error } = await supabaseAdmin
      .from("jobs")
      .select(
        "id, from_location, to_location, date, time, flightorship, from_flight, to_flight, clientcompanyname, qr_strict_mode, tracking_enabled, vehicle, contact_phone, driver_id, pickup_place_id, dropoff_place_id, pickup_display_name, dropoff_display_name, tracking_kind",
      )
      .eq("id", data.id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Trip not found.");
    return row;
  });

/**
 * Per-action metering for confirmed assistant actions. Called by the client
 * AFTER the user hits Confirm on a proposal. One RPC call per unit charged
 * — so a 3-trip batch confirm should invoke this three times (or pass
 * count=3) so it costs 3× the configured `assistant_trip_action` rate.
 *
 * Soft-metering: mirrors the existing pattern — logs a warning on failure
 * but never blocks the primary action (the trip has already been written).
 */
export const meterAssistantConfirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        feature_key: z.enum(["assistant_trip_action", "assistant_data_fix"]),
        count: z.number().int().min(1).max(50).default(1),
        job_id: z.string().uuid().nullable().optional(),
        note: z.string().max(200).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (!company) return { charged: 0 };
    let charged = 0;
    for (let i = 0; i < data.count; i++) {
      try {
        const { error } = await supabaseAdmin.rpc("spend_points", {
          _company_id: company.id,
          _feature_key: data.feature_key,
          _job_id: (data.job_id ?? undefined) as unknown as string,
          _note: data.note ?? `assistant confirm (${data.feature_key})`,
          _cost_override: undefined as unknown as number,
        });
        if (!error) charged += 1;
      } catch {
        /* soft — do not throw */
      }
    }
    return { charged };
  });

/**
 * Stage a validated `command_actions` proposal into `ai_command_log` so the
 * client can then apply confirmed items via the EXISTING
 * `applyAiCommandActions` server function (same audit trail, same execution
 * layer, no reimplementation).
 *
 * We do not run the actions here — the client will call applyAiCommandActions
 * with the returned log id and the indices the coordinator approved. Returns
 * `{ id, actions }` where `actions` mirrors the persisted array so the client
 * can render describeAction-style cards from the authoritative payload.
 */
export const stageAssistantActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        raw_message: z.string().max(2000).default(""),
        summary: z.string().max(500).default(""),
        actions: z
          .array(
            z.discriminatedUnion("type", [
              z.object({
                type: z.literal("group"),
                job_ids: z.array(z.string().uuid()).min(2).max(20),
                group_name: z.string().max(80).nullable().optional(),
              }),
              z.object({ type: z.literal("ungroup"), job_id: z.string().uuid() }),
              z.object({
                type: z.literal("message"),
                job_id: z.string().uuid(),
                thread: z.enum(["driver", "client", "group"]),
                body: z.string().min(1).max(2000),
              }),
            ]),
          )
          .min(1)
          .max(20),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (!company) throw new Error("No company assigned to this account.");
    // Normalize into the exact shape ai_command_log stores (same keys the old
    // Command Bar produces, so applyAiCommandActions consumes them as-is).
    const stored = data.actions.map((a) => {
      const base: Record<string, unknown> = {
        type: a.type,
        job_id: null,
        job_ids: null,
        driver_id: null,
        date: null,
        time: null,
        pickup_at: null,
        new_status: null,
        group_name: null,
        partner_company_id: null,
        thread: null,
        body: null,
        note: null,
      };
      if (a.type === "group") {
        base.job_ids = a.job_ids;
        base.group_name = a.group_name ?? null;
      } else if (a.type === "ungroup") {
        base.job_id = a.job_id;
      } else if (a.type === "message") {
        base.job_id = a.job_id;
        base.thread = a.thread;
        base.body = a.body;
      }
      return base;
    });
    const { data: row, error } = await supabaseAdmin
      .from("ai_command_log")
      .insert({
        company_id: company.id,
        actor_user_id: context.userId,
        mode: "execute",
        prompt: data.raw_message.slice(0, 2000) || "(via AI dispatch assistant)",
        response: data.summary || "Proposed by AI dispatch assistant",
        actions: stored as never,
        status: "awaiting_confirm",
        requires_confirmation: true,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Failed to stage actions.");
    return { id: (row as { id: string }).id };
  });



