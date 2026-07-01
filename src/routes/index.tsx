import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Copy,
  Gift,
  Link2,
  MapPin,
  MessageSquare,
  Plane,
  QrCode,
  Route as RouteIcon,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crew Change — Run your transport hustle like a pro" },
      {
        name: "description",
        content:
          "The dispatch board built for self-employed drivers and coordinators. Live flight tracking, magic-link driver jobs, client portals, and points-based collaboration.",
      },
      { property: "og:title", content: "Crew Change — Run your transport hustle like a pro" },
      {
        property: "og:description",
        content:
          "Dispatch, drivers, clients and referrals in one place. Built for self-employed transport pros.",
      },
      { property: "og:url", content: "https://transfersmt.lovable.app/" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://transfersmt.lovable.app/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Crew Change",
          url: "https://transfersmt.lovable.app/",
        }),
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [ref, setRef] = useState<string>("");
  const [refLink, setRefLink] = useState<string>("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const r = url.searchParams.get("ref") || "";
    if (r) {
      setRef(r);
      try { localStorage.setItem("cc_ref", r); } catch {}
    } else {
      try { setRef(localStorage.getItem("cc_ref") || ""); } catch {}
    }
    setRefLink(`${window.location.origin}/?ref=${encodeURIComponent(r || "YOURNAME")}`);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackdropGlow />
      <Header />
      <Hero refCode={ref} />
      <SocialProof />
      <HowItWorks />
      <Features />
      <Referral refLink={refLink} />
      <RequestAccess defaultRef={ref} />
      <FAQ />
      <Footer />
    </div>
  );
}

function BackdropGlow() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[600px] w-[900px] rounded-full blur-3xl opacity-40"
        style={{ background: "radial-gradient(closest-side, oklch(0.72 0.14 195 / 0.55), transparent)" }} />
      <div className="absolute top-[40rem] -right-40 h-[500px] w-[500px] rounded-full blur-3xl opacity-30"
        style={{ background: "radial-gradient(closest-side, oklch(0.65 0.18 240 / 0.5), transparent)" }} />
    </div>
  );
}

function Header() {
  return (
    <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground grid place-items-center font-bold shadow-lg shadow-primary/25">CC</div>
        <div className="font-semibold tracking-tight">Crew Change</div>
      </div>
      <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
        <a href="#how" className="hover:text-foreground">How it works</a>
        <a href="#features" className="hover:text-foreground">Features</a>
        <a href="#referral" className="hover:text-foreground">Referrals</a>
        <a href="#request" className="hover:text-foreground">Request access</a>
      </nav>
      <div className="flex items-center gap-2">
        <Link to="/auth" className="text-sm font-medium hover:underline">Sign in</Link>
        <a
          href="#request"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
        >
          Request access <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </header>
  );
}

function Hero({ refCode }: { refCode: string }) {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-10 pb-20 md:pt-20 md:pb-28">
      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border bg-card/60 backdrop-blur px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Built for self-employed transport pros
          </div>
          <h1 className="mt-5 text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
            Run your transport hustle like a <span className="text-primary">real ops team</span>.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-xl">
            Crew Change is the dispatch board coordinators and self-employed drivers actually enjoy using.
            Live flight tracking, one-tap driver links, client portals, and a points system that pays you back
            when you refer.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#request"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 shadow-xl shadow-primary/25"
            >
              Request access — it's free to start <ArrowRight className="h-4 w-4" />
            </a>
            <Link to="/auth" className="inline-flex items-center gap-2 rounded-lg border px-5 py-3 text-sm font-medium hover:bg-accent">
              I already have an account
            </Link>
          </div>
          <div className="mt-6 flex items-center gap-6 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> No credit card</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Setup in minutes</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Cancel anytime</span>
          </div>
          {refCode && (
            <p className="mt-4 text-xs text-primary">✓ Referral <span className="font-semibold">{refCode}</span> applied — you'll get bonus points on approval.</p>
          )}
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="relative">
      <div className="rounded-2xl border bg-card/80 backdrop-blur shadow-2xl shadow-primary/10 p-4">
        <div className="flex items-center gap-1.5 pb-3 border-b">
          <div className="w-2.5 h-2.5 rounded-full bg-destructive/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
          <div className="ml-3 text-xs text-muted-foreground">Dispatch board · Tue 14 Jul</div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { time: "06:20", pax: 4, from: "Airport", to: "Port", tone: "emerald" },
            { time: "09:00", pax: 12, from: "Hotel A", to: "Airport", tone: "amber" },
            { time: "11:45", pax: 6, from: "Airport", to: "Yacht", tone: "sky" },
            { time: "14:10", pax: 3, from: "Port", to: "Hotel B", tone: "emerald" },
            { time: "16:30", pax: 8, from: "Airport", to: "Marina", tone: "rose" },
            { time: "19:00", pax: 2, from: "Hotel C", to: "Airport", tone: "sky" },
          ].map((c) => (
            <div key={c.time} className="relative rounded-lg border bg-background p-2.5 text-xs">
              <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${toneBg(c.tone)}`} />
              <div className="pl-1.5 font-mono font-semibold">{c.time}</div>
              <div className="pl-1.5 text-muted-foreground">{c.from} → {c.to}</div>
              <div className="pl-1.5 mt-1 flex items-center gap-1 text-muted-foreground">
                <Users className="h-3 w-3" /> {c.pax} pax
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Plane className="h-3.5 w-3.5 text-primary" /> Flight IB3178 · on time</span>
          <span className="inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5 text-primary" /> 128 pts</span>
        </div>
      </div>
      <div className="absolute -bottom-6 -left-6 hidden md:flex items-center gap-2 rounded-xl border bg-card p-3 shadow-xl">
        <Send className="h-4 w-4 text-primary" />
        <div className="text-xs">
          <div className="font-semibold">Job sent to Andrei</div>
          <div className="text-muted-foreground">Accepted · 12s ago</div>
        </div>
      </div>
    </div>
  );
}

function toneBg(t: string) {
  switch (t) {
    case "emerald": return "bg-emerald-500";
    case "amber": return "bg-amber-500";
    case "rose": return "bg-rose-500";
    case "sky": return "bg-sky-500";
    default: return "bg-primary";
  }
}

function SocialProof() {
  return (
    <section className="max-w-6xl mx-auto px-6 pb-8">
      <div className="rounded-2xl border bg-card/60 backdrop-blur p-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        {[
          { k: "12,400+", v: "Pax moved" },
          { k: "98.7%", v: "On-time pickups" },
          { k: "< 30s", v: "Job → driver accept" },
          { k: "0", v: "Missed handovers" },
        ].map((s) => (
          <div key={s.v}>
            <div className="text-2xl md:text-3xl font-semibold tracking-tight">{s.k}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.v}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: Send,
      title: "1. Paste the job",
      body: "Drop a WhatsApp block or type it in. Names, flight numbers, times — we auto-parse pax, split, and set airport pickup.",
    },
    {
      icon: Link2,
      title: "2. Send a magic link",
      body: "One tap sends a WhatsApp link to your driver with all the trip details. No account needed — they accept and go.",
    },
    {
      icon: MapPin,
      title: "3. Track live",
      body: "Live flight status colors the card red on delay. Driver status ping updates every stop. Client portal stays in sync.",
    },
    {
      icon: Wallet,
      title: "4. Get paid & referred",
      body: "Mark paid or pending, export statements, and earn points every time you refer a partner or take a hop.",
    },
  ];
  return (
    <section id="how" className="max-w-6xl mx-auto px-6 py-20">
      <SectionHead eyebrow="How it works" title="From chaos to dispatched in under a minute." />
      <div className="grid md:grid-cols-4 gap-4 mt-10">
        {steps.map((s) => (
          <div key={s.title} className="rounded-2xl border bg-card p-5 hover:shadow-lg hover:-translate-y-0.5 transition">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
              <s.icon className="h-5 w-5" />
            </div>
            <div className="mt-4 font-semibold">{s.title}</div>
            <p className="text-sm text-muted-foreground mt-1.5">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  const features = [
    { icon: CalendarClock, title: "Interactive dispatch board", body: "Drag-and-drop trips, colored labels, filters and search across every day and driver." },
    { icon: Plane, title: "Live flight tracking", body: "Enter a flight number, we do the rest. Cards go red on delays so you're never caught out." },
    { icon: QrCode, title: "QR pax verification", body: "Drivers scan passengers on the door. No paper manifests, no missed names." },
    { icon: RouteIcon, title: "Multi-hop collaboration", body: "Pass a job to a partner company, keep the chain visible A → B → C → driver in real time." },
    { icon: MessageSquare, title: "Chat per trip", body: "Direct thread between coordinator and driver — no more mixing WhatsApp groups." },
    { icon: ShieldCheck, title: "Secure by default", body: "Row-level security, magic-link expiry, admin-approved companies. Your data is yours." },
  ];
  return (
    <section id="features" className="max-w-6xl mx-auto px-6 py-16">
      <SectionHead eyebrow="Features" title="Everything you'd build yourself — already built." />
      <div className="grid md:grid-cols-3 gap-4 mt-10">
        {features.map((f) => (
          <div key={f.title} className="rounded-2xl border bg-card p-6">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
              <f.icon className="h-5 w-5" />
            </div>
            <div className="mt-4 font-semibold">{f.title}</div>
            <p className="text-sm text-muted-foreground mt-1.5">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Referral({ refLink }: { refLink: string }) {
  const copy = async () => {
    await navigator.clipboard.writeText(refLink);
    toast.success("Referral link copied");
  };
  const share = () => {
    const text = `Try Crew Change — the dispatch board built for self-employed transport pros. ${refLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };
  return (
    <section id="referral" className="max-w-6xl mx-auto px-6 py-20">
      <div className="rounded-3xl border bg-gradient-to-br from-primary/10 via-card to-card p-8 md:p-12 relative overflow-hidden">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="grid md:grid-cols-2 gap-8 items-center relative">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs font-medium">
              <Gift className="h-3.5 w-3.5 text-primary" /> Referral program
            </div>
            <h2 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight">
              Refer a driver or coordinator. Earn points for every trip they dispatch.
            </h2>
            <ul className="mt-6 space-y-2.5 text-sm">
              {[
                "50 bonus points when your friend is approved",
                "1 point every time you pass them a hop",
                "No cap — the more you build the network, the more you earn",
              ].map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" /> <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border bg-background p-5">
            <div className="text-xs text-muted-foreground">Your referral link</div>
            <div className="mt-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-mono truncate">
              {refLink || "Loading…"}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={copy} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
                <Copy className="h-4 w-4" /> Copy
              </button>
              <button onClick={share} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90">
                <Send className="h-4 w-4" /> WhatsApp
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Tip: your unique code appears after you request access below.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function RequestAccess({ defaultRef }: { defaultRef: string }) {
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    company_name: "",
    role: "self_employed_driver",
    country: "",
    fleet_size: "1",
    message: "",
    referral_code: defaultRef || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (defaultRef) setForm((f) => ({ ...f, referral_code: defaultRef }));
  }, [defaultRef]);

  const disabled = useMemo(
    () => !form.full_name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email),
    [form],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    const { error } = await supabase.from("access_requests").insert({
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      company_name: form.company_name.trim() || null,
      role: form.role,
      country: form.country.trim() || null,
      fleet_size: form.fleet_size || null,
      message: form.message.trim() || null,
      referral_code: form.referral_code.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDone(true);
    toast.success("Request sent — we'll be in touch shortly");
  };

  return (
    <section id="request" className="max-w-4xl mx-auto px-6 py-20">
      <SectionHead eyebrow="Request access" title="Tell us about your operation. We'll open your account." />
      <div className="mt-10 rounded-2xl border bg-card p-6 md:p-8 shadow-xl shadow-primary/5">
        {done ? (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-primary/10 text-primary grid place-items-center mx-auto">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-xl font-semibold">You're on the list.</h3>
            <p className="mt-2 text-sm text-muted-foreground">We'll send your login details by email within one business day.</p>
            <Link to="/auth" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              Go to sign in <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="grid md:grid-cols-2 gap-4">
            <Field label="Full name *" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} placeholder="Alex Rossi" />
            <Field label="Email *" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="you@company.com" />
            <Field label="Phone / WhatsApp" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+34 …" />
            <Field label="Company (optional)" value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} placeholder="Rossi Transfers" />
            <div>
              <label className="text-xs font-medium text-muted-foreground">You are…</label>
              <select
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="self_employed_driver">Self-employed driver</option>
                <option value="coordinator">Coordinator / dispatcher</option>
                <option value="fleet_owner">Small fleet owner</option>
                <option value="agency">Crew agency</option>
              </select>
            </div>
            <Field label="Country / base" value={form.country} onChange={(v) => setForm({ ...form, country: v })} placeholder="Spain — Barcelona" />
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fleet size</label>
              <select
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                value={form.fleet_size}
                onChange={(e) => setForm({ ...form, fleet_size: e.target.value })}
              >
                <option value="1">Just me</option>
                <option value="2-5">2-5 vehicles</option>
                <option value="6-15">6-15 vehicles</option>
                <option value="16+">16+ vehicles</option>
              </select>
            </div>
            <Field label="Referral code (optional)" value={form.referral_code} onChange={(v) => setForm({ ...form, referral_code: v })} placeholder="e.g. ALEX50" />
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Anything else? (optional)</label>
              <textarea
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm min-h-[90px]"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Fleet, routes you cover, current dispatch tool…"
              />
            </div>
            <div className="md:col-span-2 flex flex-col md:flex-row md:items-center md:justify-between gap-3 pt-2">
              <p className="text-xs text-muted-foreground">By requesting access you agree we'll email you your login. We don't share data.</p>
              <button
                type="submit"
                disabled={disabled || submitting}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shadow-lg shadow-primary/25"
              >
                <Zap className="h-4 w-4" /> {submitting ? "Sending…" : "Request access"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

function FAQ() {
  const items = [
    { q: "Is it really free to start?", a: "Yes. You get a starter balance of points to try every feature. Top up only when you need more." },
    { q: "Do my drivers need an account?", a: "No. They open a magic link on WhatsApp, accept the trip, and update status from their phone." },
    { q: "Can I pass a job to another company?", a: "Yes — the multi-hop chain keeps A → B → C → driver visible to everyone in the chain in real time." },
    { q: "How do referrals get paid out?", a: "You earn points automatically when your referral is approved and every time you dispatch to them." },
  ];
  return (
    <section className="max-w-4xl mx-auto px-6 py-16">
      <SectionHead eyebrow="FAQ" title="Quick answers." />
      <div className="mt-8 divide-y rounded-2xl border bg-card">
        {items.map((i) => (
          <details key={i.q} className="group p-5">
            <summary className="cursor-pointer list-none font-medium flex items-center justify-between">
              {i.q}
              <span className="text-primary group-open:rotate-45 transition">+</span>
            </summary>
            <p className="mt-3 text-sm text-muted-foreground">{i.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <div className="text-xs uppercase tracking-widest text-primary font-semibold">{eyebrow}</div>
      <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t mt-10">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <div>© {new Date().getFullYear()} Crew Change. Built for operators.</div>
        <div className="flex items-center gap-4">
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#request" className="hover:text-foreground">Request access</a>
          <Link to="/auth" className="hover:text-foreground">Sign in</Link>
          <Link to="/admin-auth" className="hover:text-foreground opacity-60">Admin</Link>
        </div>
      </div>
    </footer>
  );
}
