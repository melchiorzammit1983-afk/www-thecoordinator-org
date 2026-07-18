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

export type AssistantResult = AssistantAnswer | AssistantDraft;

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

    // Meter (soft — block_on_empty=false in the ai_feature_costs row).
    try {
      await supabaseAdmin.rpc("spend_points", {
        _company_id: company.id,
        _feature_key: "ai_coordinator_assist",
        _job_id: undefined as unknown as string,
        _note: "coordinator assistant turn",
        _cost_override: undefined as unknown as number,
      });
    } catch {
      // never break the primary action on metering hiccups
    }

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

    const system = `You are the built-in AI dispatch assistant for The Coordinator, a transport-dispatch platform in Malta.

You do TWO things:
1) ANSWER short, on-topic questions the coordinator asks about the currently open screen or general workflow.
2) When the coordinator asks to CREATE or EDIT a single trip, return a structured DRAFT — never claim you've saved it. The user confirms.

Rules:
- Return STRICT JSON only. No markdown. Shape:
  { "kind": "answer", "text": "..." }
  OR
  { "kind": "draft", "action": "create" | "update", "target_trip_id": "<uuid or null>",
    "fields": { "from_location"?, "to_location"?, "date"? (yyyy-mm-dd), "time"? (HH:mm 24h Malta local),
                "driver_id"? (uuid from roster below or null), "driver_name"? (echo the name you matched),
                "vehicle"?, "contact_phone"?, "from_flight"?, "to_flight"?, "clientcompanyname"? },
    "summary": "one short sentence e.g. Move Trip #ABC to 19:00" }
- For "update", set target_trip_id to the currently open trip id when the user says "this trip", "it", "the trip", etc. Only include fields that actually change.
- For "create", omit target_trip_id (null).
- Times are Malta local, 24h.
- Only draft ONE trip. If the request is bulk or ambiguous, answer instead: politely say to use the bulk paste tool.
- If the request is not about a single trip create/edit, use kind:"answer".
- Never mention how the system is built, database names, or model names.

Today's date (Malta): ${today}
Company: ${company.name}

Driver roster (id — name), pick by fuzzy name match when the user names a driver:
${drivers.map((d) => `${d.id} — ${d.name ?? "(no name)"}`).join("\n") || "(no drivers yet)"}

Current screen: ${data.screen?.path ?? "(unknown)"}
Currently open trip: ${trip ? JSON.stringify(trip) : "(none)"}

Recent conversation:
${historyLines || "(none)"}
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { kind: "answer", text: content || "Sorry, I couldn't parse that." };
    }
    const p = parsed as Record<string, unknown>;
    if (p.kind === "draft") {
      return {
        kind: "draft",
        action: (p.action === "update" ? "update" : "create"),
        target_trip_id: typeof p.target_trip_id === "string" ? p.target_trip_id : null,
        fields: (p.fields as AssistantDraft["fields"]) ?? {},
        summary: typeof p.summary === "string" ? p.summary : "Proposed trip change",
      };
    }
    return {
      kind: "answer",
      text: typeof p.text === "string" ? p.text : "Sorry, I couldn't answer that.",
    };
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

