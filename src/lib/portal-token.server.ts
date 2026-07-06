import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only helpers for the Company Portal:
 *  - Resolve a hotel magic token → portal_company (checks active/enabled/expiry).
 *  - Rate-limit writes per token per minute.
 *  - Mint / verify short-lived passenger JWTs after phone-last-4 or booking-ref check.
 *
 * MUST only be imported inside route/server-fn handlers (never at module scope
 * of a client-reachable file), because it imports the admin Supabase client.
 */

export async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type PortalCompany = {
  id: string;
  coordinator_company_id: string;
  name: string;
  kind: "hotel" | "agent" | "corporate";
  logo_url: string | null;
  brand_color: string | null;
  display_name_for_passenger: string | null;
  points_per_booking: number;
  active: boolean;
  link_enabled: boolean;
  link_expires_at: string | null;
  magic_token: string;
  notification_email: string | null;
  contact_email: string | null;
};

function safeEqStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function resolvePortalByToken(token: string): Promise<
  | { ok: true; portal: PortalCompany }
  | { ok: false; status: number; error: string }
> {
  if (!token || token.length < 20 || token.length > 128) {
    return { ok: false, status: 400, error: "invalid_token" };
  }
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("portal_companies")
    .select(
      "id, coordinator_company_id, name, kind, logo_url, brand_color, display_name_for_passenger, points_per_booking, active, link_enabled, link_expires_at, magic_token, notification_email, contact_email",
    )
    .eq("magic_token", token)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "db_error" };
  if (!data) return { ok: false, status: 404, error: "not_found" };
  if (!safeEqStr(data.magic_token, token)) return { ok: false, status: 404, error: "not_found" };
  if (!data.active) return { ok: false, status: 403, error: "portal_disabled" };
  if (!data.link_enabled) return { ok: false, status: 403, error: "link_off" };
  if (data.link_expires_at && new Date(data.link_expires_at).getTime() < Date.now())
    return { ok: false, status: 403, error: "link_expired" };
  return { ok: true, portal: data as PortalCompany };
}

/** Simple per-token per-minute write cap. Returns false if over limit. */
export async function checkRateLimit(token: string, limit = 60): Promise<boolean> {
  const admin = await getAdmin();
  const bucket = Math.floor(Date.now() / 60_000);
  const { data: existing } = await admin
    .from("portal_rate_limits" as any)
    .select("count")
    .eq("token", token)
    .eq("minute_bucket", bucket)
    .maybeSingle();
  const next = ((existing as any)?.count ?? 0) + 1;
  if (next > limit) return false;
  await admin
    .from("portal_rate_limits" as any)
    .upsert({ token, minute_bucket: bucket, count: next } as any, { onConflict: "token,minute_bucket" });
  return true;
}

// ---------- Passenger token JWT (HS256) ----------

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

export function mintPaxJwt(payload: { token: string; jobId: string; exp: number }): string {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret()).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

export function verifyPaxJwt(jwt: string): { token: string; jobId: string; exp: number } | null {
  try {
    const [h, p, s] = jwt.split(".");
    if (!h || !p || !s) return null;
    const expected = b64url(createHmac("sha256", secret()).update(`${h}.${p}`).digest());
    if (!safeEqStr(s, expected)) return null;
    const payload = JSON.parse(b64urlDecode(p).toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.token !== "string" || typeof payload.jobId !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}
