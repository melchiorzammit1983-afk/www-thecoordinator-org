import { createFileRoute } from "@tanstack/react-router";
import { portalOperationActionSchema } from "@/lib/portal-operation-schemas";
import { loadPortalOperations, performPortalOperationAction } from "@/lib/portal-operations.server";
import { checkRateLimit, getAdmin, resolvePortalByToken } from "@/lib/portal-token.server";

export const Route = createFileRoute("/api/public/portal/$token/operations")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const resolved = await resolvePortalByToken(params.token, request);
        if (!resolved.ok)
          return Response.json({ error: resolved.error }, { status: resolved.status });
        try {
          return Response.json(await loadPortalOperations(await getAdmin(), resolved.portal));
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "operations_load_failed" },
            { status: 500 },
          );
        }
      },
      POST: async ({ params, request }) => {
        const resolved = await resolvePortalByToken(params.token, request);
        if (!resolved.ok)
          return Response.json({ error: resolved.error }, { status: resolved.status });
        if (!(await checkRateLimit(params.token, 45))) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }
        const parsed = portalOperationActionSchema.safeParse(
          await request.json().catch(() => ({})),
        );
        if (!parsed.success) {
          return Response.json(
            { error: "bad_input", issues: parsed.error.flatten() },
            { status: 400 },
          );
        }
        try {
          return Response.json(
            await performPortalOperationAction({
              admin: await getAdmin(),
              portal: resolved.portal,
              side: "client",
              input: parsed.data,
            }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "operation_action_failed";
          const status = message === "revision_conflict" ? 409 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
