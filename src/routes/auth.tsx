import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { whoAmI, requestPasswordReset } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";


export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — The Coordinators" },
      { name: "description", content: "Welcome to your hub — sign in to The Coordinators to run today's transfers." },
      { property: "og:title", content: "Sign in — The Coordinators" },
      { property: "og:description", content: "Welcome to your hub — sign in to The Coordinators to run today's transfers." },
      { property: "og:url", content: "https://www.thecoordinator.org/auth" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "https://www.thecoordinator.org/auth" }],
  }),
  component: AuthPage,
});

const credsSchema = z.object({
  phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Enter phone in international format, e.g. +35699123456"),
  password: z.string().min(8).max(128),
});


function AuthPage() {
  const navigate = useNavigate();
  const whoAmIFn = useServerFn(whoAmI);

  useEffect(() => {
    let cancelled = false;
    async function redirectSignedInUser() {
      const { data } = await supabase.auth.getSession();
      if (!data.session || cancelled) return;
      try {
        const identity = await whoAmIFn();
        if (!cancelled) navigate({ to: identity?.isAdmin ? "/admin" : "/coordinator", replace: true });
      } catch {
        if (!cancelled) navigate({ to: "/coordinator", replace: true });
      }
    }
    redirectSignedInUser();
    return () => {
      cancelled = true;
    };
  }, [navigate, whoAmIFn]);

  const greeting = useGreeting();

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950">
      {/* Malta map background */}
      <iframe
        title="Malta map"
        aria-hidden="true"
        tabIndex={-1}
        src="https://maps.google.com/maps?q=Malta&z=11&t=m&output=embed&iwloc=near"
        className="absolute inset-0 h-full w-full border-0 pointer-events-none select-none"
        loading="lazy"
      />
      {/* Wash: dim + brand tint so the map reads as texture, not content */}
      <div className="absolute inset-0 bg-gradient-to-br from-teal-950/85 via-slate-950/80 to-teal-900/85" />
      <div className="absolute inset-0 backdrop-blur-[2px]" />
      {/* Soft radial highlight behind the card */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-400/15 blur-3xl"
      />

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2 text-white/90 hover:text-white transition-colors">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 border border-white/20 backdrop-blur-md font-semibold text-sm tracking-tight">
              tC
            </span>
            <span className="text-sm font-medium tracking-wide">The Coordinators</span>
          </Link>
          <div className="hidden sm:block text-[11px] uppercase tracking-[0.2em] text-white/60">
            Operations hub
          </div>
        </header>

        <main className="flex-1 grid place-items-center px-4 pb-16">
          <div className="w-full max-w-md">
            <div className="mb-6 text-center text-white">
              <div className="text-[11px] uppercase tracking-[0.3em] text-teal-200/80">{greeting}</div>
              <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">Welcome to your hub</h1>
              <p className="mt-2 text-sm text-white/70">Let's make it a better day for every crew on the road.</p>
            </div>

            <Card className="border-white/15 bg-white/95 backdrop-blur-xl shadow-2xl shadow-teal-950/40 rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">Log in</CardTitle>
                <CardDescription>Use the phone number and password from your administrator.</CardDescription>
              </CardHeader>
              <CardContent>
                <SignInForm />
              </CardContent>
            </Card>

            <p className="text-xs text-white/60 text-center mt-6">
              <Link to="/" className="hover:text-white transition-colors">Back to homepage</Link>
            </p>
          </div>
        </main>

        <footer className="relative z-10 px-6 pb-6">
          <div className="mx-auto max-w-md flex items-center justify-between text-[11px] text-white/50">
            <Link to="/admin-auth" className="inline-flex items-center gap-1.5 hover:text-white transition-colors">
              <span aria-hidden>🔒</span> Admin sign in
            </Link>
            <span className="tracking-wider uppercase">Malta · Operations</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function useGreeting() {
  const [g, setG] = useState("Welcome back");
  useEffect(() => {
    const h = new Date().getHours();
    setG(h < 5 ? "Good night shift" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night shift");
  }, []);
  return g;
}


function SignInForm() {
  const [phone, setPhone] = useState("+");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const whoAmIFn = useServerFn(whoAmI);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = credsSchema.safeParse({ phone: phone.trim(), password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const digits = parsed.data.phone.replace(/[^\d]/g, "");
    const email = `p${digits}@phone.crewchange.local`;
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });
    setLoading(false);
    if (error) {
      toast.error("Invalid phone number or password");
      return;
    }

    toast.success("Signed in");
    try {
      const identity = await whoAmIFn();
      window.location.assign(identity?.isAdmin ? "/admin" : "/coordinator");
    } catch {
      window.location.assign("/coordinator");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="si-phone">Phone number</Label>
        <Input
          id="si-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+35699123456"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">Include country code, e.g. +356 for Malta.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="si-password">Password</Label>
        <Input id="si-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
      <div className="text-center">
        <ForgotPasswordDialog defaultPhone={phone} />
      </div>
    </form>
  );
}

function ForgotPasswordDialog({ defaultPhone }: { defaultPhone: string }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(defaultPhone || "+");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const resetFn = useServerFn(requestPasswordReset);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().trim().regex(/^\+[1-9]\d{6,14}$/).safeParse(phone.trim());
    if (!parsed.success) return toast.error("Enter phone in international format, e.g. +35699123456");
    setLoading(true);
    try {
      await resetFn({ data: { phone: parsed.data } });
      setSubmitted(true);
      toast.success("Request submitted");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not submit request");
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setOpen(false);
    setSubmitted(false);
    setPhone(defaultPhone || "+");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
        Forgot password?
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a password reset</DialogTitle>
          <DialogDescription>
            Submit your phone number and an admin will contact you to verify your identity before issuing a new temporary password.
          </DialogDescription>
        </DialogHeader>
        {submitted ? (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/50 p-3 text-sm">
              Request submitted. An admin will contact you at your registered phone number with a new temporary password once they've confirmed your identity.
            </div>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fp-phone">Phone number</Label>
              <Input id="fp-phone" type="tel" inputMode="tel" placeholder="+35699123456" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={loading}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? "Submitting…" : "Submit request"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}




