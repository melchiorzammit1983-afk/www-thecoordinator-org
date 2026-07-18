/**
 * Daily summarization job for the assistant silent-learning layer.
 *
 * For each company with recent (~30d) assistant_action_log activity, sends a
 * compact summary of the log rows to Lovable AI and stores a short bullet
 * list of soft preference notes in assistant_learned_preferences. The
 * assistant injects these notes into its system prompt as SOFT biases only.
 *
 * Auth: called by pg_cron with the Supabase anon key in the `apikey` header
 * (this is a public/api route that bypasses auth at the edge — we verify the
 * header inside).
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const MAX_ROWS_PER_COMPANY = 200;
const MAX_BULLETS = 10;
const LOOKBACK_DAYS = 30;

async function summarizeCompany(
  admin: ReturnType<typeof createClient<any>>,
  apiKey: string,
  companyId: string,
): Promise<{ notes: string; sampleSize: number } | null> {
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const { data: rows } = await admin
    .from("assistant_action_log")
    .select("created_at, action_kind, outcome, proposed_payload, final_payload, raw_message")
    .eq("company_id", companyId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS_PER_COMPANY);
  const list = (rows ?? []) as Array<Record<string, unknown>>;
  if (list.length < 5) return null; // not enough signal yet

  const compact = list
    .map((r) => {
      const raw = typeof r.raw_message === "string" ? r.raw_message.slice(0, 240) : "";
      const proposed = JSON.stringify(r.proposed_payload ?? {}).slice(0, 400);
      const final = JSON.stringify(r.final_payload ?? {}).slice(0, 400);
      return `[${r.action_kind}/${r.outcome}] said="${raw}" proposed=${proposed} final=${final}`;
    })
    .join("\n")
    .slice(0, 20_000);

  const system = `You analyze one coordinator's recent AI-assistant interactions and extract SHORT, SOFT preference bullets that will bias future suggestions.

Output rules:
- Return STRICT JSON: { "bullets": ["...","..."] }
- At most ${MAX_BULLETS} bullets, each under 20 words, plain text.
- Only include a bullet if you see the same pattern at least twice.
- Prefer concrete, specific observations (driver names, client names, times, vehicle types, locations) over vague ones.
- If nothing meaningful, return { "bullets": [] }.
- NEVER include PII beyond what appears in the logs (no invented names, no phone numbers, no addresses not present).`;

  const user = `Recent assistant actions for this coordinator (newest first):
${compact}

Extract soft preference bullets.`;

  let bullets: string[] = [];
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { bullets?: unknown };
    if (Array.isArray(parsed.bullets)) {
      bullets = parsed.bullets
        .map((b) => (typeof b === "string" ? b.trim() : ""))
        .filter((b) => b.length > 0 && b.length <= 200)
        .slice(0, MAX_BULLETS);
    }
  } catch {
    return null;
  }

  const notes = bullets.map((b) => `- ${b}`).join("\n");
  return { notes, sampleSize: list.length };
}

export const Route = createFileRoute("/api/public/hooks/summarize-learning")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const providedKey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!providedKey || !anon || providedKey !== anon) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const aiKey = process.env.LOVABLE_API_KEY;
        if (!aiKey) {
          return new Response(JSON.stringify({ error: "ai_not_configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const url = process.env.SUPABASE_URL!;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const admin = createClient<any>(url, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
        const { data: activeRows } = await admin
          .from("assistant_action_log")
          .select("company_id")
          .gte("created_at", sinceIso);
        const companyIds = Array.from(
          new Set(((activeRows ?? []) as Array<{ company_id: string }>).map((r) => r.company_id)),
        );

        let processed = 0;
        let updated = 0;
        for (const cid of companyIds) {
          processed += 1;
          const result = await summarizeCompany(admin, aiKey, cid);
          if (!result) continue;
          try {
            await admin.from("assistant_learned_preferences").upsert(
              {
                company_id: cid,
                notes: result.notes,
                sample_size: result.sampleSize,
                updated_at: new Date().toISOString(),
              } as never,
              { onConflict: "company_id" },
            );
            updated += 1;
          } catch {
            /* ignore individual failures */
          }
        }

        return new Response(
          JSON.stringify({ ok: true, processed, updated }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
