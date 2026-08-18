import { createFileRoute } from "@tanstack/react-router";

// Interim bridge for an external deployment (e.g. Vercel) that can't hold
// Lovable Cloud's service-role key directly. Hardened: the bridge secret is
// REQUIRED for every request (no anonymous relaying), only a small allow-list
// of Supabase API paths can be reached, and calls are rate limited per IP.

const ALLOWED_PREFIXES = ["rest/v1/", "auth/v1/", "storage/v1/"];

const RATE_LIMIT = 120; // requests
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return false;
  }
  b.count += 1;
  return b.count > RATE_LIMIT;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function proxy(request: Request, splat: string) {
  const SUPABASE_URL = process.env['SUPABASE_URL'];
  const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const BRIDGE_SECRET = process.env['ADMIN_BRIDGE_SECRET'];
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BRIDGE_SECRET) {
    return new Response("Bridge not configured", { status: 500 });
  }

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (rateLimited(ip)) return new Response("Too many requests", { status: 429 });

  // Authentication is mandatory — this is not an open relay.
  const presented = request.headers.get("x-bridge-secret") ?? request.headers.get("apikey") ?? "";
  if (!presented || !safeEqual(presented, BRIDGE_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const path = splat.replace(/^\/+/, "");
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p)) || path.includes("..")) {
    return new Response("Forbidden path", { status: 403 });
  }

  const incomingUrl = new URL(request.url);
  const target = `${SUPABASE_URL}/${path}${incomingUrl.search}`;

  // Auditable escalation: every service-role relay is logged.
  console.log(`[db-proxy] service-role relay ${request.method} /${path} ip=${ip}`);

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("x-bridge-secret");
  headers.set("apikey", SUPABASE_SERVICE_ROLE_KEY);
  headers.set("authorization", `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`);

  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  const upstream = await fetch(target, { method: request.method, headers, body, redirect: "manual" });

  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete("content-encoding");
  outHeaders.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export const Route = createFileRoute("/api/db-proxy/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxy(request, params._splat ?? ""),
      POST: ({ request, params }) => proxy(request, params._splat ?? ""),
      PATCH: ({ request, params }) => proxy(request, params._splat ?? ""),
      PUT: ({ request, params }) => proxy(request, params._splat ?? ""),
      DELETE: ({ request, params }) => proxy(request, params._splat ?? ""),
      HEAD: ({ request, params }) => proxy(request, params._splat ?? ""),
    },
  },
});
