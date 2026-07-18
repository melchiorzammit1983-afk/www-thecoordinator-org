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

export type AssistantResult = AssistantAnswer | AssistantDraft | AssistantBatch;

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

You do FOUR things:
1) ANSWER on-topic questions (how-to, troubleshooting, "what does this badge mean", product questions) using the folded Guide knowledge at the bottom of this prompt.
2) When the coordinator asks to CREATE or EDIT a SINGLE trip, return a DRAFT.
3) When the coordinator's message describes MULTIPLE NEW trips (a list, a pasted booking email with several trips, "make me 3 trips: ..."), return a BATCH of create drafts — one per trip you can identify.
4) When the coordinator asks to EDIT MULTIPLE EXISTING trips matching some shared reference (e.g. "move all trips for Asso 25 to 19:00 instead of 11am", "reassign all of Hilton's trips to driver Y", "cancel all X's trips today"), return a SEARCH_UPDATE — the server will resolve which trips match and build the update batch.

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
- For "update" (single) or "search_update" (multi), only include fields that CHANGE.
- For "create" (single or in a batch), omit target_trip_id (null).
- In a "batch" of creates, each element MUST be action:"create".
- Times are Malta local, 24h.
- For a multi-trip CREATE batch, if any trip is missing pickup time / passenger count / exact pickup or drop-off / ambiguous driver, STILL include it and put ONE targeted question in "clarify" naming which trip(s) and what you need. Do NOT guess or silently fill gaps. Do NOT tell the user to "use bulk entry" — just batch it here.
- Use "batch" only when there are 2+ new trips. For 1 new trip use "draft".
- Use "search_update" for ANY request that edits multiple existing trips by a shared reference. Do NOT tell the user this is unsupported and do NOT ask them to edit trips one by one.
- If a search_update reference is genuinely too vague to search reliably (e.g. "fix the trips"), return kind:"answer" asking one short clarifying question instead of guessing.
- If the request is a how-to / product / troubleshooting question (not a trip create/edit), use kind:"answer" and lean on the FOLDED GUIDE KNOWLEDGE below. Keep the confidentiality rules in that section — never reveal how the system is built.
- Answers are plain text (no markdown) so they render cleanly inside the JSON "text" field.

Today's date (Malta): ${today}
Company: ${company.name}

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


