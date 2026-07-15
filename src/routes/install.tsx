import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Download,
  Smartphone,
  Apple,
  MonitorSmartphone,
  ExternalLink,
  Send,
  Copy,
  Check,
  MessageCircle,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/install")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Install — The Coordinator" },
      {
        name: "description",
        content:
          "Install the Coordinator apps — driver Android APK, client trip portal, and coordinator dashboard — on your phone, tablet, or laptop.",
      },
    ],
  }),
  component: InstallPage,
});

type Releases = {
  driver: { version: string; released_at: string | null; apk_url: string | null; notes: string };
  client: { version: string; released_at: string; url: string; notes: string };
  coordinator: { version: string; released_at: string; url: string; notes: string };
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "desktop";
type Role = "driver" | "client" | "coordinator";

function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function suggestedRole(platform: Platform): Role {
  if (platform === "android") return "driver";
  if (platform === "ios") return "client";
  return "coordinator";
}

function InstallPage() {
  const [releases, setReleases] = useState<Releases | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [activeRole, setActiveRole] = useState<Role>("coordinator");
  const [sendTo, setSendTo] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/releases.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => setReleases(r as Releases | null))
      .catch(() => setReleases(null));

    const p = detectPlatform();
    setPlatform(p);
    setActiveRole(suggestedRole(p));

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function triggerInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  }

  const clientUrl = absoluteUrl(releases?.client.url ?? "/m/client");
  const coordinatorUrl = absoluteUrl(releases?.coordinator.url ?? "/coordinator");
  const apkUrl = releases?.driver.apk_url
    ? absoluteUrl(releases.driver.apk_url)
    : absoluteUrl("/downloads/driver-latest.apk");

  const installPageUrl = useMemo(() => absoluteUrl("/install"), []);

  const linkForRole: Record<Role, string> = {
    driver: apkUrl,
    client: clientUrl,
    coordinator: coordinatorUrl,
  };

  const shareText = `Install The Coordinator (${activeRole} app): ${linkForRole[activeRole]}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(linkForRole[activeRole]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy — long-press the link to copy");
    }
  }

  async function nativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "The Coordinator",
          text: `Install the ${activeRole} app`,
          url: linkForRole[activeRole],
        });
      } catch {
        /* user cancelled */
      }
    } else {
      copyLink();
    }
  }

  function sendSms() {
    const num = sendTo.replace(/[^\d+]/g, "");
    if (!num) {
      toast.error("Enter a phone number first");
      return;
    }
    window.location.href = `sms:${num}?&body=${encodeURIComponent(shareText)}`;
  }

  function sendWhatsapp() {
    const num = sendTo.replace(/[^\d]/g, "");
    const base = num
      ? `https://wa.me/${num}?text=`
      : `https://wa.me/?text=`;
    window.open(base + encodeURIComponent(shareText), "_blank");
  }

  function sendEmail() {
    if (!sendTo.includes("@")) {
      toast.error("Enter an email address first");
      return;
    }
    window.location.href = `mailto:${sendTo}?subject=${encodeURIComponent(
      "Install The Coordinator",
    )}&body=${encodeURIComponent(shareText)}`;
  }

  const roles: Array<{ id: Role; label: string; icon: typeof Smartphone }> = [
    { id: "driver", label: "Driver", icon: Smartphone },
    { id: "client", label: "Client", icon: Apple },
    { id: "coordinator", label: "Coordinator", icon: MonitorSmartphone },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 pb-16">
      <header className="mx-auto max-w-5xl px-4 pt-12 text-center">
        <Badge variant="outline" className="mb-4">Install the Coordinator</Badge>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Get the apps
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
          {platform === "ios"
            ? "We detected an iPhone — the client trip portal works best on iOS."
            : platform === "android"
            ? "We detected an Android device — install the driver APK or add the PWA to your home screen."
            : "Install as a full-screen app on any phone, tablet, or laptop. No app store required."}
        </p>
      </header>

      {/* Role tabs */}
      <div className="mx-auto mt-8 flex max-w-md gap-2 px-4">
        {roles.map((r) => {
          const Icon = r.icon;
          const isActive = activeRole === r.id;
          return (
            <button
              key={r.id}
              onClick={() => setActiveRole(r.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {r.label}
            </button>
          );
        })}
      </div>

      {/* Primary role card */}
      <div className="mx-auto mt-6 max-w-2xl px-4">
        {activeRole === "driver" && (
          <RoleCard
            title="Driver"
            subtitle="Android APK"
            description="Background GPS, push notifications, offline start-up. Requires Android 8 or later."
            qrValue={apkUrl}
            qrCaption={
              releases?.driver.apk_url
                ? `Scan to install v${releases.driver.version}`
                : "APK build coming soon"
            }
            primary={
              releases?.driver.apk_url ? (
                <Button asChild className="w-full">
                  <a href={apkUrl} download>
                    <Download className="mr-2 h-4 w-4" /> Download APK
                  </a>
                </Button>
              ) : null
            }
            instructions={
              <>
                <li>Tap the APK link on your Android phone.</li>
                <li>
                  When Android asks, allow{" "}
                  <span className="font-medium">Install unknown apps</span> for
                  your browser.
                </li>
                <li>Open the app, sign in with your driver link.</li>
                <li>
                  Allow <span className="font-medium">Location: Always</span>{" "}
                  and Notifications when prompted.
                </li>
              </>
            }
          />
        )}

        {activeRole === "client" && (
          <RoleCard
            title="Client"
            subtitle="Installable PWA"
            description="Live trip tracking, chat with the driver, push updates. Works on iPhone (iOS 16.4+) and Android."
            qrValue={clientUrl}
            qrCaption="Scan on your phone"
            primary={
              installEvent ? (
                <Button className="w-full" onClick={triggerInstall}>
                  <Download className="mr-2 h-4 w-4" /> Install now
                </Button>
              ) : (
                <Button asChild className="w-full" variant="outline">
                  <a href={releases?.client.url ?? "/m/client"}>
                    <ExternalLink className="mr-2 h-4 w-4" /> Open trip portal
                  </a>
                </Button>
              )
            }
            instructions={
              platform === "ios" ? (
                <>
                  <li>
                    Open this page in <span className="font-medium">Safari</span>.
                  </li>
                  <li>
                    Tap the <span className="font-medium">Share</span> icon at
                    the bottom.
                  </li>
                  <li>
                    Tap{" "}
                    <span className="font-medium">Add to Home Screen</span>{" "}
                    then <span className="font-medium">Add</span>.
                  </li>
                </>
              ) : (
                <>
                  <li>Open the trip link in Chrome.</li>
                  <li>
                    Tap the menu, then{" "}
                    <span className="font-medium">Install app</span>.
                  </li>
                </>
              )
            }
          />
        )}

        {activeRole === "coordinator" && (
          <RoleCard
            title="Coordinator"
            subtitle="Installable PWA"
            description="Full dispatch dashboard on desktop, tablet, or phone. Install as an app for a full-screen experience."
            qrValue={coordinatorUrl}
            qrCaption="Scan on your phone"
            primary={
              installEvent ? (
                <Button className="w-full" onClick={triggerInstall}>
                  <Download className="mr-2 h-4 w-4" /> Install now
                </Button>
              ) : (
                <Button asChild className="w-full" variant="outline">
                  <a href={releases?.coordinator.url ?? "/coordinator"}>
                    <ExternalLink className="mr-2 h-4 w-4" /> Open dashboard
                  </a>
                </Button>
              )
            }
            instructions={
              <>
                <li>
                  <span className="font-medium">Desktop Chrome / Edge:</span>{" "}
                  the address bar shows an install icon on the right.
                </li>
                <li>
                  <span className="font-medium">Android:</span> Chrome menu →{" "}
                  <span className="font-medium">Install app</span>.
                </li>
                <li>
                  <span className="font-medium">iPhone:</span> Safari →{" "}
                  <span className="font-medium">Share</span> →{" "}
                  <span className="font-medium">Add to Home Screen</span>.
                </li>
              </>
            }
          />
        )}
      </div>

      {/* Send to phone */}
      <div className="mx-auto mt-8 max-w-2xl px-4">
        <Card className="p-6">
          <div className="mb-3 flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Send install link to a phone</h3>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Text the {activeRole} install link to a driver or client — they tap
            once and they're in.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Phone number or email"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              className="flex-1"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={copyLink} title="Copy link">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button variant="outline" onClick={sendSms}>
                <MessageCircle className="mr-2 h-4 w-4" /> SMS
              </Button>
              <Button variant="outline" onClick={sendWhatsapp}>
                WhatsApp
              </Button>
              <Button variant="outline" onClick={sendEmail}>
                <Mail className="mr-2 h-4 w-4" /> Email
              </Button>
            </div>
          </div>
          {typeof navigator !== "undefined" && "share" in navigator ? (
            <Button variant="ghost" className="mt-3 w-full" onClick={nativeShare}>
              <Send className="mr-2 h-4 w-4" /> Share via…
            </Button>
          ) : null}
          <p className="mt-3 truncate text-xs text-muted-foreground">
            Link: <span className="font-mono">{linkForRole[activeRole]}</span>
          </p>
        </Card>
      </div>

      {/* Other roles quick access */}
      <div className="mx-auto mt-8 max-w-2xl px-4 text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Other apps
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {roles
            .filter((r) => r.id !== activeRole)
            .map((r) => (
              <Button
                key={r.id}
                variant="ghost"
                size="sm"
                onClick={() => setActiveRole(r.id)}
              >
                <r.icon className="mr-2 h-3.5 w-3.5" />
                {r.label} app
              </Button>
            ))}
        </div>
      </div>

      <footer className="mx-auto mt-16 max-w-5xl px-4 text-center text-xs text-muted-foreground">
        Client v{releases?.client.version ?? "…"} · Coordinator v
        {releases?.coordinator.version ?? "…"} · Driver v
        {releases?.driver.version ?? "…"} ·{" "}
        <a href={installPageUrl} className="underline">
          {installPageUrl}
        </a>
      </footer>
    </div>
  );
}

function RoleCard({
  title,
  subtitle,
  description,
  qrValue,
  qrCaption,
  primary,
  instructions,
}: {
  title: string;
  subtitle: string;
  description: string;
  qrValue: string;
  qrCaption: string;
  primary: React.ReactNode;
  instructions: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
          <Smartphone className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{description}</p>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="mx-auto rounded-lg border bg-background p-3 sm:mx-0">
          <QRCodeSVG value={qrValue} size={140} />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {qrCaption}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {primary}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">
              Install instructions
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4">{instructions}</ol>
          </details>
        </div>
      </div>
    </Card>
  );
}
