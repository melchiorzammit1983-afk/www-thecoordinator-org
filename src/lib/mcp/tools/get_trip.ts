import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed } from "../_supabase";

export default defineTool({
  name: "get_trip",
  title: "Get trip",
  description:
    "Fetch full details for one trip by its trip number (e.g. 1234). Includes pickup/dropoff, status, driver, flight info, and pricing fields.",
  inputSchema: {
    trip_no: z.number().int().min(1).describe("The trip's sequential number as shown on the card."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ trip_no }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("jobs")
      .select(
        "id, trip_no, pickup_at, status, from_location, to_location, pickup_display_name, dropoff_display_name, contact_phone, from_flight, to_flight, flight_status, flight_status_note, price_amount, waiting_charge, drivers(name,phone,vehicle)",
      )
      .eq("trip_no", trip_no)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data)
      return { content: [{ type: "text", text: `No trip found with number ${trip_no}` }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { trip: data },
    };
  },
});
