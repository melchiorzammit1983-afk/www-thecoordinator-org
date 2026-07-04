import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  Network,
  Smartphone,
  Sparkles,
  Megaphone,
  QrCode,
  MapPin,
  ShieldAlert,
  Plane,
  Users,
  X,
} from "lucide-react";
import logoAsset from "@/assets/coordinators-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Coordinators — Malta's Transport Network Hub" },
      {
        name: "description",
        content:
          "Stop manually dispatching. The all-in-one transport network for Malta's hotels, shipping agents, and fleet owners. Dispatch trips, track flights, and share jobs instantly.",
      },
      { property: "og:title", content: "The Coordinators — Malta's Transport Network Hub" },
      {
        property: "og:description",
        content:
          "Drag-and-drop dispatching, AI-powered bulk uploads, and instant live tracking links. Zero-friction driver web links — no app downloads required.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased [font-feature-settings:'ss01','cv11']">
      <Nav />
      <Hero />
      <ProblemSolution />
      <Bento />
      <ClientExperience />
      <FinalCta />
      <Footer />
    </div>
  );
}

/* ============================ NAV ============================ */
function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <a href="/" className="flex items-center gap-2.5">
          <img src={logoAsset.url} alt="The Coordinators" className="h-11 w-auto" />
          <span className="hidden sm:block text-[15px] font-semibold tracking-tight text-slate-900">
            The Coordinators
          </span>
        </a>
        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Login
          </Link>
          <a
            href="mailto:hello@coordinatormt.com?subject=Book%20a%20Demo"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a2a52] px-4 py-2 text-sm font-semibold text-white hover:bg-[#243668] shadow-sm hover:shadow-md transition-all"
          >
            Book a Demo <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}

/* ============================ HERO ============================ */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(26,42,82,0.08), transparent 70%), linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        }}
      />
      <div className="mx-auto max-w-5xl px-6 pt-20 pb-16 md:pt-28 md:pb-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-[#1a2a52]" />
          Built in Malta for Maltese transport operators
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 md:text-6xl lg:text-7xl leading-[1.02]">
          Stop manually dispatching.
          <br />
          <span className="text-[#1a2a52]">Start collaborating.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 md:text-xl leading-relaxed">
          The all-in-one transport network for Malta's hotels, shipping agents, and fleet owners.
          Dispatch trips, track flights, and share jobs instantly—without forcing your drivers to
          download an app.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-xl bg-[#1a2a52] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#1a2a52]/20 hover:bg-[#243668] hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            Get Started Free <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#how"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
          >
            See How It Works
          </a>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600"/> No credit card</span>
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600"/> No driver app required</span>
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600"/> Live flight tracking included</span>
        </div>

        <DashboardMock />
      </div>
    </section>
  );
}

function DashboardMock() {
  return (
    <div className="relative mx-auto mt-14 max-w-5xl">
      <div className="absolute -inset-x-8 -top-8 bottom-0 -z-10 rounded-[3rem] bg-gradient-to-b from-[#1a2a52]/15 to-transparent blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
        {/* window chrome */}
        <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-3 text-[11px] font-medium text-slate-500">
            coordinatormt.app · Dispatch board
          </span>
        </div>
        <div className="grid grid-cols-12 gap-0">
          {/* sidebar */}
          <aside className="col-span-3 hidden md:block border-r border-slate-100 bg-slate-50/40 p-4">
            <div className="flex items-center gap-2">
              <img src={logoAsset.url} alt="" className="h-8 w-8 rounded-md object-contain" />
              <div className="text-xs">
                <div className="font-semibold text-slate-800">Sea Breeze Fleet</div>
                <div className="text-slate-500">Coordinator</div>
              </div>
            </div>
            <div className="mt-6 space-y-1 text-xs font-medium text-slate-600">
              {["Today", "Incoming", "Pending", "Drivers", "Statements"].map((i, idx) => (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 ${idx === 0 ? "bg-[#1a2a52] text-white" : "hover:bg-slate-100"}`}
                >
                  {i}
                </div>
              ))}
            </div>
          </aside>
          {/* board */}
          <div className="col-span-12 md:col-span-9 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Tuesday</div>
                <div className="text-lg font-semibold">14 trips scheduled</div>
              </div>
              <div className="hidden sm:flex items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700"><Plane className="h-3 w-3"/> On time</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">Delayed</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-2.5">
              {[
                { t: "06:20", f: "MLA Airport", to: "Port", pax: 4, tone: "emerald" },
                { t: "09:00", f: "Hilton", to: "MLA Airport", pax: 12, tone: "amber" },
                { t: "11:45", f: "MLA Airport", to: "Yacht Marina", pax: 6, tone: "sky" },
                { t: "14:10", f: "Port", to: "Corinthia", pax: 3, tone: "emerald" },
                { t: "16:30", f: "MLA Airport", to: "Sliema", pax: 8, tone: "rose" },
                { t: "19:00", f: "Westin", to: "MLA Airport", pax: 2, tone: "sky" },
              ].map((c) => (
                <div key={c.t} className="relative rounded-xl border border-slate-200 bg-white p-3 hover:shadow-md transition-shadow">
                  <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-r ${
                    c.tone === "emerald" ? "bg-emerald-500" :
                    c.tone === "amber" ? "bg-amber-500" :
                    c.tone === "rose" ? "bg-rose-500" : "bg-sky-500"}`} />
                  <div className="pl-2 font-mono text-sm font-semibold text-slate-900">{c.t}</div>
                  <div className="pl-2 text-xs text-slate-600 truncate">{c.f} → {c.to}</div>
                  <div className="pl-2 mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                    <Users className="h-3 w-3"/> {c.pax} pax
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================== PROBLEM vs SOLUTION ==================== */
function ProblemSolution() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <div className="text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#1a2a52]">The shift</div>
        <h2 className="mt-3 text-3xl md:text-5xl font-bold tracking-tight">
          From WhatsApp chaos to total control.
        </h2>
      </div>
      <div className="mt-14 grid md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-red-100 bg-red-50/40 p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
            <X className="h-3.5 w-3.5" /> The old way
          </div>
          <p className="mt-5 text-lg text-slate-700 leading-relaxed">
            Endlessly typing out WhatsApp messages, manually tracking delayed flights, and losing
            <span className="font-semibold text-red-700"> 20% of your day</span> to administrative
            chaos.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Check className="h-3.5 w-3.5" /> The new way
          </div>
          <p className="mt-5 text-lg text-slate-700 leading-relaxed">
            Drag-and-drop dispatching, AI-powered bulk uploads, and instant live tracking links.
            <span className="font-semibold text-emerald-700"> Total control in seconds.</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ============================ BENTO ============================ */
function Bento() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-24">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#1a2a52]">Features</div>
        <h2 className="mt-3 text-3xl md:text-5xl font-bold tracking-tight">
          Everything a transport network needs.
        </h2>
        <p className="mt-4 text-slate-600 text-lg">Purpose-built for the pace and pressure of Malta's transfer market.</p>
      </div>

      <div className="mt-14 grid grid-cols-1 md:grid-cols-6 gap-4 auto-rows-[220px]">
        <BentoCard
          className="md:col-span-3"
          icon={<Network className="h-5 w-5" />}
          title="Trip 'Jumping'"
          body="Overbooked? Pass trips seamlessly between trusted partner companies while keeping total tracking control of your client."
          visual={<JumpingVisual />}
        />
        <BentoCard
          className="md:col-span-3"
          icon={<Smartphone className="h-5 w-5" />}
          title="Zero-Friction Drivers"
          body="No app downloads. No account creation. Just send a secure, time-limited web link to your driver's phone, and they are ready to go."
          visual={<PhoneLinkVisual />}
        />
        <BentoCard
          className="md:col-span-2"
          icon={<Sparkles className="h-5 w-5" />}
          title="AI Bulk Uploads"
          body="Paste a list of bookings and let AI format them instantly. Built-in flight tracking alerts you to delays before the driver even leaves."
          visual={<AIVisual />}
        />
        <BentoCard
          className="md:col-span-4"
          icon={<Megaphone className="h-5 w-5" />}
          title="Your Own Ad Network"
          body="Turn your client and driver tracking screens into revenue. Display targeted ads for local partner services, or your own brand."
          visual={<AdVisual />}
        />
      </div>
    </section>
  );
}

function BentoCard({
  className = "",
  icon,
  title,
  body,
  visual,
}: {
  className?: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  visual?: React.ReactNode;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60 p-6 hover:bg-white hover:border-slate-300 hover:shadow-xl hover:-translate-y-0.5 transition-all ${className}`}
    >
      <div className="relative z-10 max-w-md">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#1a2a52] border border-slate-200 shadow-sm">
          {icon}
        </div>
        <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{body}</p>
      </div>
      {visual && (
        <div className="pointer-events-none absolute inset-0 opacity-70 group-hover:opacity-100 transition-opacity">
          {visual}
        </div>
      )}
    </div>
  );
}

function JumpingVisual() {
  return (
    <svg viewBox="0 0 400 220" className="absolute right-0 bottom-0 h-40 w-auto opacity-90">
      <defs>
        <linearGradient id="jg" x1="0" x2="1"><stop offset="0" stopColor="#1a2a52"/><stop offset="1" stopColor="#3b5bdb"/></linearGradient>
      </defs>
      {[[300,60],[220,140],[340,150],[260,50]].map(([cx,cy],i)=>(
        <circle key={i} cx={cx} cy={cy} r="14" fill="url(#jg)" opacity="0.9"/>
      ))}
      <path d="M260 50 Q290 100 220 140 T340 150" stroke="url(#jg)" strokeWidth="1.5" fill="none" strokeDasharray="4 4"/>
      <path d="M300 60 Q320 100 340 150" stroke="url(#jg)" strokeWidth="1.5" fill="none" strokeDasharray="4 4"/>
    </svg>
  );
}
function PhoneLinkVisual() {
  return (
    <div className="pointer-events-none absolute -right-4 bottom-4 h-40 w-24 rounded-[1.25rem] border-4 border-slate-800 bg-white shadow-2xl overflow-hidden">
      <div className="bg-[#1a2a52] text-white px-2 py-1.5 text-[8px] font-semibold">Your Trip</div>
      <div className="p-1.5 space-y-1">
        <div className="h-1.5 rounded bg-slate-200 w-3/4"/>
        <div className="h-1.5 rounded bg-slate-200 w-1/2"/>
        <div className="mt-2 rounded bg-emerald-100 border border-emerald-300 h-6 grid place-items-center text-[7px] font-semibold text-emerald-800">Accept</div>
        <div className="mt-2 h-14 rounded bg-slate-100 grid place-items-center"><MapPin className="h-4 w-4 text-slate-400"/></div>
      </div>
    </div>
  );
}
function AIVisual() {
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-md">
      <div className="flex items-center gap-1 text-[9px] font-semibold text-[#1a2a52]"><Sparkles className="h-2.5 w-2.5"/> Parsed 12 trips</div>
      <div className="mt-1 space-y-0.5">
        {[1,2,3].map(i=>(<div key={i} className="h-1 rounded bg-slate-200 w-16"/>))}
      </div>
    </div>
  );
}
function AdVisual() {
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 flex gap-2">
      <div className="rounded-lg bg-white border border-slate-200 p-2 shadow-md w-28">
        <div className="h-10 rounded bg-gradient-to-br from-[#1a2a52] to-[#3b5bdb]"/>
        <div className="mt-1.5 h-1 rounded bg-slate-200 w-3/4"/>
        <div className="mt-1 h-1 rounded bg-slate-200 w-1/2"/>
      </div>
      <div className="rounded-lg bg-white border border-slate-200 p-2 shadow-md w-28">
        <div className="h-10 rounded bg-gradient-to-br from-emerald-500 to-teal-600"/>
        <div className="mt-1.5 h-1 rounded bg-slate-200 w-2/3"/>
        <div className="mt-1 h-1 rounded bg-slate-200 w-1/2"/>
      </div>
    </div>
  );
}

/* ==================== CLIENT EXPERIENCE ==================== */
function ClientExperience() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-[#1a2a52]">The client experience</div>
          <h2 className="mt-3 text-3xl md:text-5xl font-bold tracking-tight leading-[1.05]">
            Put booking in <span className="text-[#1a2a52]">their hands.</span>
          </h2>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed">
            Generate custom QR codes for hotel rooms or send direct booking links to VIP corporate
            clients. They book themselves directly into your system, and get an SOS safety button and
            live driver tracking automatically.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-slate-700">
            {[
              ["Custom QR codes for every hotel room", QrCode],
              ["Live driver GPS + ETA on every trip", MapPin],
              ["One-tap SOS safety button for passengers", ShieldAlert],
            ].map(([t, Icon]: any) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1a2a52]/10 text-[#1a2a52]">
                  <Icon className="h-4 w-4" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* phone mockup */}
        <div className="relative flex justify-center">
          <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-gradient-to-br from-[#1a2a52]/15 to-emerald-100 blur-2xl" />
          <div className="relative h-[560px] w-[280px] rounded-[2.5rem] border-[10px] border-slate-900 bg-white shadow-2xl overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 h-6 w-32 rounded-b-2xl bg-slate-900 z-10"/>
            <div className="px-4 pt-10 pb-4 bg-[#1a2a52] text-white">
              <div className="flex items-center gap-2">
                <img src={logoAsset.url} alt="" className="h-8 w-8 rounded-md bg-white p-0.5 object-contain"/>
                <div className="text-xs">
                  <div className="opacity-70">Room 402</div>
                  <div className="font-semibold">Book your transfer</div>
                </div>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div className="mx-auto h-36 w-36 rounded-xl border-2 border-slate-200 grid place-items-center bg-white">
                <QrCode className="h-24 w-24 text-slate-900" strokeWidth={1.2}/>
              </div>
              <div className="text-center text-[11px] text-slate-500">Scan to book · Room 402</div>
              <div className="rounded-xl bg-slate-100 h-32 grid place-items-center relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_60%,#c7d2fe_0,transparent_40%),radial-gradient(circle_at_70%_40%,#a7f3d0_0,transparent_40%)]"/>
                <div className="relative flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"/> Driver 3 min away
                </div>
              </div>
              <button className="w-full rounded-xl bg-red-600 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
                <ShieldAlert className="h-4 w-4"/> SOS
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================ FINAL CTA ============================ */
function FinalCta() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#0f1a35] p-10 md:p-20 text-center relative">
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(50% 60% at 20% 20%, rgba(59,91,219,0.6), transparent 60%), radial-gradient(40% 50% at 80% 80%, rgba(16,185,129,0.35), transparent 60%)",
          }}
        />
        <div className="relative">
          <img src={logoAsset.url} alt="" className="mx-auto h-16 w-16 rounded-xl bg-white/5 p-1"/>
          <h2 className="mt-6 text-3xl md:text-5xl font-bold tracking-tight text-white leading-[1.05]">
            Built for the realities of Maltese transport.
          </h2>
          <p className="mt-5 max-w-2xl mx-auto text-lg text-slate-300">
            Stop turning away jobs because you don't have enough cars. Connect your network today.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-7 py-4 text-sm font-bold text-[#0f1a35] shadow-xl hover:bg-slate-100 hover:-translate-y-0.5 transition-all"
            >
              Start Your Network Now <ArrowRight className="h-4 w-4"/>
            </Link>
            <a
              href="mailto:hello@coordinatormt.com?subject=Book%20a%20Demo"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-7 py-4 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
            >
              Book a Demo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================ FOOTER ============================ */
function Footer() {
  return (
    <footer className="border-t border-slate-200">
      <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <img src={logoAsset.url} alt="" className="h-8 w-8 object-contain"/>
          <div className="text-sm text-slate-600">
            © {new Date().getFullYear()} The Coordinators · Transport Network Hub
          </div>
        </div>
        <div className="flex items-center gap-5 text-sm text-slate-500">
          <Link to="/auth" className="hover:text-slate-900">Login</Link>
          <a href="mailto:hello@coordinatormt.com" className="hover:text-slate-900">Contact</a>
        </div>
      </div>
    </footer>
  );
}
