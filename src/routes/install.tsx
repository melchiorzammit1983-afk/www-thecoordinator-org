import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download, Smartphone, Apple, MonitorSmartphone, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

function InstallPage() {
  const [releases, setReleases] = useState<Releases | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    fetch("/releases.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => setReleases(r as Releases | null))
      .catch(() => setReleases(null));

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 pb-16">
      <header className="mx-auto max-w-5xl px-4 pt-12 text-center">
        <Badge variant="outline" className="mb-4">Install the Coordinator</Badge>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Get the apps
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
          Install the driver, client, and coordinator apps on any phone or
          computer. No app store required.
        </p>
      </header>

      <div className="mx-auto mt-10 grid max-w-5xl gap-6 px-4 md:grid-cols-3">
        {/* Driver — APK */}
        <Card className="flex flex-col p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-teal-900/10 text-teal-800">
              <Smartphone className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Driver</h2>
              <p className="text-xs text-muted-foreground">Android APK</p>
            </div>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Background GPS, push notifications, offline start-up. Requires
            Android 8 or later.
          </p>
          {releases?.driver.apk_url ? (
            <>
              <div className="mb-3 rounded-lg border bg-background p-3">
                <QRCodeSVG value={apkUrl} size={128} className="mx-auto" />
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Scan to install v{releases.driver.version}
                </p>
              </div>
              <Button asChild className="w-full">
                <a href={apkUrl} download>
                  <Download className="mr-2 h-4 w-4" /> Download APK
                </a>
              </Button>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              APK build coming soon. Ask your coordinator to send you the link
              once the first release is published.
            </div>
          )}
          <details className="mt-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Install instructions</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Tap the APK link on your Android phone.</li>
              <li>
                When Android asks, allow <span className="font-medium">Install unknown apps</span>
                {" "}for your browser.
              </li>
              <li>Open the app, sign in with your driver link.</li>
              <li>Allow <span className="font-medium">Location: Always</span> and Notifications when prompted.</li>
            </ol>
          </details>
        </Card>

        {/* Client — PWA */}
        <Card className="flex flex-col p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-teal-500/10 text-teal-600">
              <Apple className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Client</h2>
              <p className="text-xs text-muted-foreground">Installable PWA</p>
            </div>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Live trip tracking, chat with the driver, push updates. Works on
            iPhone (iOS 16.4+) and Android.
          </p>
          <div className="mb-3 rounded-lg border bg-background p-3">
            <QRCodeSVG value={clientUrl} size={128} className="mx-auto" />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Scan on your phone
            </p>
          </div>
          <Button asChild className="w-full" variant="outline">
            <a href={releases?.client.url ?? "/m/client"}>
              <ExternalLink className="mr-2 h-4 w-4" /> Open trip portal
            </a>
          </Button>
          <details className="mt-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Add to home screen</summary>
            <ul className="mt-2 space-y-2">
              <li>
                <span className="font-medium">iPhone:</span> open the trip
                link in Safari, tap the <span className="font-medium">Share</span> icon,
                then <span className="font-medium">Add to Home Screen</span>.
              </li>
              <li>
                <span className="font-medium">Android:</span> open the trip
                link in Chrome, tap the menu, then{" "}
                <span className="font-medium">Install app</span>.
              </li>
            </ul>
          </details>
        </Card>

        {/* Coordinator — PWA */}
        <Card className="flex flex-col p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
              <MonitorSmartphone className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Coordinator</h2>
              <p className="text-xs text-muted-foreground">Installable PWA</p>
            </div>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Full dispatch dashboard on desktop, tablet, or phone. Install as
            an app for a full-screen experience.
          </p>
          <div className="mb-3 rounded-lg border bg-background p-3">
            <QRCodeSVG value={coordinatorUrl} size={128} className="mx-auto" />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Scan on your phone
            </p>
          </div>
          {installEvent ? (
            <Button className="w-full" onClick={triggerInstall}>
              <Download className="mr-2 h-4 w-4" /> Install now
            </Button>
          ) : (
            <Button asChild className="w-full" variant="outline">
              <a href={releases?.coordinator.url ?? "/coordinator"}>
                <ExternalLink className="mr-2 h-4 w-4" /> Open dashboard
              </a>
            </Button>
          )}
          <details className="mt-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Add to home screen</summary>
            <ul className="mt-2 space-y-2">
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
            </ul>
          </details>
        </Card>
      </div>

      <footer className="mx-auto mt-16 max-w-5xl px-4 text-center text-xs text-muted-foreground">
        Client v{releases?.client.version ?? "…"} · Coordinator v
        {releases?.coordinator.version ?? "…"} · Driver v
        {releases?.driver.version ?? "…"}
      </footer>
    </div>
  );
}
