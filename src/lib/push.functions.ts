import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(
  async () => {
    return { publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
  },
);


const PlatformEnum = z.enum(["web", "android", "ios"]);
const RoleEnum = z.enum(["driver", "client", "coordinator", "admin"]);

const RegisterInput = z
  .object({
    platform: PlatformEnum,
    role: RoleEnum,
    company_id: z.string().uuid().nullish(),
    user_agent: z.string().max(500).nullish(),
    // Native FCM / APNs token
    token: z.string().min(10).max(4096).nullish(),
    // Web Push subscription
    endpoint: z.string().url().max(2000).nullish(),
    p256dh: z.string().min(10).max(500).nullish(),
    auth: z.string().min(4).max(500).nullish(),
  })
  .refine(
    (v) => !!v.token || (!!v.endpoint && !!v.p256dh && !!v.auth),
    "Provide either a native token or a full web-push subscription (endpoint + p256dh + auth).",
  );

export const registerPushDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => RegisterInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Dedup key: native token when present, otherwise endpoint.
    const dedupToken = data.token ?? null;
    const dedupEndpoint = data.endpoint ?? null;

    // Find existing row for this user + identity to avoid duplicates.
    let existingId: string | null = null;
    if (dedupToken) {
      const { data: row } = await supabase
        .from("push_devices")
        .select("id")
        .eq("user_id", userId)
        .eq("token", dedupToken)
        .maybeSingle();
      existingId = row?.id ?? null;
    } else if (dedupEndpoint) {
      const { data: row } = await supabase
        .from("push_devices")
        .select("id")
        .eq("user_id", userId)
        .eq("endpoint", dedupEndpoint)
        .maybeSingle();
      existingId = row?.id ?? null;
    }

    const now = new Date().toISOString();
    const payload = {
      user_id: userId,
      company_id: data.company_id ?? null,
      role: data.role,
      platform: data.platform,
      token: data.token ?? null,
      endpoint: data.endpoint ?? null,
      p256dh: data.p256dh ?? null,
      auth: data.auth ?? null,
      user_agent: data.user_agent ?? null,
      last_seen_at: now,
      updated_at: now,
    };

    if (existingId) {
      const { data: updated, error } = await supabase
        .from("push_devices")
        .update(payload)
        .eq("id", existingId)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: updated.id, created: false };
    }

    const { data: inserted, error } = await supabase
      .from("push_devices")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id, created: true };
  });

export const unregisterPushDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        token: z.string().optional(),
        endpoint: z.string().url().optional(),
      })
      .refine((v) => !!(v.id || v.token || v.endpoint), "id, token, or endpoint required")
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase.from("push_devices").delete().eq("user_id", userId);
    if (data.id) q = q.eq("id", data.id);
    else if (data.token) q = q.eq("token", data.token);
    else if (data.endpoint) q = q.eq("endpoint", data.endpoint);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyPushDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("push_devices")
      .select("id, role, platform, user_agent, last_seen_at, created_at, endpoint, token")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false });
    if (error) throw new Error(error.message);
    // Mask secrets — return only presence + a short suffix so users can tell devices apart.
    return (data ?? []).map((d) => ({
      id: d.id,
      role: d.role,
      platform: d.platform,
      user_agent: d.user_agent,
      last_seen_at: d.last_seen_at,
      created_at: d.created_at,
      transport: d.token ? "native" : "web",
      tag: (d.token ?? d.endpoint ?? "").slice(-8),
    }));
  });

export const touchPushDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("push_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const PrefsSchema = z
  .object({
    new_job: z.boolean().optional(),
    job_updated: z.boolean().optional(),
    boarding: z.boolean().optional(),
    safety: z.boolean().optional(),
    chat: z.boolean().optional(),
    route_optimization: z.boolean().optional(),
    waiting: z.boolean().optional(),
    driver_status: z.boolean().optional(),
    trip_lifecycle: z.boolean().optional(),
    security: z.boolean().optional(),
  })
  .strict();

export const getNotificationPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PrefsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();
    const { data: existing } = await supabase
      .from("notification_preferences")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("notification_preferences")
        .update({ ...data, updated_at: now })
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("notification_preferences")
        .insert({ user_id: userId, ...data, updated_at: now });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// -----------------------------------------------------------------------------
// sendPushToUser — fan-out a notification to every registered device for a user.
//
// Web Push (endpoint + p256dh + auth): encrypted via VAPID and delivered by
// fetch to the subscription endpoint. FCM native tokens (Android/iOS): posted
// to FCM HTTP v1 legacy endpoint when FCM_SERVER_KEY is configured.
//
// The result is a per-device delivery report and each attempt is written to
// public.notification_log. Expired / gone subscriptions (404/410) are pruned.
// -----------------------------------------------------------------------------

const PushPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500).optional().default(""),
  category: z
    .enum([
      "new_job",
      "job_updated",
      "boarding",
      "safety",
      "chat",
      "route_optimization",
      "waiting",
      "driver_status",
      "trip_lifecycle",
      "security",
      "generic",
    ])
    .default("generic"),
  url: z.string().max(500).optional(),
  data: z.record(z.string(), z.any()).optional(),
  ttl: z.number().int().min(0).max(60 * 60 * 24 * 7).optional(),
  urgency: z.enum(["very-low", "low", "normal", "high"]).optional(),
});

const SendInput = z.object({
  user_id: z.string().uuid(),
  payload: PushPayloadSchema,
});

export type SendPushResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  pruned: number;
  results: Array<{
    device_id: string;
    transport: "web" | "native";
    ok: boolean;
    status?: number;
    error?: string;
  }>;
};

/**
 * Internal helper — safe to call from other server function handlers.
 * Uses the service-role client so it can read all devices regardless of RLS.
 */
export async function sendPushToUserImpl(
  userId: string,
  payload: z.infer<typeof PushPayloadSchema>,
): Promise<SendPushResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const webpush = (await import("web-push")).default;

  const vapidPub = process.env.VAPID_PUBLIC_KEY;
  const vapidPriv = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@thecoordinator.org";
  const fcmServerKey = process.env.FCM_SERVER_KEY;

  if (vapidPub && vapidPriv) {
    try {
      webpush.setVapidDetails(vapidSubject, vapidPub, vapidPriv);
    } catch {
      /* invalid keys — web-push disabled below */
    }
  }

  // Respect the user's per-category notification preference.
  const { data: prefs } = await supabaseAdmin
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const category = payload.category;
  const catKey = category as keyof typeof prefs;
  if (prefs && category !== "generic" && category !== "security" && (prefs as any)[catKey] === false) {
    return { attempted: 0, succeeded: 0, failed: 0, pruned: 0, results: [] };
  }

  const { data: devices, error } = await supabaseAdmin
    .from("push_devices")
    .select("id, company_id, platform, token, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const list = devices ?? [];
  const result: SendPushResult = {
    attempted: list.length,
    succeeded: 0,
    failed: 0,
    pruned: 0,
    results: [],
  };
  if (list.length === 0) return result;

  const bodyPayload = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    category: payload.category,
    url: payload.url ?? null,
    data: payload.data ?? {},
    ts: Date.now(),
  });

  type LogRow = {
    user_id: string;
    company_id: string | null;
    device_id: string;
    category: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    sent_at: string;
    delivered_at: string | null;
    error: string | null;
  };
  const logRows: LogRow[] = [];
  const pruneIds: string[] = [];

  await Promise.all(
    list.map(async (d) => {
      const isWeb = !!(d.endpoint && d.p256dh && d.auth);
      const transport: "web" | "native" = isWeb ? "web" : "native";
      let ok = false;
      let status: number | undefined;
      let errMsg: string | undefined;

      try {
        if (isWeb) {
          if (!vapidPub || !vapidPriv) throw new Error("VAPID not configured");
          const details = webpush.generateRequestDetails(
            {
              endpoint: d.endpoint!,
              keys: { p256dh: d.p256dh!, auth: d.auth! },
            },
            bodyPayload,
            {
              TTL: payload.ttl ?? 60 * 60 * 12,
              urgency: payload.urgency,
              contentEncoding: "aes128gcm",
            },
          );
          const res = await fetch(details.endpoint, {
            method: details.method,
            headers: details.headers as Record<string, string>,
            body: details.body as unknown as BodyInit,
          });
          status = res.status;
          ok = res.ok;
          if (!ok) {
            errMsg = `web-push ${res.status}`;
            if (res.status === 404 || res.status === 410) pruneIds.push(d.id);
          }
        } else if (d.token) {
          if (!fcmServerKey) throw new Error("FCM_SERVER_KEY not configured");
          const res = await fetch("https://fcm.googleapis.com/fcm/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `key=${fcmServerKey}`,
            },
            body: JSON.stringify({
              to: d.token,
              priority: payload.urgency === "high" ? "high" : "normal",
              time_to_live: payload.ttl ?? 60 * 60 * 12,
              notification: { title: payload.title, body: payload.body ?? "" },
              data: {
                category: payload.category,
                url: payload.url ?? "",
                ...(payload.data ?? {}),
              },
            }),
          });
          status = res.status;
          const json = (await res.json().catch(() => ({}))) as {
            failure?: number;
            results?: Array<{ error?: string }>;
          };
          ok = res.ok && (json.failure ?? 0) === 0;
          if (!ok) {
            const fcmErr = json.results?.[0]?.error;
            errMsg = fcmErr ? `fcm ${fcmErr}` : `fcm ${res.status}`;
            if (
              fcmErr === "NotRegistered" ||
              fcmErr === "InvalidRegistration" ||
              fcmErr === "MismatchSenderId"
            ) {
              pruneIds.push(d.id);
            }
          }
        } else {
          throw new Error("Device has no delivery target");
        }
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
        ok = false;
      }

      if (ok) result.succeeded += 1;
      else result.failed += 1;

      result.results.push({ device_id: d.id, transport, ok, status, error: errMsg });

      logRows.push({
        user_id: userId,
        company_id: d.company_id ?? null,
        device_id: d.id,
        category: payload.category,
        title: payload.title,
        body: payload.body ?? "",
        data: payload.data ?? {},
        sent_at: new Date().toISOString(),
        delivered_at: ok ? new Date().toISOString() : null,
        error: ok ? null : errMsg ?? null,
      });
    }),
  );

  if (logRows.length > 0) {
    await supabaseAdmin.from("notification_log").insert(logRows as never);
  }
  if (pruneIds.length > 0) {
    await supabaseAdmin.from("push_devices").delete().in("id", pruneIds);
    result.pruned = pruneIds.length;
  }

  return result;
}

/**
 * Admin-only RPC wrapper around sendPushToUserImpl. App code should import
 * sendPushToUserImpl directly from another server function's `.handler()`
 * body — this exposed RPC exists for testing and admin tooling.
 */
export const sendPushToUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SendInput.parse(data))
  .handler(async ({ data, context }) => {
    // Verify the caller is an admin before allowing arbitrary user targeting.
    const { data: emailRow } = await context.supabase
      .from("admin_emails")
      .select("email")
      .limit(1);
    const isAdmin = Array.isArray(emailRow) && emailRow.length > 0
      ? true
      : false;
    // admin_emails is readable to admins via RLS; a non-admin gets an empty set.
    if (!isAdmin && data.user_id !== context.userId) {
      throw new Error("Forbidden: only admins may push to other users");
    }
    return sendPushToUserImpl(data.user_id, data.payload);
  });
