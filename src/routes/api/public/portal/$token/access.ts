import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  checkRateLimit,
  clearPortalAccessCookie,
  getAdmin,
  hashPortalPassword,
  hasPortalAccess,
  portalAccessCookie,
  resolvePortalRecordByToken,
  verifyPortalPassword,
} from "@/lib/portal-token.server";

const AccessInput = z.object({
  action: z.enum(["setup", "login", "logout"]),
  password: z.string().min(8).max(128).optional(),
});

export const Route = createFileRoute("/api/public/portal/$token/access")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const resolved = await resolvePortalRecordByToken(params.token);
        if (!resolved.ok)
          return Response.json({ error: resolved.error }, { status: resolved.status });
        const password = resolved.portal.portal_company_passwords;
        return Response.json({
          password_required: resolved.portal.password_required,
          setup_required: resolved.portal.password_required && !password,
          authenticated: hasPortalAccess(request, resolved.portal),
          locked_until: password?.locked_until ?? null,
        });
      },
      POST: async ({ params, request }) => {
        const resolved = await resolvePortalRecordByToken(params.token);
        if (!resolved.ok)
          return Response.json({ error: resolved.error }, { status: resolved.status });
        const parsed = AccessInput.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });
        if (parsed.data.action === "logout") {
          return Response.json(
            { ok: true },
            { headers: { "Set-Cookie": clearPortalAccessCookie(request, resolved.portal) } },
          );
        }
        if (!resolved.portal.password_required)
          return Response.json({ error: "password_not_required" }, { status: 409 });
        if (!(await checkRateLimit(params.token, 10)))
          return Response.json({ error: "rate_limited" }, { status: 429 });
        const password = parsed.data.password;
        if (!password) return Response.json({ error: "password_required" }, { status: 400 });

        const admin = await getAdmin();
        const existing = resolved.portal.portal_company_passwords;
        if (parsed.data.action === "setup") {
          if (existing)
            return Response.json({ error: "password_already_created" }, { status: 409 });
          const passwordHash = await hashPortalPassword(password);
          const claimedAt = new Date().toISOString();
          const { error } = await admin.from("portal_company_passwords").insert({
            portal_company_id: resolved.portal.id,
            password_hash: passwordHash,
            claimed_at: claimedAt,
            failed_attempts: 0,
            locked_until: null,
          });
          if (error) {
            if (error.code === "23505")
              return Response.json({ error: "password_already_created" }, { status: 409 });
            return Response.json({ error: "password_setup_failed" }, { status: 500 });
          }
          resolved.portal.portal_company_passwords = {
            password_hash: passwordHash,
            claimed_at: claimedAt,
            failed_attempts: 0,
            locked_until: null,
          };
          await admin.from("portal_link_events").insert({
            portal_company_id: resolved.portal.id,
            actor_kind: "portal",
            event: "client_password_created",
          });
          return Response.json(
            { ok: true },
            { headers: { "Set-Cookie": portalAccessCookie(request, resolved.portal) } },
          );
        }

        if (!existing) return Response.json({ error: "password_setup_required" }, { status: 409 });
        const now = Date.now();
        if (existing.locked_until && new Date(existing.locked_until).getTime() > now) {
          return Response.json(
            { error: "password_locked", locked_until: existing.locked_until },
            { status: 423 },
          );
        }
        const valid = await verifyPortalPassword(password, existing.password_hash);
        if (!valid) {
          const { data: failureRows, error: failureError } = await admin.rpc(
            "record_portal_password_failure",
            { p_portal_company_id: resolved.portal.id },
          );
          if (failureError || !failureRows?.[0]) {
            return Response.json({ error: "password_login_failed" }, { status: 500 });
          }
          const failedAttempts = failureRows[0].failed_attempts;
          const lockedUntil = failureRows[0].locked_until;
          return Response.json(
            {
              error: lockedUntil ? "password_locked" : "invalid_password",
              attempts_remaining: Math.max(0, 5 - failedAttempts),
              locked_until: lockedUntil,
            },
            { status: lockedUntil ? 423 : 401 },
          );
        }

        await admin
          .from("portal_company_passwords")
          .update({ failed_attempts: 0, locked_until: null })
          .eq("portal_company_id", resolved.portal.id);
        await admin.from("portal_link_events").insert({
          portal_company_id: resolved.portal.id,
          actor_kind: "portal",
          event: "client_password_login",
        });
        return Response.json(
          { ok: true },
          { headers: { "Set-Cookie": portalAccessCookie(request, resolved.portal) } },
        );
      },
    },
  },
});
