import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed } from "../_supabase";

export default defineTool({
  name: "list_drivers",
  title: "List drivers",
  description: "List drivers visible to the signed-in coordinator, with vehicle and contact details.",
  inputSchema: {
    limit: z.number().int().min(1).max(500).default(100).describe("Max drivers to return. Default 100."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("drivers")
      .select("id, name, phone, vehicle, seats_available, availability_note, kind")
      .order("name", { ascending: true })
      .limit(limit);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { drivers: data ?? [] },
    };
  },
});
