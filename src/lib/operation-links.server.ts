import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function hashOperationLinkToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type ResolvedOperationLink = {
  id: string;
  company_id: string;
  operation_group_id: string;
  recipient_name: string;
  recipient_type: string;
  permissions: Record<string, boolean>;
  expires_at: string;
};

/** Resolve one unexpired, unrevoked bearer token to its own operation only. */
export const resolveOperationLinkToken = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(32).max(256) }).parse(input))
  .handler(async ({ data }) => {
    const sb = await getAdminClient();
    const { data: link, error } = await sb
      .from("operation_links")
      .select("id, company_id, operation_group_id, recipient_name, recipient_type, permissions, expires_at")
      .eq("token_hash", hashOperationLinkToken(data.token))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!link) return null;
    await sb.from("operation_links").update({ last_accessed_at: new Date().toISOString() }).eq("id", link.id);
    return link as ResolvedOperationLink;
  });

export { hashOperationLinkToken };
