import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  Network,
  Smartphone,
  Sparkles,
  Megaphone,
  MapPin,
  ShieldAlert,
  MessageCircle,
  Plane,
  Users,
  X,
  Clipboard,
  Send,
  Radar,
  LayoutDashboard,
  CalendarDays,
  Inbox,
  Link2,
  FileText,
  Handshake,
  Car,
  Tag,
  Palette,
  CheckCircle2,
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

const BRAND = "#1a2a52";

function Landing() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Nav />
      <Hero />
      <ProblemSolution />
      <HowItWorks />
      <Bento />
      <ClientExperience />
      <HowPointsWork />
      <TrustStrip />
      <FaqSection />
      <FinalCta />
      <Footer />
    </div>
  );
}

/* ============================ NAV ============================ */
function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 md:px-6 md:py-3">
        <a href="/" className="flex items-center gap-2 min-w-0">
          <img src={logoAsset.url} alt="The Coordinators" className="h-9 md:h-11 w-auto shrink-0" />
          <span className="hidden sm:block text-[15px] font-semibold tracking-tight text-slate-900 truncate">
            The Coordinators
          </span>
        </a>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <Link
            to="/auth"
            className="rounded-xl px-3 md:px-4 py-2 text-xs md:text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Login
          </Link>
          <Link
            to="/request-access"
            search={{ demo: "1" }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a2a52] px-3 md:px-4 py-2 text-xs md:text-sm font-semibold text-white hover:bg-[#243668] shadow-sm hover:shadow-md transition-all"
          >
            Book a Demo <ArrowRight className="h-3.5 w-3.5" />
          </Link>
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
            "radial-gradient(60% 50% at 50% 0%, rgba(26,42,82,0.10), transparent 70%), linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        }}
      />
      <div className="mx-auto max-w-6xl px-5 pt-12 pb-14 md:px-6 md:pt-20 md:pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-12 items-center">
          {/* Text */}
          <div className="text-center md:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] md:text-xs font-medium text-slate-600 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-[#1a2a52]" />
              Built in Malta for Maltese transport operators
            </div>
            <h1 className="mt-5 text-[2rem] leading-[1.05] font-bold tracking-tight text-slate-900 sm:text-4xl md:text-5xl lg:text-6xl">
              Stop manually dispatching.
              <br />
              <span className="text-[#1a2a52]">Start collaborating.</span>
            </h1>
            <p className="mx-auto md:mx-0 mt-4 max-w-xl text-base md:text-lg text-slate-600 leading-relaxed">
              The all-in-one transport network for Malta's hotels, shipping agents, and fleet
              owners. Dispatch trips, track flights, and share jobs instantly—without forcing your
              drivers to download an app.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-stretch sm:items-center justify-center md:justify-start gap-2.5">
              <Link
                to="/request-access"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1a2a52] px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#1a2a52]/20 hover:bg-[#243668] transition-all"
              >
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
              >
                See How It Works
              </a>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-1.5 text-[11px] md:text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-600" /> Pay as you go
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-600" /> No driver app required
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-600" /> Live flight tracking
              </span>
            </div>
          </div>

          {/* Phone mockup: client trip portal */}
          <div className="relative flex justify-center">
            <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-[#1a2a52]/15 to-emerald-100/60 blur-2xl" />
            <ClientPortalPhone />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ==================== CLIENT PORTAL PHONE MOCKUP ==================== */
function ClientPortalPhone({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`relative w-full ${compact ? "max-w-[220px]" : "max-w-[260px]"} rounded-[2.25rem] border-[8px] border-slate-900 bg-white shadow-2xl overflow-hidden`}
      style={{ aspectRatio: "9 / 19" }}
    >
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-5 w-24 rounded-b-2xl bg-slate-900 z-10" />
      {/* Header */}
      <div className="px-3 pt-8 pb-3 bg-[#1a2a52] text-white">
        <div className="flex items-center gap-2">
          <img src={logoAsset.url} alt="" className="h-7 w-7 rounded-md bg-white p-0.5 object-contain" />
          <div className="text-[10px] leading-tight min-w-0">
            <div className="opacity-70 truncate">Le Meridien Malta · Room 402</div>
            <div className="font-semibold truncate">Your transfer</div>
          </div>
        </div>
      </div>
      {/* Body */}
      <div className="p-3 space-y-2.5">
        {/* Progress */}
        <div>
          <div className="flex items-center gap-1">
            {["Assigned", "En route", "Arrived", "Done"].map((s, i) => (
              <div key={s} className="flex-1">
                <div className={`h-1 rounded-full ${i <= 1 ? "bg-[#1a2a52]" : "bg-slate-200"}`} />
                <div className={`mt-1 text-[7px] text-center ${i <= 1 ? "text-slate-800 font-semibold" : "text-slate-400"}`}>
                  {s}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live map */}
        <div className="relative h-32 rounded-lg overflow-hidden bg-slate-100">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_60%,#dbeafe_0,transparent_45%),radial-gradient(circle_at_70%_40%,#d1fae5_0,transparent_45%)]" />
          <svg viewBox="0 0 200 130" className="absolute inset-0 w-full h-full">
            <path d="M10 110 Q 60 80, 90 90 T 160 40" stroke="#1a2a52" strokeWidth="2" strokeLinecap="round" fill="none" strokeDasharray="4 3" />
          </svg>
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 shadow text-[9px] font-semibold text-slate-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Andrei · 4 min
          </div>
          <div className="absolute left-[45%] top-[55%] h-3 w-3 rounded-full bg-[#1a2a52] ring-4 ring-[#1a2a52]/25" />
          <div className="absolute right-3 bottom-2 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
        </div>

        {/* Trip details */}
        <div className="rounded-lg border border-slate-200 p-2 text-[9px] leading-snug">
          <div className="flex items-center gap-1 text-slate-500">
            <Plane className="h-2.5 w-2.5" /> KM110 · on time
          </div>
          <div className="font-semibold text-slate-800 mt-0.5">MLA Airport → Le Meridien</div>
          <div className="text-slate-500">Pickup 14:20 · 2 pax</div>
        </div>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button className="rounded-lg bg-slate-100 py-2 text-[10px] font-semibold text-slate-800 flex items-center justify-center gap-1">
            <MessageCircle className="h-3 w-3" /> Chat
          </button>
          <button className="rounded-lg bg-red-600 py-2 text-[10px] font-bold text-white flex items-center justify-center gap-1">
            <ShieldAlert className="h-3 w-3" /> SOS
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==================== PROBLEM vs SOLUTION ==================== */
function ProblemSolution() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 md:px-6 md:py-24">
      <div className="text-center">
        <div className="text-[11px] md:text-xs font-semibold uppercase tracking-widest text-[#1a2a52]">
          The shift
        </div>
        <h2 className="mt-3 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
          From WhatsApp chaos to total control.
        </h2>
      </div>
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <div className="rounded-2xl border border-red-100 bg-red-50/50 p-6 md:p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
            <X className="h-3.5 w-3.5" /> The old way
          </div>
          <p className="mt-4 text-base md:text-lg text-slate-700 leading-relaxed">
            Endlessly typing out WhatsApp messages, manually tracking delayed flights, and losing
            <span className="font-semibold text-red-700"> 20% of your day</span> to administrative
            chaos.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-6 md:p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Check className="h-3.5 w-3.5" /> The new way
          </div>
          <p className="mt-4 text-base md:text-lg text-slate-700 leading-relaxed">
            Drag-and-drop dispatching, AI-powered bulk uploads, and instant live tracking links.
            <span className="font-semibold text-emerald-700"> Total control in seconds.</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ==================== HOW IT WORKS ==================== */
function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Paste your bookings",
      body: "Drop a WhatsApp block or a hotel's daily sheet straight into the Pending screen. No formatting needed.",
      visual: <StepPasteVisual />,
    },
    {
      n: "02",
      title: "AI parses in seconds",
      body: "Names, flights, times and pax are pulled out automatically. Review, tweak, approve.",
      visual: <StepAIVisual />,
    },
    {
      n: "03",
      title: "Send driver a web link",
      body: "One tap sends a secure WhatsApp link. Your driver opens the trip — no login, no download.",
      visual: <StepDriverVisual />,
    },
    {
      n: "04",
      title: "Track live & collaborate",
      body: "Watch flights, driver status and client ETA. Overflow? Jump the trip to a partner in one tap.",
      visual: <StepTrackVisual />,
    },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-16 md:px-6 md:py-24">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[11px] md:text-xs font-semibold uppercase tracking-widest text-[#1a2a52]">
          How it works
        </div>
        <h2 className="mt-3 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
          From booking to billed in one flow.
        </h2>
        <p className="mt-3 text-base md:text-lg text-slate-600">
          The exact workflow every coordinator on the platform runs, every day.
        </p>
      </div>

      <ol className="mt-12 grid grid-cols-1 md:grid-cols-4 gap-4">
        {steps.map((s) => (
          <li
            key={s.n}
            className="relative rounded-2xl border border-slate-200 bg-white p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#1a2a52] text-white text-[11px] font-bold">
                {s.n}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Step
              </div>
            </div>
            <div className="mt-4 h-32 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden relative">
              {s.visual}
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-900">{s.title}</h3>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepPasteVisual() {
  return (
    <div className="absolute inset-2 rounded-lg bg-white border border-slate-200 p-2 text-[8px] font-mono text-slate-600 leading-tight overflow-hidden">
      <div className="text-[9px] font-sans font-semibold text-slate-800 mb-1 flex items-center gap-1">
        <Clipboard className="h-2.5 w-2.5" /> Paste bookings
      </div>
      <div>Guest 1 — MLA 14:20 KM110 2pax</div>
      <div>Guest 2 — Corinthia → MLA 16:00</div>
      <div>Guest 3 — MLA → Valletta RY4501</div>
      <div className="mt-1.5 inline-block rounded bg-[#1a2a52] px-1.5 py-0.5 text-[8px] font-sans text-white">
        Parse with AI
      </div>
    </div>
  );
}
function StepAIVisual() {
  return (
    <div className="absolute inset-2 rounded-lg bg-white border border-slate-200 p-2 space-y-1 overflow-hidden">
      <div className="text-[9px] font-semibold text-[#1a2a52] flex items-center gap-1">
        <Sparkles className="h-2.5 w-2.5" /> 3 trips parsed
      </div>
      {[
        { t: "14:20", r: "MLA → Le Meridien", f: "KM110" },
        { t: "16:00", r: "Corinthia → MLA", f: "—" },
        { t: "17:45", r: "MLA → Valletta", f: "RY4501" },
      ].map((r) => (
        <div key={r.t} className="flex items-center gap-1.5 text-[8px] text-slate-700">
          <span className="font-mono font-semibold text-slate-900">{r.t}</span>
          <span className="flex-1 truncate">{r.r}</span>
          <span className="text-slate-400">{r.f}</span>
          <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
        </div>
      ))}
    </div>
  );
}
function StepDriverVisual() {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2 p-2">
      <div className="flex-1 rounded-lg bg-white border border-slate-200 p-2 text-[8px]">
        <div className="font-semibold text-slate-800 flex items-center gap-1">
          <Send className="h-2.5 w-2.5" /> Send link
        </div>
        <div className="mt-1 text-slate-500">Driver · Andrei</div>
        <div className="mt-1 h-3.5 rounded bg-emerald-500 text-white text-[7px] font-bold grid place-items-center">
          WhatsApp
        </div>
      </div>
      <div className="h-24 w-14 rounded-lg border-2 border-slate-800 bg-white p-1 text-[6px] shrink-0">
        <div className="bg-[#1a2a52] text-white rounded-sm px-1 py-0.5 font-semibold">Trip</div>
        <div className="mt-1 text-slate-700 leading-tight">14:20 MLA → Le Meridien</div>
        <div className="mt-1 h-3 rounded bg-emerald-100 grid place-items-center text-emerald-800 font-semibold">
          Accept
        </div>
      </div>
    </div>
  );
}
function StepTrackVisual() {
  return (
    <div className="absolute inset-2 rounded-lg bg-white border border-slate-200 p-1.5 space-y-1 overflow-hidden">
      {[
        { t: "14:20", tone: "emerald", who: "Andrei" },
        { t: "16:00", tone: "amber", who: "Partner ↗" },
        { t: "17:45", tone: "sky", who: "Marco" },
      ].map((c) => (
        <div key={c.t} className="relative rounded border border-slate-200 pl-2 pr-1.5 py-1 text-[8px]">
          <span
            className={`absolute left-0 top-1 bottom-1 w-0.5 rounded ${
              c.tone === "emerald" ? "bg-emerald-500" : c.tone === "amber" ? "bg-amber-500" : "bg-sky-500"
            }`}
          />
          <div className="font-mono font-semibold text-slate-900">{c.t}</div>
          <div className="text-slate-500 flex items-center gap-1">
            <Radar className="h-2 w-2" /> {c.who}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================ BENTO ============================ */
function Bento() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 md:px-6 md:py-24">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[11px] md:text-xs font-semibold uppercase tracking-widest text-[#1a2a52]">
          Features
        </div>
        <h2 className="mt-3 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
          Everything a transport network needs.
        </h2>
        <p className="mt-3 text-base md:text-lg text-slate-600">
          Purpose-built for the pace and pressure of Malta's transfer market.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 md:grid-cols-6 gap-4 md:auto-rows-[220px]">
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
      className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60 p-5 md:p-6 hover:bg-white hover:border-slate-300 hover:shadow-xl hover:-translate-y-0.5 transition-all min-h-[220px] ${className}`}
    >
      <div className="relative z-10 max-w-md">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#1a2a52] border border-slate-200 shadow-sm">
          {icon}
        </div>
        <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{body}</p>
      </div>
      {visual && (
        <div className="pointer-events-none absolute inset-0 opacity-80 group-hover:opacity-100 transition-opacity">
          {visual}
        </div>
      )}
    </div>
  );
}

function JumpingVisual() {
  return (
    <svg viewBox="0 0 400 220" className="absolute right-0 bottom-0 h-36 md:h-40 w-auto opacity-90">
      <defs>
        <linearGradient id="jg" x1="0" x2="1">
          <stop offset="0" stopColor="#1a2a52" />
          <stop offset="1" stopColor="#3b5bdb" />
        </linearGradient>
      </defs>
      {[[300, 60], [220, 140], [340, 150], [260, 50]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="14" fill="url(#jg)" opacity="0.9" />
      ))}
      <path d="M260 50 Q290 100 220 140 T340 150" stroke="url(#jg)" strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
      <path d="M300 60 Q320 100 340 150" stroke="url(#jg)" strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
    </svg>
  );
}
function PhoneLinkVisual() {
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 h-36 w-20 rounded-[1rem] border-4 border-slate-800 bg-white shadow-2xl overflow-hidden">
      <div className="bg-[#1a2a52] text-white px-1.5 py-1 text-[7px] font-semibold">Your Trip</div>
      <div className="p-1.5 space-y-1">
        <div className="h-1.5 rounded bg-slate-200 w-3/4" />
        <div className="h-1.5 rounded bg-slate-200 w-1/2" />
        <div className="mt-1.5 rounded bg-emerald-100 border border-emerald-300 h-5 grid place-items-center text-[6px] font-semibold text-emerald-800">
          Accept
        </div>
        <div className="mt-1.5 h-12 rounded bg-slate-100 grid place-items-center">
          <MapPin className="h-3.5 w-3.5 text-slate-400" />
        </div>
      </div>
    </div>
  );
}
function AIVisual() {
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-md">
      <div className="flex items-center gap-1 text-[9px] font-semibold text-[#1a2a52]">
        <Sparkles className="h-2.5 w-2.5" /> Parsed 12 trips
      </div>
      <div className="mt-1 space-y-0.5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-1 rounded bg-slate-200 w-16" />
        ))}
      </div>
    </div>
  );
}
function AdVisual() {
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 flex gap-2">
      <div className="rounded-lg bg-white border border-slate-200 p-2 shadow-md w-24 md:w-28">
        <div className="h-10 rounded bg-gradient-to-br from-[#1a2a52] to-[#3b5bdb]" />
        <div className="mt-1.5 h-1 rounded bg-slate-200 w-3/4" />
        <div className="mt-1 h-1 rounded bg-slate-200 w-1/2" />
      </div>
      <div className="rounded-lg bg-white border border-slate-200 p-2 shadow-md w-24 md:w-28">
        <div className="h-10 rounded bg-gradient-to-br from-emerald-500 to-teal-600" />
        <div className="mt-1.5 h-1 rounded bg-slate-200 w-2/3" />
        <div className="mt-1 h-1 rounded bg-slate-200 w-1/2" />
      </div>
    </div>
  );
}

/* ==================== CLIENT EXPERIENCE ==================== */
function ClientExperience() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 md:px-6 md:py-24">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-12 items-center">
        <div className="text-center md:text-left">
          <div className="text-[11px] md:text-xs font-semibold uppercase tracking-widest text-[#1a2a52]">
            The client experience
          </div>
          <h2 className="mt-3 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.05]">
            Put the trip in <span className="text-[#1a2a52]">their pocket.</span>
          </h2>
          <p className="mt-4 text-base md:text-lg text-slate-600 leading-relaxed">
            Send a secure booking link straight to your VIP corporate client or hotel guest. They
            confirm in one tap, then get live driver location, private chat with the driver, and a
            one-tap SOS safety button — no app to install.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-slate-700 max-w-md mx-auto md:mx-0 text-left">
            {[
              ["Live driver GPS + accurate ETA", MapPin],
              ["Private chat per trip — no WhatsApp mess", MessageCircle],
              ["One-tap SOS safety button", ShieldAlert],
            ].map(([t, Icon]: any) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1a2a52]/10 text-[#1a2a52] shrink-0">
                  <Icon className="h-4 w-4" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex justify-center">
          <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-[#1a2a52]/15 to-emerald-100/60 blur-2xl" />
          <ClientPortalPhone />
        </div>
      </div>
    </section>
  );
}

/* ============================ FINAL CTA ============================ */
function FinalCta() {
  return (
    <section className="px-5 py-12 md:px-6 md:py-16">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#0f1a35] p-8 md:p-20 text-center relative">
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(50% 60% at 20% 20%, rgba(59,91,219,0.6), transparent 60%), radial-gradient(40% 50% at 80% 80%, rgba(16,185,129,0.35), transparent 60%)",
          }}
        />
        <div className="relative">
          <img src={logoAsset.url} alt="" className="mx-auto h-14 md:h-16 w-auto rounded-xl bg-white/5 p-1" />
          <h2 className="mt-5 md:mt-6 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-[1.05]">
            Built for the realities of Maltese transport.
          </h2>
          <p className="mt-4 max-w-2xl mx-auto text-base md:text-lg text-slate-300">
            Stop turning away jobs because you don't have enough cars. Connect your network today.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row justify-center gap-2.5">
            <Link
              to="/request-access"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-[#0f1a35] shadow-xl hover:bg-slate-100 transition-all"
            >
              Get Started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/request-access"
              search={{ demo: "1" }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
            >
              Book a Demo
            </Link>
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
      <div className="mx-auto max-w-6xl px-5 md:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <img src={logoAsset.url} alt="" className="h-7 w-7 object-contain" />
          <div className="text-xs md:text-sm text-slate-600 text-center sm:text-left">
            © {new Date().getFullYear()} The Coordinators · Transport Network Hub
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs md:text-sm text-slate-500">
          <Link to="/auth" className="hover:text-slate-900">Login</Link>
          <a href="mailto:hello@coordinatormt.com" className="hover:text-slate-900">Contact</a>
        </div>
      </div>
    </footer>
  );
}
