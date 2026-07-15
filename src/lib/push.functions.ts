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
