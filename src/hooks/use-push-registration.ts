import { useCallback, useEffect, useState } from "react";
import {
  currentPermission,
  disableWebPush,
  enableWebPush,
  isPushSupported,
  type PushRole,
} from "@/lib/push-client";

export type PushStatus =
  | "unsupported"
  | "denied"
  | "disabled"
  | "enabled"
  | "prompt";

export function usePushRegistration(opts: {
  role: PushRole;
  companyId?: string | null;
}) {
  const [status, setStatus] = useState<PushStatus>("prompt");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isPushSupported()) return setStatus("unsupported");
    const perm = currentPermission();
    if (perm === "unsupported") return setStatus("unsupported");
    if (perm === "denied") return setStatus("denied");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setStatus(sub ? "enabled" : perm === "granted" ? "disabled" : "prompt");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enableWebPush({
        role: opts.role,
        companyId: opts.companyId ?? null,
      });
      await refresh();
      return result;
    } finally {
      setBusy(false);
    }
  }, [opts.role, opts.companyId, refresh]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await disableWebPush();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { status, busy, enable, disable, refresh };
}
