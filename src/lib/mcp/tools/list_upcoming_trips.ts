import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed } from "../_supabase";

export default defineTool({
  name: "list_upcoming_trips",
  title: "List upcoming trips",
  description:
    "List the signed-in coordinator's upcoming trips within a time window. Returns trip number, pickup time, from/to, status, and assigned driver name.",
  inputSchema: {
    hours_ahead: z
      .number()
      .int()
      .min(1)
      .max(720)
      .default(24)
      .describe("How many hours ahead of now to include. Default 24."),
    limit: z.number().int().min(1).max(200).default(50).describe("Max trips to return. Default 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ hours_ahead, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const sb = supabaseForUser(ctx);
    const now = new Date();
    const until = new Date(now.getTime() + hours_ahead * 3600_000);
    const { data, error } = await sb
      .from("jobs")
      .select(
        "id, trip_no, pickup_at, status, from_location, to_location, pickup_display_name, dropoff_display_name, contact_phone, from_flight, to_flight, drivers(name,phone,vehicle)",
      )
      .gte("pickup_at", now.toISOString())
      .lte("pickup_at", until.toISOString())
      .order("pickup_at", { ascending: true })
      .limit(limit);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { trips: data ?? [] },
    };
  },
});
