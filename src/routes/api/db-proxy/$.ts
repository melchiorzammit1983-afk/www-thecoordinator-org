import { createFileRoute } from "@tanstack/react-router";

// Interim bridge for an external deployment (e.g. Vercel) that can't hold
// Lovable Cloud's service-role key directly — Lovable Cloud never exposes
// it, by design. This route runs on the Lovable-hosted deployment (which
// DOES have real access) and transparently forwards Supabase REST/Auth
// calls to the real project, swapping in the real service-role key only
// when the caller presents ADMIN_BRIDGE_SECRET. Any other apikey (e.g. the
// public anon key used for user-authenticated calls) passes through
// unchanged — that's already safe to expose directly, same as it is in the
// browser bundle.
async function proxy(request: Request, splat: string) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BRIDGE_SECRET = process.env.ADMIN_BRIDGE_SECRET;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BRIDGE_SECRET) {
    return new Response("Bridge not configured", { status: 500 });
  }

  const incomingUrl = new URL(request.url);
  const target = `${SUPABASE_URL}/${splat}${incomingUrl.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const incomingKey = request.headers.get("apikey") ?? "";
  if (incomingKey === BRIDGE_SECRET) {
    headers.set("apikey", SUPABASE_SERVICE_ROLE_KEY);
    headers.set("authorization", `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`);
  }

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
