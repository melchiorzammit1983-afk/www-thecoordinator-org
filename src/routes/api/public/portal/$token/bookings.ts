import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolvePortalByToken, checkRateLimit, getAdmin } from "@/lib/portal-token.server";

const BookingInput = z.object({
  from_location: z.string().min(1).max(200),
  to_location: z.string().min(1).max(200),
  from_place_id: z.string().max(200).nullable().optional(),
  from_lat: z.number().nullable().optional(),
  from_lng: z.number().nullable().optional(),
  to_place_id: z.string().max(200).nullable().optional(),
  to_lat: z.number().nullable().optional(),
  to_lng: z.number().nullable().optional(),
  pickup_at: z.string().datetime().nullable().optional(),
  date: z.string().nullable().optional(),
  time: z.string().nullable().optional(),
  name: z.string().max(80).nullable().optional(),
  surname: z.string().max(80).nullable().optional(),
  client_email: z.string().email().nullable().optional(),
  client_phone: z.string().max(40).nullable().optional(),
  room_number: z.string().max(40).nullable().optional(),
  flight_number: z.string().max(20).nullable().optional(),
  pax_count: z.number().int().min(1).max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  agreed_price: z.number().min(0).nullable().optional(),
  currency: z.string().max(6).nullable().optional(),
});

export const Route = createFileRoute("/api/public/portal/$token/bookings")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(params.token, 30))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const body = await request.json().catch(() => ({}));
        // support single or bulk
        const bulk = z.object({
          bookings: z.array(BookingInput).min(1).max(200),
          created_by_email: z.string().email().optional(),
          created_by_name: z.string().max(120).optional(),
          batch_id: z.string().uuid().optional(),
        }).safeParse(body);
        const single = BookingInput.extend({
          created_by_email: z.string().email().optional(),
          created_by_name: z.string().max(120).optional(),
          batch_id: z.string().uuid().optional(),
        }).safeParse(body);
        if (!bulk.success && !single.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();

        // Every submission belongs to a batch (size 1 for the single-entry
        // form, size N for a grid submit) so the portal's own bookings list
        // can group "what she submitted together" — purely a portal-side
        // display concept, never surfaced on the coordinator's board.
        // Appending to an existing batch is only allowed while every row in
        // it is still pending (once the coordinator touches any row, the
        // batch is closed to new additions) and must belong to this portal.
        const requestedBatchId = bulk.success ? bulk.data.batch_id : single.data!.batch_id;
        let batchId = requestedBatchId ?? crypto.randomUUID();
        if (requestedBatchId) {
          const { data: existingBatchRows } = await admin.from("portal_bookings" as any)
            .select("status").eq("portal_company_id", r.portal.id).eq("batch_id", requestedBatchId);
          const stillOpen = (existingBatchRows ?? []).length > 0
            && (existingBatchRows as any[]).every((row) => row.status === "pending");
          if (!stillOpen) batchId = crypto.randomUUID();
        }

        const rows = bulk.success
          ? bulk.data.bookings.map((b) => ({
              portal_company_id: r.portal.id,
              payload: b,
              agreed_price: b.agreed_price ?? null,
              currency: b.currency ?? "EUR",
              created_by_email: bulk.data.created_by_email ?? null,
              created_by_name: bulk.data.created_by_name ?? null,
              status: "pending" as const,
              batch_id: batchId,
            }))
          : [{
              portal_company_id: r.portal.id,
              payload: single.data!,
              agreed_price: single.data!.agreed_price ?? null,
              currency: single.data!.currency ?? "EUR",
              created_by_email: single.data!.created_by_email ?? null,
              created_by_name: single.data!.created_by_name ?? null,
              status: "pending" as const,
              batch_id: batchId,
            }];

        const { data, error } = await admin.from("portal_bookings" as any).insert(rows as any).select("id");
        if (error) return Response.json({ error: error.message }, { status: 500 });

        // Best-effort push to the coordinator so a new booking doesn't sit
        // unnoticed until the dispatch board's next 20s poll — never blocks
        // the response on delivery.
        try {
          const { data: company } = await admin.from("companies").select("owner_user_id")
            .eq("id", r.portal.coordinator_company_id).maybeSingle();
          if ((company as any)?.owner_user_id) {
            const { sendPushToUserImpl } = await import("@/lib/push.functions");
            const count = rows.length;
            await sendPushToUserImpl((company as any).owner_user_id, {
              title: count > 1 ? `${count} new bookings — ${r.portal.name}` : `New booking — ${r.portal.name}`,
              body: "Awaiting your approval",
              category: "new_job",
              url: "/coordinator/calendar",
            });
          }
        } catch (e) {
          console.error("[portal bookings] coordinator push failed", e);
        }

        return Response.json({ ok: true, ids: (data ?? []).map((r: any) => r.id), batch_id: batchId });
      },
    },
  },
});
