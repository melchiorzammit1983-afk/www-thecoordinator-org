import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only helpers for the crew portal (/crew-portal). Crew members are not
 * Supabase auth users — they're rows in crew_members, reached via a per-crew
 * `link_token` (see Phase 1), and authenticated into a session via a short-lived
 * HMAC JWT after an email one-time-code check. Mirrors the pax tracking JWT
 * pattern in portal-token.server.ts.
 *
 * MUST only be imported inside route/server-fn handlers (never at module scope
 * of a client-reachable file), because it imports the admin Supabase client.
 */

export async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type CrewMember = {
  id: string;
  portal_company_id: string;
  name: string;
  surname: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  ship_name: string | null;
  link_token: string;
  preferred_language: "en" | "fil";
  deleted_at: string | null;
};

function safeEqStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function resolveCrewByLinkToken(token: string): Promise<
  | { ok: true; crew: CrewMember }
  | { ok: false; status: number; error: string }
> {
  if (!token || token.length < 20 || token.length > 128) {
    return { ok: false, status: 400, error: "invalid_token" };
  }
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("crew_members" as any)
    .select("id, portal_company_id, name, surname, email, phone, nationality, ship_name, link_token, preferred_language, deleted_at")
    .eq("link_token", token)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "db_error" };
  if (!data) return { ok: false, status: 404, error: "not_found" };
  if (!safeEqStr((data as any).link_token, token)) return { ok: false, status: 404, error: "not_found" };
  if ((data as any).deleted_at) return { ok: false, status: 404, error: "not_found" };
  return { ok: true, crew: data as unknown as CrewMember };
}

/** Simple per-key per-minute cap (reuses the shared portal_rate_limits bucket table). */
export async function checkRateLimit(key: string, limit = 60): Promise<boolean> {
  const admin = await getAdmin();
  const bucket = Math.floor(Date.now() / 60_000);
  const { data: existing } = await admin
    .from("portal_rate_limits" as any)
    .select("count")
    .eq("token", key)
    .eq("minute_bucket", bucket)
    .maybeSingle();
  const next = ((existing as any)?.count ?? 0) + 1;
  if (next > limit) return false;
  await admin
    .from("portal_rate_limits" as any)
    .upsert({ token: key, minute_bucket: bucket, count: next } as any, { onConflict: "token,minute_bucket" });
  return true;
}

// ---------- Crew session JWT (HS256) ----------

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function secret() {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("missing_secret");
  return s;
}

export type CrewSessionPayload = { crewId: string; linkToken: string; exp: number };

/** 1-hour sliding session — callers should re-mint (extend) on each authenticated call. */
export function mintCrewJwt(payload: CrewSessionPayload): string {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret()).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

export function verifyCrewJwt(jwt: string): CrewSessionPayload | null {
  try {
    const [h, p, s] = jwt.split(".");
    if (!h || !p || !s) return null;
    const expected = b64url(createHmac("sha256", secret()).update(`${h}.${p}`).digest());
    if (!safeEqStr(s, expected)) return null;
    const payload = JSON.parse(b64urlDecode(p).toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.crewId !== "string" || typeof payload.linkToken !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export const CREW_SESSION_TTL_SECONDS = 60 * 60; // 1 hour, refreshed on each authenticated request

export function mintFreshCrewSession(crewId: string, linkToken: string) {
  const exp = Math.floor(Date.now() / 1000) + CREW_SESSION_TTL_SECONDS;
  return { jwt: mintCrewJwt({ crewId, linkToken, exp }), expires_in: CREW_SESSION_TTL_SECONDS };
}

/** Extracts + verifies the crew session from a request's Authorization header. */
export function requireCrewSession(request: Request): CrewSessionPayload | null {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return null;
  return verifyCrewJwt(jwt);
}
