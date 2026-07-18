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
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(4000),
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
  };
  summary: string;
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

export type AssistantResult = AssistantAnswer | AssistantDraft | AssistantBatch | AssistantDataFix | AssistantPartnerSuggest;


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

    // Per-company glossary (term → meaning). Loaded on every turn so the
    // model can (a) recognize teaching statements consistently, (b) list
    // entries on request, and (c) expand shorthand before drafting any
    // trip action or search. Kept small on purpose (cap 200 rows).
    const { data: glossRows } = await supabaseAdmin
      .from("assistant_glossary")
      .select("id, term, meaning")
      .eq("company_id", company.id)
      .order("term", { ascending: true })
      .limit(200);
    const glossary = (glossRows ?? []) as { id: string; term: string; meaning: string }[];
    const glossaryBlock = glossary.length
      ? glossary.map((g) => `- ${g.term} = ${g.meaning}`).join("\n")
      : "(empty — nothing taught yet)";

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
      .select("id, date, time, from_location, to_location, driver_id, dispatch_status, pickup_at, clientcompanyname")
      .eq("executor_company_id", company.id)
      .not("status", "in", "(completed,cancelled)")
      .gte("pickup_at", nowIso)
      .lte("pickup_at", soonIso)
      .order("pickup_at", { ascending: true })
      .limit(40);
    const upcoming = (upcomingRows ?? []) as any[];
    const upcomingBlock = upcoming.length
      ? upcoming
          .map((r) => `${r.id} — ${r.date ?? ""} ${(r.time ?? "").slice(0, 5)} · ${r.from_location ?? "?"} → ${r.to_location ?? "?"}${r.driver_id ? " · (driver assigned)" : " · (no driver)"}${r.dispatch_status === "pending" ? " · (already sent to partner)" : ""}`)
          .join("\n")
      : "(none in the next 48h)";


    const today = new Date().toISOString().slice(0, 10);
    const trip = data.screen?.trip ?? null;
    const historyLines = (data.history ?? [])
      .slice(-8)
      .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
      .join("\n");

    // Fold the retired "Ask the Guide" coach knowledge (live facts, event
    // catalog, visual signals, help article index) into this unified
    // assistant so nothing is lost when kind:"answer" is returned.
    let guideKnowledge = "";
    try {
      const { buildSystemPrompt } = await import("@/lib/help-ai.server");
      guideKnowledge = buildSystemPrompt({ mode: "coach" });
    } catch {
      /* non-fatal — assistant still works without the folded guide */
    }

    const system = `You are the built-in AI dispatch assistant for The Coordinator, a transport-dispatch platform in Malta. You have ALSO absorbed the responsibilities of the retired "Ask the Guide" in-app coach — when the coordinator asks a how-to / troubleshooting / product question, answer it in kind:"answer" using the coach guidance and live facts below.

You do SEVEN things:
1) ANSWER on-topic questions (how-to, troubleshooting, "what does this badge mean", product questions) using the folded Guide knowledge at the bottom of this prompt.
2) When the coordinator asks to CREATE or EDIT a SINGLE trip, return a DRAFT.
3) When the coordinator's message describes MULTIPLE NEW trips (a list, a pasted booking email with several trips, "make me 3 trips: ..."), return a BATCH of create drafts — one per trip you can identify.
4) When the coordinator asks to EDIT MULTIPLE EXISTING trips matching some shared reference (e.g. "move all trips for Asso 25 to 19:00 instead of 11am", "reassign all of Hilton's trips to driver Y", "cancel all X's trips today"), return a SEARCH_UPDATE — the server will resolve which trips match and build the update batch.
5) When the coordinator asks to FIX a small typo on a single existing record (spelling of a location on this trip, client company name, passenger contact phone, flight code, or a driver's name/phone), return a DATA_FIX (single record, single field). Use this for corrections — not for schedule or driver-assignment changes.
6) GLOSSARY MANAGEMENT — the coordinator can teach you their shorthand / aliases / abbreviations (term → meaning), review them, or forget them:
   - Teaching: statements like "MSV means Medserv, based at Freeport", "Asso 25 = Asso Venticinque", "when I say WE I mean Waters Edge Hotel" → kind:"glossary_save".
   - Listing: "what do you know?", "show me the glossary", "list my shortcuts" → kind:"glossary_list".
   - Deleting: "forget MSV", "delete the WE shortcut", "remove Asso 25" → kind:"glossary_delete" with the term to remove.
7) SUGGEST PARTNER HAND-OFF via the coordinator's existing Collaborate network — when they say things like "I'm closing for the day, cover my trips", "I can't cover this", "who can take this one", "hand this off", or ask about an upcoming trip with no available driver, return kind:"partner_suggest" listing one item per trip that should be handed to a partner. Choose partners ONLY from the ACTIVE PARTNERS list below (by their UUID). Choose trips ONLY from the UPCOMING TRIPS list below (by their UUID), or from the currently open trip if the coordinator says "this trip". This is SUGGEST-ONLY: the client shows a Confirm/Cancel card per item and only then triggers the existing hand-off. Never invent partner names, never guess IDs, and never expose any information about the partner beyond their name — you have no other data about them. If there are no active partners, return kind:"answer" saying so plainly. If no trip clearly matches, return kind:"answer" asking one short clarifying question.


Rules:
- Return STRICT JSON only. No markdown. One of:
  { "kind": "answer", "text": "..." }
  { "kind": "draft", "action": "create" | "update", "target_trip_id": "<uuid or null>",
    "fields": { "from_location"?, "to_location"?, "date"? (yyyy-mm-dd), "time"? (HH:mm 24h Malta local),
                "driver_id"? (uuid from roster below or null), "driver_name"?,
                "vehicle"?, "contact_phone"?, "from_flight"?, "to_flight"?, "clientcompanyname"? },
    "summary": "one short sentence" }
  { "kind": "batch",
    "drafts": [ { "kind":"draft", "action":"create", "target_trip_id": null, "fields": {...}, "summary": "..." }, ... ],
    "clarify": "one short question covering all missing/ambiguous bits across the trips, or null" }
  { "kind": "search_update",
    "criteria": "short human phrase describing which trips to match, e.g. 'Asso 25 trips today'",
    "criteria_terms": ["asso 25"],   // 1-3 lowercase tokens matched (ILIKE) against clientcompanyname, group_name, from_flight, to_flight, from_location, to_location
    "date": "yyyy-mm-dd" | null,      // scope to this date if the user named one, else null
    "changes": { same field keys as "fields" above — ONLY the fields to change on every matched trip },
    "summary": "e.g. 'Move Asso 25 trips today from 11:00 to 19:00'" }
  { "kind": "data_fix",
    "target": "trip" | "driver",
    "target_id": "<uuid — the trip or driver record being corrected>",
    "field": "<one of: from_location | to_location | contact_phone | clientcompanyname | from_flight | to_flight | vehicle   (for trip);   name | phone   (for driver)>",
    "new_value": "<corrected value>",
    "summary": "one short sentence, e.g. 'Fix spelling: Cervinjano → Cervignano on this trip'" }
  { "kind": "glossary_save", "term": "<short shorthand as the coordinator uses it, e.g. 'MSV'>", "meaning": "<full meaning, e.g. 'Medserv, based at Freeport'>" }
  { "kind": "glossary_list" }
  { "kind": "glossary_delete", "term": "<the shorthand to remove, exactly as stored>" }
  { "kind": "partner_suggest",
    "items": [ { "job_id": "<uuid from UPCOMING TRIPS>", "partner_company_id": "<uuid from ACTIVE PARTNERS>", "reason": "one short line, or null" } ],
    "summary": "e.g. 'Suggest forwarding 2 trips to Malta Cabs'" }
- For "update" (single) or "search_update" (multi), only include fields that CHANGE.
- For "create" (single or in a batch), omit target_trip_id (null).
- In a "batch" of creates, each element MUST be action:"create".
- Times are Malta local, 24h.
- For a multi-trip CREATE batch, if any trip is missing pickup time / passenger count / exact pickup or drop-off / ambiguous driver, STILL include it and put ONE targeted question in "clarify" naming which trip(s) and what you need. Do NOT guess or silently fill gaps. Do NOT tell the user to "use bulk entry" — just batch it here.
- Use "batch" only when there are 2+ new trips. For 1 new trip use "draft".
- Use "search_update" for ANY request that edits multiple existing trips by a shared reference. Do NOT tell the user this is unsupported and do NOT ask them to edit trips one by one.
- Use "data_fix" ONLY for a small correction to a single existing record — spelling of an address/client/driver, wrong phone digits, wrong flight code. The target_id MUST be a real uuid: use the Currently open trip's id when the coordinator says "this trip", otherwise use a uuid from the roster (drivers). If you cannot confidently identify which record or which field, return kind:"answer" with ONE short clarifying question — do NOT guess. Never use data_fix to change pickup time, date, or driver assignment (those go through draft/update).
- If a search_update reference is genuinely too vague to search reliably (e.g. "fix the trips"), return kind:"answer" asking one short clarifying question instead of guessing.
- If the request is a how-to / product / troubleshooting question (not a trip create/edit), use kind:"answer" and lean on the FOLDED GUIDE KNOWLEDGE below. Keep the confidentiality rules in that section — never reveal how the system is built.
- GLOSSARY EXPANSION: BEFORE producing a draft / batch / search_update / data_fix / answer, silently expand any glossary term found in the coordinator's message using the COMPANY GLOSSARY below (case-insensitive substring match). E.g. if the glossary contains "MSV = Medserv, based at Freeport" and the user says "move MSV's trips to 7pm", treat it as "move Medserv's trips to 7pm" for search_update criteria_terms and criteria (use "medserv" as the term).
- GLOSSARY SAVE: use kind:"glossary_save" ONLY when the message is clearly a teaching statement about a term → meaning. Not for one-off references. Keep "term" short (usually what the user actually says as shorthand). Do NOT combine glossary_save with any other action in the same turn.
- Answers are plain text (no markdown) so they render cleanly inside the JSON "text" field.

Today's date (Malta): ${today}
Company: ${company.name}

COMPANY GLOSSARY (per-company shorthand — apply these to the user's message BEFORE deciding the action):
${glossaryBlock}

Driver roster (id — name), pick by fuzzy name match when the user names a driver:
${drivers.map((d) => `${d.id} — ${d.name ?? "(no name)"}`).join("\n") || "(no drivers yet)"}

Current screen: ${data.screen?.path ?? "(unknown)"}
Currently open trip: ${trip ? JSON.stringify(trip) : "(none)"}

Recent conversation:
${historyLines || "(none)"}

===================== FOLDED GUIDE KNOWLEDGE (for kind:"answer") =====================
${guideKnowledge || "(guide knowledge unavailable — answer briefly from general product knowledge)"}
`;




    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: data.message },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("AI rate limit hit — try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted — top up to continue.");
      throw new Error(`AI error (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "";
    const answer = async (text: string): Promise<AssistantAnswer> => {
      await meter("assistant_qa", "assistant Q&A turn");
      return { kind: "answer", text };
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return answer(content || "Sorry, I couldn't parse that.");
    }
    const p = parsed as Record<string, unknown>;
    const toDraft = (raw: unknown, forceCreate = false): AssistantDraft => {
      const d = (raw ?? {}) as Record<string, unknown>;
      return {
        kind: "draft",
        action: !forceCreate && d.action === "update" ? "update" : "create",
        target_trip_id: !forceCreate && typeof d.target_trip_id === "string" ? d.target_trip_id : null,
        fields: (d.fields as AssistantDraft["fields"]) ?? {},
        summary: typeof d.summary === "string" ? d.summary : "Proposed trip",
      };
    };
    // ---- Glossary management (server-side, no UI card required) ----
    if (p.kind === "glossary_save") {
      const term = typeof p.term === "string" ? p.term.trim() : "";
      const meaning = typeof p.meaning === "string" ? p.meaning.trim() : "";
      if (!term || !meaning) {
        return answer("Tell me the shorthand and what it means, e.g. \"MSV means Medserv, based at Freeport\".");
      }
      if (term.length > 80 || meaning.length > 400) {
        return answer("Please keep the shorthand under 80 characters and the meaning under 400.");
      }
      const { error } = await supabaseAdmin
        .from("assistant_glossary")
        .upsert(
          { company_id: company.id, term, meaning, updated_at: new Date().toISOString() },
          { onConflict: "company_id,term" },
        );
      if (error) return answer(`Couldn't save that: ${error.message}`);
      return answer(`Got it — ${term} = ${meaning}. I'll use this from now on. Say "forget ${term}" to remove it.`);
    }
    if (p.kind === "glossary_list") {
      if (glossary.length === 0) {
        return answer("No shortcuts saved yet. Teach me one with something like: \"MSV means Medserv, based at Freeport\".");
      }
      const lines = glossary.map((g) => `• ${g.term} = ${g.meaning}`).join("\n");
      return answer(`Here's what I know for ${company.name}:\n${lines}\n\nSay "forget <term>" to remove one.`);
    }
    if (p.kind === "glossary_delete") {
      const rawTerm = typeof p.term === "string" ? p.term.trim() : "";
      if (!rawTerm) return answer("Which shortcut should I forget?");
      // Case-insensitive match — find the actual stored row so we can confirm the exact term.
      const target = glossary.find((g) => g.term.toLowerCase() === rawTerm.toLowerCase());
      if (!target) return answer(`I don't have a shortcut for "${rawTerm}". Say "show me the glossary" to see what's saved.`);
      const { error } = await supabaseAdmin
        .from("assistant_glossary")
        .delete()
        .eq("id", target.id)
        .eq("company_id", company.id);
      if (error) return answer(`Couldn't remove that: ${error.message}`);
      return answer(`Forgotten — ${target.term} is no longer a shortcut.`);
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


