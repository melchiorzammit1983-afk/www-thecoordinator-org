/**
 * Per-client free-text notes, keyed by the normalized clientcompanyname
 * (case- and whitespace-folded) so they attach to the free-text client name
 * every trip already carries — no schema migration on `jobs` needed.
 *
 * Coordinators can add / edit / delete notes for any client name their
 * company has used, and the notes surface next to the client name on trip
 * cards, the trip details sheet, and the AI assistant's proposal cards.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export function normalizeClientKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?"'`()[\]{}]/g, "").trim();
}

async function myCompany(userId: string): Promise<{ id: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("No company assigned to this account.");
  return { id: data.id as string };
}

export type ClientNote = { client_key: string; client_display: string; note: string; updated_at: string };

export const listClientNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClientNote[]> => {
    const c = await myCompany(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("client_notes")
      .select("client_key, client_display, note, updated_at")
      .eq("company_id", c.id)
      .order("client_display", { ascending: true })
      .limit(500);
    return (data ?? []) as ClientNote[];
  });

export const getClientNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ client_name: z.string().trim().min(1).max(200) }).parse(i))
  .handler(async ({ data, context }): Promise<ClientNote | null> => {
    const c = await myCompany(context.userId);
    const key = normalizeClientKey(data.client_name);
    if (!key) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("client_notes")
      .select("client_key, client_display, note, updated_at")
      .eq("company_id", c.id)
      .eq("client_key", key)
      .maybeSingle();
    return (row as ClientNote | null) ?? null;
  });

export const upsertClientNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        client_name: z.string().trim().min(1).max(200),
        note: z.string().max(2000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; deleted?: boolean }> => {
    const c = await myCompany(context.userId);
    const key = normalizeClientKey(data.client_name);
    if (!key) throw new Error("Client name is empty.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const trimmed = data.note.trim();
    if (!trimmed) {
      await supabaseAdmin.from("client_notes").delete().eq("company_id", c.id).eq("client_key", key);
      return { ok: true, deleted: true };
    }
    const { error } = await supabaseAdmin.from("client_notes").upsert(
      {
        company_id: c.id,
        client_key: key,
        client_display: data.client_name.trim().slice(0, 200),
        note: trimmed,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,client_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
