import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/client-portal/")({
  head: () => ({
    meta: [
      { title: "Client Portal sign in — The Coordinators" },
      {
        name: "description",
        content: "Open your company workspace with the coordinator and company names.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClientPortalSignIn,
});

type AccessMode = "address" | "login" | "setup";

function toHandle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 40);
}

function ClientPortalSignIn() {
  const [coordinator, setCoordinator] = useState("");
  const [client, setClient] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<AccessMode>("address");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const coordinatorHandle = toHandle(coordinator);
    const clientHandle = toHandle(client);
    if (coordinatorHandle.length < 3 || clientHandle.length < 3) {
      setMessage("Enter the coordinator company and your company name.");
      return;
    }
    if (mode !== "address" && password.length < 8) {
      setMessage("The password must contain at least 8 characters.");
      return;
    }
    if (mode === "setup" && password !== confirmPassword) {
      setMessage("The passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/portal/client-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinator: coordinatorHandle,
          client: clientHandle,
          action: mode === "address" ? "open" : mode,
          password: mode === "address" ? undefined : password,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.token) {
        window.location.assign(`/portal/${encodeURIComponent(payload.token)}`);
        return;
      }
      if (payload.error === "password_setup_required") {
        setMode("setup");
        setMessage("First visit: create the private password for your company.");
      } else if (
        payload.error === "password_required" ||
        payload.error === "password_already_created"
      ) {
        setMode("login");
        setMessage("Enter your company portal password.");
      } else if (payload.error === "invalid_password") {
        setMode("login");
        setMessage(`Incorrect password. ${payload.attempts_remaining ?? 0} attempts remaining.`);
      } else if (payload.error === "password_locked") {
        setMessage("Too many attempts. Try again after the temporary lock expires.");
      } else if (payload.error === "rate_limited") {
        setMessage("Too many attempts. Please wait and try again.");
      } else {
        setMessage("That client portal address is not active. Check both company names.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-950 via-teal-950 to-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/20 bg-white/10">
            <Building2 className="h-6 w-6 text-teal-200" />
          </div>
          <h1 className="mt-4 text-3xl font-semibold">Client Portal</h1>
          <p className="mt-2 text-sm text-white/70">
            Crew changes, visitors, approvals, messages and statements in one workspace.
          </p>
        </div>
        <Card className="border-white/20 bg-white/95 shadow-2xl">
          <CardHeader>
            <CardTitle>Open your company workspace</CardTitle>
            <CardDescription>This is separate from Coordinator Sign In.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-coordinator">Coordinator company</Label>
              <Input
                id="client-coordinator"
                value={coordinator}
                disabled={mode !== "address"}
                onChange={(event) => setCoordinator(event.target.value)}
                placeholder="Baygor Cab"
                autoComplete="organization"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-company">Your company</Label>
              <Input
                id="client-company"
                value={client}
                disabled={mode !== "address"}
                onChange={(event) => setClient(event.target.value)}
                placeholder="Saipem"
              />
            </div>
            {mode !== "address" && (
              <div className="space-y-1.5">
                <Label htmlFor="client-password">
                  {mode === "setup" ? "Create company password" : "Company password"}
                </Label>
                <Input
                  id="client-password"
                  type="password"
                  autoComplete={mode === "setup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            )}
            {mode === "setup" && (
              <div className="space-y-1.5">
                <Label htmlFor="client-password-confirm">Confirm password</Label>
                <Input
                  id="client-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
            )}
            {message && (
              <p className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
                {message}
              </p>
            )}
            <Button className="w-full" disabled={busy} onClick={() => void submit()}>
              <LockKeyhole className="mr-2 h-4 w-4" />
              {busy
                ? "Opening…"
                : mode === "setup"
                  ? "Create password & open portal"
                  : "Open Client Portal"}
            </Button>
            {mode !== "address" && (
              <Button
                className="w-full"
                variant="ghost"
                onClick={() => {
                  setMode("address");
                  setPassword("");
                  setConfirmPassword("");
                  setMessage("");
                }}
              >
                Use a different company
              </Button>
            )}
          </CardContent>
        </Card>
        <div className="mt-4 text-center">
          <Link to="/auth" className="text-sm text-white/70 hover:text-white">
            Coordinator Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
