import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

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
  kind: "hotel" | "agent" | "company_agent";
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
  client_slug: string | null;
  portal_definition_id: string | null;
  password_required: boolean;
  portals: {
    id: string;
    name: string;
    portal_type: string;
    status: string;
    configuration: Record<string, unknown> | null;
  } | null;
  portal_company_passwords: {
    password_hash: string;
    claimed_at: string;
    failed_attempts: number;
    locked_until: string | null;
  } | null;
};

function safeEqStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const PORTAL_TOKEN_SELECT = [
  "id",
  "coordinator_company_id",
  "name",
  "kind",
  "logo_url",
  "brand_color",
  "display_name_for_passenger",
  "points_per_booking",
  "active",
  "link_enabled",
  "link_expires_at",
  "magic_token",
  "notification_email",
  "contact_email",
  "client_slug",
  "portal_definition_id",
  "password_required",
  "portals(id,name,portal_type,status,configuration)",
  "portal_company_passwords(password_hash,claimed_at,failed_attempts,locked_until)",
].join(",");

function normalizePasswordRecord(
  value: PortalCompany["portal_company_passwords"] | PortalCompany["portal_company_passwords"][],
) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function validateResolvedPortal(
  data: unknown,
): { ok: true; portal: PortalCompany } | { ok: false; status: number; error: string } {
  if (!data) return { ok: false, status: 404, error: "not_found" };
  const portal = data as PortalCompany;
  if (!portal.active) return { ok: false, status: 403, error: "portal_disabled" };
  if (!portal.link_enabled) return { ok: false, status: 403, error: "link_off" };
  if (portal.link_expires_at && new Date(portal.link_expires_at).getTime() < Date.now())
    return { ok: false, status: 403, error: "link_expired" };
  portal.portal_company_passwords = normalizePasswordRecord(portal.portal_company_passwords);
  if (portal.portal_definition_id && (!portal.portals || portal.portals.status !== "active")) {
    return { ok: false, status: 403, error: "portal_configuration_disabled" };
  }
  return { ok: true, portal };
}

export async function resolvePortalRecordByToken(
  token: string,
): Promise<{ ok: true; portal: PortalCompany } | { ok: false; status: number; error: string }> {
  if (!token || token.length < 20 || token.length > 128) {
    return { ok: false, status: 400, error: "invalid_token" };
  }
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("portal_companies")
    .select(PORTAL_TOKEN_SELECT)
    .eq("magic_token", token)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "db_error" };
  if (!data) return { ok: false, status: 404, error: "not_found" };
  const portal = data as unknown as PortalCompany;
  if (!safeEqStr(portal.magic_token, token)) return { ok: false, status: 404, error: "not_found" };
  return validateResolvedPortal(portal);
}

export async function resolvePortalRecordByHandles(
  coordinatorHandle: string,
  clientHandle: string,
): Promise<{ ok: true; portal: PortalCompany } | { ok: false; status: number; error: string }> {
  const handlePattern = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
  const coordinator = coordinatorHandle.trim().toLowerCase();
  const client = clientHandle.trim().toLowerCase();
  if (!handlePattern.test(coordinator) || !handlePattern.test(client)) {
    return { ok: false, status: 400, error: "invalid_address" };
  }
  const admin = await getAdmin();
  let { data: company, error: companyError } = await admin
    .from("companies" as any)
    .select("id")
    .eq("portal_subdomain", coordinator)
    .maybeSingle();
  // Keep existing coordinator links working until the canonical handle is
  // populated on the company record.
  if (!company && !companyError) {
    ({ data: company, error: companyError } = await admin
      .from("companies" as any)
      .select("id")
      .eq("slug", coordinator)
      .maybeSingle());
  }
  if (companyError) return { ok: false, status: 500, error: "db_error" };
  if (!company) return { ok: false, status: 404, error: "not_found" };
  const companyRecord = company as unknown as { id: string };
  let { data, error } = await admin
    .from("portal_companies" as any)
    .select(PORTAL_TOKEN_SELECT)
    .eq("coordinator_company_id", companyRecord.id)
    .eq("client_slug", client)
    .maybeSingle();
  // Keep older portal links working when their record has not yet been
  // populated with the canonical client_slug field.
  if (!data && !error) {
    ({ data, error } = await admin
      .from("portal_companies" as any)
      .select(PORTAL_TOKEN_SELECT)
      .eq("coordinator_company_id", companyRecord.id)
      .eq("portal_slug", client)
      .maybeSingle());
  }
  if (error) return { ok: false, status: 500, error: "db_error" };
  return validateResolvedPortal(data);
}

export async function resolvePortalByToken(
  token: string,
  request?: Request,
): Promise<{ ok: true; portal: PortalCompany } | { ok: false; status: number; error: string }> {
  const resolved = await resolvePortalRecordByToken(token);
  if (!resolved.ok || !resolved.portal.password_required) return resolved;
  const password = normalizePasswordRecord(resolved.portal.portal_company_passwords);
  if (!password) return { ok: false, status: 401, error: "password_setup_required" };
  if (!request || !hasPortalAccess(request, resolved.portal)) {
    return { ok: false, status: 401, error: "password_required" };
  }
  return resolved;
}

const CHANGE_LOCK_HOURS = 3;

/**
 * Once a driver is assigned, edit/reschedule/cancel requests (from either
 * HR or the passenger) are locked starting `CHANGE_LOCK_HOURS` before
 * pickup — too close to disrupt without risking the driver already being
 * en route. Before a driver is assigned, there's nothing to disrupt yet, so
 * requests stay open regardless of how soon pickup is.
 */
export function isChangeLocked(
  job: { driver_id: string | null; pickup_at: string | null } | null | undefined,
): boolean {
  if (!job?.driver_id || !job.pickup_at) return false;
  const hoursUntilPickup = (new Date(job.pickup_at).getTime() - Date.now()) / 3_600_000;
  return hoursUntilPickup < CHANGE_LOCK_HOURS;
}

/** Simple per-token per-minute write cap. Returns false if over limit. */
export async function checkRateLimit(token: string, limit = 60): Promise<boolean> {
  const admin = await getAdmin();
  const bucket = Math.floor(Date.now() / 60_000);
  const { data: existing } = await admin
    .from("portal_rate_limits")
    .select("count")
    .eq("token", token)
    .eq("minute_bucket", bucket)
    .maybeSingle();
  const next = (existing?.count ?? 0) + 1;
  if (next > limit) return false;
  await admin
    .from("portal_rate_limits")
    .upsert({ token, minute_bucket: bucket, count: next }, { onConflict: "token,minute_bucket" });
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

const PORTAL_ACCESS_TTL_SECONDS = 8 * 60 * 60;

function portalAccessCookieName(token: string) {
  return `portal_access_${token.slice(0, 12)}`;
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function mintPortalAccess(portal: PortalCompany) {
  const password = normalizePasswordRecord(portal.portal_company_passwords);
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        portalId: portal.id,
        token: portal.magic_token,
        passwordClaimedAt: password?.claimed_at ?? null,
        exp: Math.floor(Date.now() / 1000) + PORTAL_ACCESS_TTL_SECONDS,
      }),
    ),
  );
  const signature = b64url(
    createHmac("sha256", secret()).update(`portal-access.${payload}`).digest(),
  );
  return `${payload}.${signature}`;
}

function verifyPortalAccess(value: string, portal: PortalCompany) {
  try {
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return false;
    const expected = b64url(
      createHmac("sha256", secret()).update(`portal-access.${payload}`).digest(),
    );
    if (!safeEqStr(signature, expected)) return false;
    const parsed = JSON.parse(b64urlDecode(payload).toString("utf8"));
    const password = normalizePasswordRecord(portal.portal_company_passwords);
    return (
      parsed.portalId === portal.id &&
      parsed.token === portal.magic_token &&
      parsed.passwordClaimedAt === (password?.claimed_at ?? null) &&
      typeof parsed.exp === "number" &&
      parsed.exp >= Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

export function hasPortalAccess(request: Request, portal: PortalCompany) {
  if (!portal.password_required) return true;
  const value = readCookie(request, portalAccessCookieName(portal.magic_token));
  return !!value && verifyPortalAccess(value, portal);
}

export function portalAccessCookie(request: Request, portal: PortalCompany) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${portalAccessCookieName(portal.magic_token)}=${encodeURIComponent(mintPortalAccess(portal))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PORTAL_ACCESS_TTL_SECONDS}${secure}`;
}

export function clearPortalAccessCookie(request: Request, portal: PortalCompany) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${portalAccessCookieName(portal.magic_token)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function derivePortalPassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPortalPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derivePortalPassword(password, salt);
  return `scrypt-v1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPortalPassword(password: string, stored: string) {
  try {
    const [version, saltValue, hashValue] = stored.split("$");
    if (version !== "scrypt-v1" || !saltValue || !hashValue) return false;
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await derivePortalPassword(password, Buffer.from(saltValue, "base64url"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
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
