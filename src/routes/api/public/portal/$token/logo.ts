import { createFileRoute } from "@tanstack/react-router";
import { resolvePortalByToken, checkRateLimit, getAdmin } from "@/lib/portal-token.server";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/**
 * POST /api/public/portal/$token/logo — lets the HR/corporate contact upload
 * their own logo directly from their portal dashboard, instead of having to
 * ask the coordinator to do it from the coordinator-side portal management
 * page (which already supports this via a direct authenticated upload).
 * Same "portal-logos" storage bucket, same public-URL convention.
 */
export const Route = createFileRoute("/api/public/portal/$token/logo")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token, request);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(params.token, 10))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!file || !(file instanceof File)) return Response.json({ error: "bad_input" }, { status: 400 });
        const ext = ALLOWED_TYPES[file.type];
        if (!ext) return Response.json({ error: "unsupported_type" }, { status: 400 });
        if (file.size > MAX_LOGO_BYTES) return Response.json({ error: "too_large" }, { status: 400 });

        const admin = await getAdmin();
        const path = `${r.portal.id}/logo.${ext}`;
        const { error: upErr } = await admin.storage
          .from("portal-logos")
          .upload(path, await file.arrayBuffer(), { upsert: true, contentType: file.type });
        if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

        const { data: pub } = admin.storage.from("portal-logos").getPublicUrl(path);
        // Cache-bust so the coordinator/passenger view refreshes immediately
        // instead of serving a stale cached image at the same path.
        const logoUrl = `${pub.publicUrl}?v=${Date.now()}`;
        await admin.from("portal_companies" as any).update({ logo_url: logoUrl } as any).eq("id", r.portal.id);

        return Response.json({ ok: true, logo_url: logoUrl });
      },
    },
  },
});
