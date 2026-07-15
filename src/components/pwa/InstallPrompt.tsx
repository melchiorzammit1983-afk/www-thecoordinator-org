import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { X, Download, Smartphone } from "lucide-react";

type Role = "driver" | "client" | "coordinator";

// Non-standard browser event; typed loosely to keep this vendor-agnostic.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function roleFromPath(pathname: string): Role {
  if (pathname.startsWith("/m/driver") || pathname.startsWith("/coordinator/my-driving")) return "driver";
  if (
    pathname.startsWith("/m/client") ||
    pathname.startsWith("/c/") ||
    pathname.startsWith("/t/") ||
    pathname.startsWith("/track/") ||
    pathname.startsWith("/portal/") ||
    pathname.startsWith("/h/")
  ) return "client";
  return "coordinator";
}

const COPY: Record<Role, { title: string; body: string }> = {
  driver: { title: "Install Coordinator Driver", body: "Add the driver app for faster start-up and background GPS." },
  client: { title: "Install Trip Portal", body: "Save the trip portal to your home screen for one-tap access." },
  coordinator: { title: "Install Coordinator", body: "Install the dashboard as an app for a full-screen experience." },
};

const DISMISS_KEY = "cc.pwa.install.dismissed";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function wasRecentlyDismissed(role: Role): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, number>;
    const t = parsed?.[role];
    return typeof t === "number" && Date.now() - t < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function persistDismiss(role: Role) {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    parsed[role] = Date.now();
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(parsed));
  } catch { /* ignore */ }
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function InstallPrompt() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const role = roleFromPath(pathname);
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (wasRecentlyDismissed(role)) return;

    if (isIOS()) {
      const timer = setTimeout(() => setShowIOSHint(true), 2500);
      return () => clearTimeout(timer);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [role]);

  if (dismissed || (!event && !showIOSHint)) return null;

  const copy = COPY[role];

  async function accept() {
    if (!event) return;
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") {
      setEvent(null);
    } else {
      persistDismiss(role);
      setDismissed(true);
    }
  }

  function dismiss() {
    persistDismiss(role);
    setDismissed(true);
  }

  return (
    <div
      className="fixed inset-x-2 bottom-16 z-50 mx-auto max-w-md rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur md:bottom-4"
      role="dialog"
      aria-label={copy.title}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{copy.title}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.body}</p>
          {showIOSHint ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Tap the <span className="font-medium">Share</span> icon, then{" "}
              <span className="font-medium">Add to Home Screen</span>.
            </p>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={accept} className="h-8">
                <Download className="mr-1.5 h-3.5 w-3.5" /> Install
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss} className="h-8">
                Not now
              </Button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
