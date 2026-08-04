// Access guard for the paid Google Maps proxy server functions
// (places autocomplete/details/resolve + static route thumbnails).
//
// These endpoints spend real money per call, so every request must be bound
// to either a signed-in Supabase user OR one of the app's existing magic
// tokens (portal magic link, public booking link, driver/client magic link,
// or a job's client tracking link). Anonymous callers are rejected.
//
// On top of the binding we apply a small in-process token bucket per caller
// identity so a single compromised link can't burn thousands of calls.
//
// Server-only: imports the admin Supabase client — never import at module
// scope of a client-reachable file.

import { getRequestHeader } from "@tanstack/react-start/server";

export type MapsCaller = { kind: "user" | "token"; id: string };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function userFromRequest(): Promise<string | null> {
  try {
    const header = getRequestHeader("authorization") ?? getRequestHeader("Authorization");
    const jwt = header?.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return null;
    const sb = await admin();
    const { data, error } = await sb.auth.getUser(jwt);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

async function subjectForToken(token: string): Promise<string | null> {
  if (!token || token.length < 8 || token.length > 200) return null;
  const sb = await admin();

  const { data: link } = await sb
    .from("magic_links")
    .select("id, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (link && !link.revoked_at && (!link.expires_at || new Date(link.expires_at).getTime() > Date.now())) {
    return `magic:${link.id}`;
  }

  const { data: portal } = await sb
    .from("portal_companies")
    .select("id, active, link_enabled, link_expires_at")
    .eq("magic_token", token)
    .maybeSingle();
  if (
    portal &&
    portal.active &&
    portal.link_enabled &&
    (!portal.link_expires_at || new Date(portal.link_expires_at).getTime() > Date.now())
  ) {
    return `portal:${portal.id}`;
  }

  const { data: company } = await sb
    .from("companies")
    .select("id, status")
    .eq("custom_link", token)
    .maybeSingle();
  if (company && company.status === "approved") return `company:${company.id}`;

  const { data: guest } = await sb
    .from("portal_guest_sessions" as any)
    .select("id, expires_at")
    .eq("session_token", token)
    .maybeSingle();
  if (guest && (!(guest as any).expires_at || new Date((guest as any).expires_at).getTime() > Date.now())) {
    return `guest:${(guest as any).id}`;
  }

  const { data: job } = await sb
    .from("jobs")
    .select("id")
    .eq("client_link_token" as any, token)
    .maybeSingle();
  if (job?.id) return `job:${job.id}`;

  return null;
}

// --- per-identity token bucket (in-process) ---------------------------------

const BUCKET_CAPACITY = 60; // burst
const REFILL_PER_MS = 30 / 60_000; // 30 calls / minute sustained
const buckets = new Map<string, { tokens: number; ts: number }>();

function takeToken(key: string, cost = 1): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: BUCKET_CAPACITY, ts: now };
  b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + (now - b.ts) * REFILL_PER_MS);
  b.ts = now;
  if (b.tokens < cost) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= cost;
  buckets.set(key, b);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now - v.ts > 10 * 60_000) buckets.delete(k);
    }
  }
  return true;
}

/**
 * Verifies the caller and consumes `cost` rate-limit units.
 * Throws `maps_unauthorized` or `maps_rate_limited`.
 */
export async function requireMapsAccess(
  publicToken?: string | null,
  cost = 1,
): Promise<MapsCaller> {
  const userId = await userFromRequest();
  let caller: MapsCaller | null = userId ? { kind: "user", id: userId } : null;

  if (!caller && publicToken) {
    const subject = await subjectForToken(publicToken.trim());
    if (subject) caller = { kind: "token", id: subject };
  }
  if (!caller) throw new Error("maps_unauthorized");
  if (!takeToken(`${caller.kind}:${caller.id}`, cost)) throw new Error("maps_rate_limited");
  return caller;
}
