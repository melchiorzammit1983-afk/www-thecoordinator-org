/**
 * Browser-side helpers for Web Push registration.
 *
 * Flow:
 *  1. Ensure a Service Worker is registered (see src/lib/pwa/register-sw.ts).
 *  2. Ask the browser for Notification permission.
 *  3. Subscribe with the VAPID public key (VITE_VAPID_PUBLIC_KEY).
 *  4. Send the subscription to the server via registerPushDevice.
 *
 * Native (Capacitor / FCM) tokens are registered by the driver APK using
 * the same server function with { platform: "android", token: <fcm_token> }.
 */
import {
  registerPushDevice,
  unregisterPushDevice,
} from "@/lib/push.functions";

export type PushRole = "driver" | "client" | "coordinator" | "admin";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function currentPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

function bufToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getReadyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  return await Notification.requestPermission();
}

/**
 * Subscribe this browser to Web Push and store the device on the server.
 * Idempotent — repeated calls with the same subscription update `last_seen_at`.
 */
export async function enableWebPush(opts: {
  role: PushRole;
  companyId?: string | null;
}): Promise<{ id: string; created: boolean } | null> {
  if (!isPushSupported()) return null;
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapid) {
    console.warn("[push] VITE_VAPID_PUBLIC_KEY not configured");
    return null;
  }

  const permission = await requestNotificationPermission();
  if (permission !== "granted") return null;

  const reg = await getReadyRegistration();
  if (!reg) return null;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });
  }

  const json = sub.toJSON();
  const endpoint = json.endpoint ?? sub.endpoint;
  const p256dh =
    json.keys?.p256dh ?? bufToBase64Url(sub.getKey("p256dh"));
  const auth = json.keys?.auth ?? bufToBase64Url(sub.getKey("auth"));

  if (!endpoint || !p256dh || !auth) return null;

  return await registerPushDevice({
    data: {
      platform: "web",
      role: opts.role,
      company_id: opts.companyId ?? null,
      user_agent: navigator.userAgent.slice(0, 500),
      endpoint,
      p256dh,
      auth,
    },
  });
}

/** Unsubscribe this browser from Web Push and remove the device server-side. */
export async function disableWebPush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await getReadyRegistration();
  const sub = await reg?.pushManager.getSubscription();
  const endpoint = sub?.endpoint;
  try {
    await sub?.unsubscribe();
  } catch {
    /* ignore */
  }
  if (endpoint) {
    try {
      await unregisterPushDevice({ data: { endpoint } });
    } catch (err) {
      console.warn("[push] unregister failed", err);
    }
  }
}

/**
 * Register a native FCM/APNs token from the Capacitor driver APK.
 * Call from a native push listener once the runtime hands you the token.
 */
export async function registerNativeToken(opts: {
  role: PushRole;
  platform: "android" | "ios";
  token: string;
  companyId?: string | null;
}): Promise<{ id: string; created: boolean } | null> {
  if (!opts.token) return null;
  return await registerPushDevice({
    data: {
      platform: opts.platform,
      role: opts.role,
      company_id: opts.companyId ?? null,
      token: opts.token,
      user_agent:
        typeof navigator !== "undefined"
          ? navigator.userAgent.slice(0, 500)
          : null,
    },
  });
}
