import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  checkRateLimit,
  getAdmin,
  hashPortalPassword,
  portalAccessCookie,
  resolvePortalRecordByHandles,
  verifyPortalPassword,
} from "@/lib/portal-token.server";

const Handle = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
const Input = z.object({
  coordinator: Handle,
  client: Handle,
  action: z.enum(["open", "login", "setup"]),
  password: z.string().min(8).max(128).optional(),
});

export const Route = createFileRoute("/api/public/portal/client-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Input.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ error: "invalid_address" }, { status: 400 });
        const { coordinator, client, action, password } = parsed.data;
        if (!(await checkRateLimit(`client-login:${coordinator}:${client}`, 12))) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }
        const resolved = await resolvePortalRecordByHandles(coordinator, client);
        if (!resolved.ok) {
          return Response.json(
            { error: "portal_not_found" },
            { status: resolved.status === 500 ? 500 : 404 },
          );
        }
        const portal = resolved.portal;
        const existing = portal.portal_company_passwords;
        if (!portal.password_required) {
          return Response.json({ ok: true, token: portal.magic_token });
        }
        if (action === "open") {
          return Response.json(
            { error: existing ? "password_required" : "password_setup_required" },
            { status: 409 },
          );
        }
        if (!password) return Response.json({ error: "password_required" }, { status: 400 });

        const admin = await getAdmin();
        if (action === "setup") {
          if (existing)
            return Response.json({ error: "password_already_created" }, { status: 409 });
          const passwordHash = await hashPortalPassword(password);
          const claimedAt = new Date().toISOString();
          const { error } = await admin.from("portal_company_passwords").insert({
            portal_company_id: portal.id,
            password_hash: passwordHash,
            claimed_at: claimedAt,
            failed_attempts: 0,
            locked_until: null,
          });
          if (error) {
            return Response.json(
              { error: error.code === "23505" ? "password_already_created" : "setup_failed" },
              { status: error.code === "23505" ? 409 : 500 },
            );
          }
          portal.portal_company_passwords = {
            password_hash: passwordHash,
            claimed_at: claimedAt,
            failed_attempts: 0,
            locked_until: null,
          };
          await admin.from("portal_link_events").insert({
            portal_company_id: portal.id,
            actor_kind: "portal",
            event: "client_password_created",
          });
          return Response.json(
            { ok: true, token: portal.magic_token },
            { headers: { "Set-Cookie": portalAccessCookie(request, portal) } },
          );
        }

        if (!existing) {
          return Response.json({ error: "password_setup_required" }, { status: 409 });
        }
        if (existing.locked_until && new Date(existing.locked_until).getTime() > Date.now()) {
          return Response.json(
            { error: "password_locked", locked_until: existing.locked_until },
            { status: 423 },
          );
        }
        if (!(await verifyPortalPassword(password, existing.password_hash))) {
          const { data: failures, error } = await admin.rpc("record_portal_password_failure", {
            p_portal_company_id: portal.id,
          });
          if (error || !failures?.[0]) {
            return Response.json({ error: "login_failed" }, { status: 500 });
          }
          return Response.json(
            {
              error: failures[0].locked_until ? "password_locked" : "invalid_password",
              attempts_remaining: Math.max(0, 5 - failures[0].failed_attempts),
              locked_until: failures[0].locked_until,
            },
            { status: failures[0].locked_until ? 423 : 401 },
          );
        }
        await admin
          .from("portal_company_passwords")
          .update({ failed_attempts: 0, locked_until: null })
          .eq("portal_company_id", portal.id);
        await admin.from("portal_link_events").insert({
          portal_company_id: portal.id,
          actor_kind: "portal",
          event: "client_password_login",
        });
        return Response.json(
          { ok: true, token: portal.magic_token },
          { headers: { "Set-Cookie": portalAccessCookie(request, portal) } },
        );
      },
    },
  },
});
