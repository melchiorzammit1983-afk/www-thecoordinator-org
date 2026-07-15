import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Listens for the `crewchange:sw-update` event dispatched by
 * `registerServiceWorker` and shows a "New version — refresh" toast.
 * On confirm we message the waiting worker to `skipWaiting`, then reload.
 */
export function UpdatePrompt() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    function onUpdate(e: Event) {
      const detail = (e as CustomEvent).detail as { registration?: ServiceWorkerRegistration };
      const waiting = detail?.registration?.waiting;
      toast("A new version is available", {
        description: "Refresh to get the latest updates.",
        action: {
          label: "Refresh",
          onClick: () => {
            if (waiting) {
              waiting.postMessage({ type: "SKIP_WAITING" });
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => window.location.reload(),
                { once: true },
              );
            } else {
              window.location.reload();
            }
          },
        },
        duration: 20000,
      });
    }

    window.addEventListener("crewchange:sw-update", onUpdate);
    return () => window.removeEventListener("crewchange:sw-update", onUpdate);
  }, []);

  return null;
}
