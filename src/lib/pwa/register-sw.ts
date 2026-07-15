// Guarded service-worker registration wrapper.
//
// Follows the Lovable PWA skill: never register in preview / iframe / dev /
// `?sw=off`; unregister matching workers in those contexts so a stale worker
// from a previous session cannot serve broken HTML.

const SW_PATH = "/sw.js";

function isRefusedContext(): { refused: boolean; reason: string } {
  if (typeof window === "undefined") return { refused: true, reason: "ssr" };
  if (!("serviceWorker" in navigator)) return { refused: true, reason: "unsupported" };
  if (!import.meta.env.PROD) return { refused: true, reason: "dev" };

  try {
    if (window.top !== window.self) return { refused: true, reason: "iframe" };
  } catch {
    return { refused: true, reason: "iframe-crossorigin" };
  }

  const host = window.location.hostname;
  const preview =
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev");
  if (preview) return { refused: true, reason: "preview" };

  const params = new URLSearchParams(window.location.search);
  if (params.get("sw") === "off") return { refused: true, reason: "kill-switch" };

  return { refused: false, reason: "" };
}

async function unregisterMatching(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL;
          return url ? new URL(url).pathname === SW_PATH : false;
        })
        .map((r) => r.unregister()),
    );
  } catch {
    /* noop */
  }
}

/**
 * Called from `src/start.ts` on the client. Safe to call more than once.
 * Also fires a `crewchange:sw-update` window event when a new worker becomes
 * waiting — `UpdatePrompt` listens for it.
 */
export function registerServiceWorker(): void {
  const gate = isRefusedContext();
  if (gate.refused) {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      void unregisterMatching();
    }
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SW_PATH, { scope: "/" })
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(
                new CustomEvent("crewchange:sw-update", { detail: { registration } }),
              );
            }
          });
        });
        setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
      })
      .catch(() => {
        /* registration failure is non-fatal */
      });
  });
}
