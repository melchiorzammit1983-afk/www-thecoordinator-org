import { useEffect, useState } from "react";

type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

/**
 * Holds a Screen Wake Lock while `active` is true so the driver's phone
 * doesn't dim or sleep mid-trip. The lock is auto-released by the browser
 * whenever the tab is hidden, so we re-acquire on `visibilitychange` while
 * still active. Fails silently on unsupported browsers (older iOS Safari).
 */
export function useWakeLock(active: boolean): { supported: boolean; held: boolean } {
  const supported =
    typeof navigator !== "undefined" && "wakeLock" in navigator;
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!supported || !active) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        const s = (await (navigator as any).wakeLock.request("screen")) as WakeLockSentinel;
        if (cancelled) { try { await s.release(); } catch { /* ignore */ } return; }
        sentinel = s;
        setHeld(true);
        s.addEventListener("release", () => {
          sentinel = null;
          setHeld(false);
        });
      } catch {
        // Permission denied, tab hidden, etc. — swallow; we'll retry on visibility.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinel && active) {
        void request();
      }
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel && !sentinel.released) {
        sentinel.release().catch(() => { /* ignore */ });
      }
      sentinel = null;
      setHeld(false);
    };
  }, [supported, active]);

  return { supported, held };
}
