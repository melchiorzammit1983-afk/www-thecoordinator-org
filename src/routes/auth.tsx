import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import { Fingerprint, LifeBuoy, MessageCircle, Activity, Globe2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { whoAmI, requestPasswordReset } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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

const HERO_LINES = [
  "Let's make it a better day for every crew on the road.",
  "Every trip on time. Every driver in the loop.",
  "One island, one calendar, zero missed pickups.",
  "Coordinate calmly. The road takes care of itself.",
  "Small team, sharp ops. Let's roll.",
];

const LANGS = { EN: { hub: "Operations hub", welcome: "Welcome to your hub", login: "Log in", loading: "Signing in…" },
  MT: { hub: "Ċentru tal-operat", welcome: "Merħba fiċ-ċentru tiegħek", login: "Idħol", loading: "Qed nidħol…" },
  IT: { hub: "Hub operativo", welcome: "Benvenuto nel tuo hub", login: "Accedi", loading: "Accesso in corso…" } } as const;
type LangKey = keyof typeof LANGS;

function AuthPage() {
  const navigate = useNavigate();
  const whoAmIFn = useServerFn(whoAmI);
  const [lang, setLang] = useState<LangKey>("EN");
  const t = LANGS[lang];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || cancelled) return;
      try {
        const identity = await whoAmIFn();
        if (!cancelled) navigate({ to: identity?.isAdmin ? "/admin" : "/coordinator", replace: true });
      } catch {
        if (!cancelled) navigate({ to: "/coordinator", replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, whoAmIFn]);

  const greeting = useGreeting();
  const heroLine = useMemo(() => HERO_LINES[new Date().getDate() % HERO_LINES.length], []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950">
      {/* Fullscreen Malta map — always covers the viewport on any aspect ratio */}
      <div className="fixed inset-0 overflow-hidden">
        <iframe
          title="Malta map"
          aria-hidden="true"
          tabIndex={-1}
          src="https://www.google.com/maps?q=Malta&z=11&t=m&output=embed&iwloc=near"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-0 pointer-events-none select-none"
          style={{
            width: "max(140vw, 140vh)",
            height: "max(140vw, 140vh)",
            minWidth: "100vw",
            minHeight: "100vh",
          }}
          loading="eager"
        />
      </div>

      {/* Brand wash — keeps the card readable while letting the map show through */}
      <div className="fixed inset-0 bg-gradient-to-br from-teal-950/70 via-slate-950/60 to-teal-900/70" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(2,15,20,0.15)_0%,rgba(2,15,20,0.7)_80%)]" />


      {/* Live pulse dots over Malta hotspots */}
      <PulseDots />

      {/* Animated route line MLA → Valletta */}
      <RouteLine />

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2 text-white/95 hover:text-white transition-colors">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 border border-white/25 backdrop-blur-md font-semibold text-sm tracking-tight shadow-lg shadow-teal-950/40">
              tC
            </span>
            <span className="text-sm font-medium tracking-wide drop-shadow">The Coordinators</span>
          </Link>
          <div className="hidden sm:flex items-center gap-2 rounded-full bg-white/10 border border-white/20 backdrop-blur-md px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-white/85">
            <Activity className="h-3 w-3 text-emerald-300" />
            <span>{t.hub}</span>
            <span className="inline-flex items-center gap-1 ml-1 text-emerald-300 normal-case tracking-normal">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              live
            </span>
          </div>
        </header>

        <main className="flex-1 grid place-items-center px-4 pb-16">
          <div className="w-full max-w-md">
            <div className="mb-6 text-center text-white">
              <div className="text-[11px] uppercase tracking-[0.3em] text-teal-200/90 drop-shadow">{greeting}</div>
              <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight drop-shadow-lg">{t.welcome}</h1>
              <p className="mt-2 text-sm text-white/85 drop-shadow">{heroLine}</p>
            </div>

            <Card className="border-white/20 bg-white/95 backdrop-blur-xl shadow-2xl shadow-teal-950/50 rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">{t.login}</CardTitle>
                <CardDescription>Use the phone number and password from your administrator.</CardDescription>
              </CardHeader>
              <CardContent>
                <SignInForm loadingLabel={t.loading} loginLabel={t.login} />
              </CardContent>
            </Card>

            <div className="mt-4 flex items-center justify-center">
              <TroubleSheet />
            </div>
          </div>
        </main>

        <footer className="relative z-10 px-6 pb-6">
          <div className="mx-auto max-w-md flex items-center justify-between text-[11px] text-white/70">
            <Link to="/admin-auth" className="inline-flex items-center gap-1.5 hover:text-white transition-colors">
              <span aria-hidden>🔒</span> Admin sign in
            </Link>
            <LangSwitch lang={lang} onChange={setLang} />
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

function PulseDots() {
  // Positioned relative to the visible map viewport (approximate hotspots over Malta)
  const spots = [
    { name: "MLA airport", left: "48%", top: "62%", color: "bg-amber-300" },
    { name: "Valletta", left: "52%", top: "50%", color: "bg-emerald-300" },
    { name: "Sliema", left: "50%", top: "45%", color: "bg-sky-300" },
    { name: "Gozo ferry", left: "36%", top: "22%", color: "bg-fuchsia-300" },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5]">
      {spots.map((s) => (
        <span key={s.name} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: s.left, top: s.top }}>
          <span className="relative flex h-2.5 w-2.5">
            <span className={`absolute inline-flex h-full w-full rounded-full ${s.color} opacity-70 animate-ping`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${s.color} ring-2 ring-white/40 shadow-lg`} />
          </span>
        </span>
      ))}
    </div>
  );
}

function RouteLine() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-[4] h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="routeGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#5eead4" stopOpacity="0" />
          <stop offset="50%" stopColor="#5eead4" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M 48 62 Q 50 56 52 50"
        stroke="url(#routeGrad)"
        strokeWidth="0.6"
        fill="none"
        strokeDasharray="1.5 1.5"
        strokeLinecap="round"
        style={{ animation: "authDash 3s linear infinite" }}
      />
      <style>{`@keyframes authDash { to { stroke-dashoffset: -12; } }`}</style>
    </svg>
  );
}

function LangSwitch({ lang, onChange }: { lang: LangKey; onChange: (l: LangKey) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 backdrop-blur-md px-1 py-0.5">
      <Globe2 className="h-3 w-3 ml-1.5 text-white/60" />
      {(Object.keys(LANGS) as LangKey[]).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`px-1.5 py-0.5 rounded-full text-[10px] tracking-wider transition-colors ${lang === k ? "bg-white/90 text-teal-950" : "text-white/70 hover:text-white"}`}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

function TroubleSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 text-xs text-white/80 hover:text-white transition-colors">
          <LifeBuoy className="h-3.5 w-3.5" /> Trouble signing in?
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>We can help</SheetTitle>
          <SheetDescription>Pick the fastest way to get back in.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 grid gap-2">
          <ForgotPasswordDialog defaultPhone="+" trigger={<Button variant="outline" className="w-full justify-start">Forgot password</Button>} />
          <a
            href="https://wa.me/35699000000?text=Hi%20—%20I%20can%27t%20sign%20in%20to%20The%20Coordinators"
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="outline" className="w-full justify-start gap-2">
              <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp support
            </Button>
          </a>
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Platform status</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> All systems normal
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SignInForm({ loadingLabel, loginLabel }: { loadingLabel: string; loginLabel: string }) {
  const [phone, setPhone] = useState("+");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const whoAmIFn = useServerFn(whoAmI);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = credsSchema.safeParse({ phone: phone.trim(), password });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setLoading(true);
    const digits = parsed.data.phone.replace(/[^\d]/g, "");
    const email = `p${digits}@phone.crewchange.local`;
    const { error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
    setLoading(false);
    if (error) return toast.error("Invalid phone number or password");

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
        <Input id="si-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+35699123456" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        <p className="text-xs text-muted-foreground">Include country code, e.g. +356 for Malta.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="si-password">Password</Label>
        <Input id="si-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button type="submit" disabled={loading}>{loading ? loadingLabel : loginLabel}</Button>
        <Button
          type="button"
          variant="outline"
          title="Passkey / Face ID (coming soon)"
          onClick={() => toast.info("Passkey sign-in is coming soon.")}
        >
          <Fingerprint className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}

function ForgotPasswordDialog({ defaultPhone, trigger }: { defaultPhone: string; trigger?: React.ReactNode }) {
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
      {trigger ? (
        <button type="button" onClick={() => setOpen(true)} className="contents">{trigger}</button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Forgot password?
        </button>
      )}
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
