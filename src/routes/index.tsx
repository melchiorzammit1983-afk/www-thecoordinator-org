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

// Modern Black & Yellow color scheme
const COLORS = {
  black: "#0F0F0F",
  blackLight: "#1A1A1A",
  blackDark: "#000000",
  yellow: "#FFD700",
  yellowBright: "#FFF500",
  yellowGlow: "#FFEB3B",
  white: "#FFFFFF",
  greyLight: "#F5F5F5",
  greyMed: "#808080",
};

function Landing() {
  return (
    <div className="min-h-screen antialiased" style={{ backgroundColor: COLORS.black, color: COLORS.white }}>
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

/* ============================ ABSTRACT MALTA MAP ============================ */
function AbstractMaltaMap() {
  return (
    <svg
      viewBox="0 0 400 400"
      className="absolute inset-0 w-full h-full opacity-60"
      style={{ filter: "url(#glow)" }}
    >
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="maltaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={COLORS.yellow} stopOpacity="0.4" />
          <stop offset="100%" stopColor={COLORS.yellowGlow} stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Abstract Malta outline - simplified geometric shape */}
      <path
        d="M 180 80 Q 200 85 210 100 L 220 120 Q 225 130 220 145 L 210 160 Q 200 170 190 175 L 170 180 Q 150 175 140 160 L 135 140 Q 130 120 140 100 Q 155 85 180 80 Z"
        fill="none"
        stroke={COLORS.yellow}
        strokeWidth="1.5"
        opacity="0.6"
      />

      {/* Gozo outline */}
      <path
        d="M 130 60 Q 140 62 145 70 L 142 82 Q 135 80 130 75 Z"
        fill="none"
        stroke={COLORS.yellowGlow}
        strokeWidth="1"
        opacity="0.5"
      />

      {/* Network nodes - transport hubs */}
      {[
        { x: 200, y: 130, r: 3, label: "Valletta" },
        { x: 160, y: 145, r: 2.5, label: "South" },
        { x: 220, y: 140, r: 2.5, label: "East" },
        { x: 180, y: 100, r: 2, label: "North" },
        { x: 175, y: 160, r: 2, label: "West" },
      ].map((node, i) => (
        <g key={i}>
          <circle cx={node.x} cy={node.y} r={node.r} fill={COLORS.yellow} opacity="0.7" />
          <circle
            cx={node.x}
            cy={node.y}
            r={node.r + 1.5}
            fill="none"
            stroke={COLORS.yellow}
            strokeWidth="0.8"
            opacity="0.4"
          />
        </g>
      ))}

      {/* Connection lines - transport routes */}
      <g stroke={COLORS.yellow} strokeWidth="0.8" opacity="0.3" strokeDasharray="2,2">
        <line x1="200" y1="130" x2="160" y2="145" />
        <line x1="200" y1="130" x2="220" y2="140" />
        <line x1="200" y1="130" x2="180" y2="100" />
        <line x1="200" y1="130" x2="175" y2="160" />
        <line x1="160" y1="145" x2="175" y2="160" />
        <line x1="220" y1="140" x2="175" y2="160" />
      </g>

      {/* Animated moving dots (trips in progress) - BIGGER & MORE VISIBLE */}
      <circle cx="190" cy="125" r="2.5" fill={COLORS.yellowBright} opacity="0.9">
        <animate attributeName="r" values="2.5;4.5;2.5" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.9;0.4;0.9" dur="3s" repeatCount="indefinite" />
      </circle>

      <circle cx="210" cy="140" r="2" fill={COLORS.yellowBright} opacity="0.7">
        <animate attributeName="r" values="2;3.5;2" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.7;0.3;0.7" dur="4s" repeatCount="indefinite" />
      </circle>

      <circle cx="170" cy="150" r="1.5" fill={COLORS.yellowBright} opacity="0.6">
        <animate attributeName="r" values="1.5;3;1.5" dur="5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.6;0.2;0.6" dur="5s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

/* ============================ NAV ============================ */
function Nav() {
  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{
        backgroundColor: `${COLORS.black}dd`,
        borderColor: COLORS.yellow,
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 md:px-6 md:py-3">
        <a href="/" className="flex items-center gap-2 min-w-0">
          <img src={logoAsset.url} alt="The Coordinators" className="h-9 md:h-11 w-auto shrink-0" />
          <span className="hidden sm:block text-[15px] font-semibold tracking-tight" style={{ color: COLORS.white }}>
            The Coordinators
          </span>
        </a>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <Link
            to="/auth"
            className="rounded-xl px-3 md:px-4 py-2 text-xs md:text-sm font-medium transition-colors"
            style={{ color: COLORS.yellow, backgroundColor: "transparent" }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = `${COLORS.yellow}15`;
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = "transparent";
            }}
          >
            Login
          </Link>
          <Link
            to="/request-access"
            search={{ demo: "1" }}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 md:px-4 py-2 text-xs md:text-sm font-semibold transition-all"
            style={{
              backgroundColor: COLORS.yellow,
              color: COLORS.black,
              boxShadow: `0 0 12px ${COLORS.yellow}30`,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.boxShadow = `0 0 20px ${COLORS.yellow}50`;
              (e.target as HTMLElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.boxShadow = `0 0 12px ${COLORS.yellow}30`;
              (e.target as HTMLElement).style.transform = "translateY(0)";
            }}
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
    <section className="relative overflow-hidden min-h-[85vh] flex items-center">
      {/* Abstract Malta Map Background */}
      <div className="absolute inset-0 -z-10">
        <AbstractMaltaMap />
        {/* Dark overlay for readability */}
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${COLORS.blackLight}aa, ${COLORS.black}ff)`,
          }}
        />
      </div>

      <div className="mx-auto max-w-6xl px-5 py-16 md:px-6 md:py-24 w-full relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">
          {/* Text Content */}
          <div className="text-center md:text-left">
            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] md:text-xs font-medium"
              style={{
                borderColor: COLORS.yellow,
                backgroundColor: `${COLORS.yellow}10`,
                color: COLORS.yellow,
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Built in Malta for Maltese transport operators
            </div>

            {/* Main Heading */}
            <h1 className="mt-6 text-[2rem] leading-[1.05] font-bold tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
              <span style={{ color: COLORS.white }}>Stop manually dispatching.</span>
              <br />
              <span style={{ color: COLORS.yellow }}>Start collaborating.</span>
            </h1>

            {/* Description */}
            <p className="mx-auto md:mx-0 mt-5 max-w-xl text-base md:text-lg leading-relaxed" style={{ color: COLORS.greyLight }}>
              The all-in-one transport network for Malta's hotels, shipping agents, and fleet owners. Dispatch trips,
              track flights, and share jobs instantly—without forcing your drivers to download an app.
            </p>

            {/* CTA Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center md:justify-start gap-3">
              <Link
                to="/request-access"
                className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold transition-all"
                style={{
                  backgroundColor: COLORS.yellow,
                  color: COLORS.black,
                  boxShadow: `0 8px 24px ${COLORS.yellow}35`,
                }}
              >
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center justify-center gap-2 rounded-xl border px-6 py-3.5 text-sm font-semibold transition-all hover:bg-opacity-10"
                style={{
                  borderColor: COLORS.yellow,
                  color: COLORS.yellow,
                }}
              >
                See How It Works
              </a>
            </div>

            {/* Features List */}
            <div className="mt-6 flex flex-wrap items-center justify-center md:justify-start gap-x-5 gap-y-2 text-[11px] md:text-xs">
              {["Pay as you go", "No driver app required", "Live flight tracking"].map((feature) => (
                <span key={feature} className="inline-flex items-center gap-1.5" style={{ color: COLORS.white }}>
                  <Check className="h-3.5 w-3.5" style={{ color: COLORS.yellow }} /> {feature}
                </span>
              ))}
            </div>
          </div>

          {/* Phone Mockup */}
          <div className="relative flex justify-center">
            <div
              className="absolute -inset-6 -z-10 rounded-[3rem] blur-2xl opacity-40"
              style={{
                background: `linear-gradient(135deg, ${COLORS.yellow}25, ${COLORS.yellowGlow}08)`,
              }}
            />
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
      className={`relative w-full ${compact ? "max-w-[220px]" : "max-w-[260px]"} rounded-[2.25rem] border-[8px] bg-white shadow-2xl overflow-hidden`}
      style={{ aspectRatio: "9 / 19", borderColor: COLORS.black }}
    >
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 h-5 w-24 rounded-b-2xl z-10"
        style={{ backgroundColor: COLORS.black }}
      />

      {/* Header */}
      <div className="px-3 pt-8 pb-3 text-white" style={{ backgroundColor: COLORS.black }}>
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
                <div
                  className="h-1 rounded-full"
                  style={{
                    backgroundColor: i <= 1 ? COLORS.yellow : "#E0E0E0",
                  }}
                />
                <div
                  className="mt-1 text-[7px] text-center font-semibold"
                  style={{
                    color: i <= 1 ? COLORS.black : "#999",
                  }}
                >
                  {s}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live map */}
        <div className="relative h-32 rounded-lg overflow-hidden" style={{ backgroundColor: "#F0F0F0" }}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_60%,#dbeafe_0,transparent_45%),radial-gradient(circle_at_70%_40%,#d1fae5_0,transparent_45%)]" />
          <svg viewBox="0 0 200 130" className="absolute inset-0 w-full h-full">
            <path d="M10 110 Q 60 80, 90 90 T 160 40" stroke={COLORS.yellow} strokeWidth="2" strokeLinecap="round" fill="none" strokeDasharray="4 3" />
          </svg>
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 shadow text-[9px] font-semibold text-slate-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Andrei · 4 min
          </div>
          <div
            className="absolute left-[45%] top-[55%] h-3 w-3 rounded-full ring-4"
            style={{
              backgroundColor: COLORS.yellow,
              boxShadow: `0 0 0 4px ${COLORS.yellow}40`,
            }}
          />
          <div className="absolute right-3 bottom-2 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
        </div>

        {/* Trip details */}
        <div className="rounded-lg border p-2 text-[9px] leading-snug" style={{ borderColor: "#E0E0E0" }}>
          <div className="flex items-center gap-1 text-slate-500">
            <Plane className="h-2.5 w-2.5" /> KM110 · on time
          </div>
          <div className="font-semibold text-slate-800 mt-0.5">MLA Airport → Le Meridien</div>
          <div className="text-slate-500">Pickup 14:20 · 2 pax</div>
        </div>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button className="rounded-lg py-2 text-[10px] font-semibold flex items-center justify-center gap-1" style={{ backgroundColor: "#F0F0F0", color: COLORS.black }}>
            <MessageCircle className="h-3 w-3" /> Chat
          </button>
          <button className="rounded-lg py-2 text-[10px] font-bold text-white flex items-center justify-center gap-1 bg-red-600">
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
    <section className="mx-auto max-w-6xl px-5 py-20 md:px-6 md:py-32">
      <div className="text-center">
        <div className="text-[11px] md:text-xs font-semibold uppercase tracking-widest" style={{ color: COLORS.yellow }}>
          The shift
        </div>
        <h2 className="mt-4 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight" style={{ color: COLORS.white }}>
          From WhatsApp chaos to total control.
        </h2>
      </div>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Old Way */}
        <div
          className="rounded-2xl border p-6 md:p-8"
          style={{
            borderColor: "#FF6B6B",
            backgroundColor: `#FF6B6B15`,
          }}
        >
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: "#FF6B6B30", color: "#FF6B6B" }}>
            <X className="h-3.5 w-3.5" /> The old way
          </div>
          <p className="mt-4 text-base md:text-lg leading-relaxed" style={{ color: COLORS.greyLight }}>
            Endlessly typing out WhatsApp messages, manually tracking delayed flights, and losing
            <span style={{ color: "#FF6B6B", fontWeight: "600" }}> 20% of your day</span> to administrative chaos.
          </p>
        </div>

        {/* New Way */}
        <div
          className="rounded-2xl border p-6 md:p-8"
          style={{
            borderColor: COLORS.yellow,
            backgroundColor: `${COLORS.yellow}10`,
          }}
        >
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: `${COLORS.yellow}25`, color: COLORS.yellow }}>
            <Check className="h-3.5 w-3.5" /> The new way
          </div>
          <p className="mt-4 text-base md:text-lg leading-relaxed" style={{ color: COLORS.greyLight }}>
            Drag-and-drop dispatching, AI-powered bulk uploads, and instant live tracking links.
            <span style={{ color: COLORS.yellow, fontWeight: "600" }}> Total control in seconds.</span>
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
    <section id="how" className="mx-auto max-w-6xl px-5 py-20 md:px-6 md:py-32">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[11px] md:text-xs font-semibold uppercase tracking-widest" style={{ color: COLORS.yellow }}>
          How it works
        </div>
        <h2 className="mt-4 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight" style={{ color: COLORS.white }}>
          From booking to billed in one flow.
        </h2>
        <p className="mt-4 text-base md:text-lg" style={{ color: COLORS.greyLight }}>
          The exact workflow every coordinator on the platform runs, every day.
        </p>
      </div>

      <ol className="mt-14 grid grid-cols-1 md:grid-cols-4 gap-5">
        {steps.map((s) => (
          <li
            key={s.n}
            className="relative rounded-2xl border p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all"
            style={{
              borderColor: COLORS.yellow,
              backgroundColor: COLORS.blackLight,
            }}
          >
            <div className="flex items-center justify-between">
              <div
                className="grid h-8 w-8 place-items-center rounded-lg text-white text-[11px] font-bold"
                style={{
                  backgroundColor: COLORS.yellow,
                  color: COLORS.black,
                }}
              >
                {s.n}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: COLORS.greyMed }}>
                Step
              </div>
            </div>
            <div className="mt-4 h-32 rounded-xl border overflow-hidden relative" style={{ borderColor: COLORS.yellow, backgroundColor: "#0A0A0A" }}>
              {s.visual}
            </div>
            <h3 className="mt-4 text-base font-semibold" style={{ color: COLORS.white }}>
              {s.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: COLORS.greyLight }}>
              {s.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepPasteVisual() {
  return (
    <div className="absolute inset-2 rounded-lg border p-2 text-[8px] font-mono leading-tight overflow-hidden" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight, color: COLORS.greyLight }}>
      <div className="text-[9px] font-sans font-semibold mb-1 flex items-center gap-1" style={{ color: COLORS.yellow }}>
        <Clipboard className="h-2.5 w-2.5" /> Paste bookings
      </div>
      <div>Guest 1 — MLA 14:20 KM110 2pax</div>
      <div>Guest 2 — Corinthia → MLA 16:00</div>
      <div>Guest 3 — MLA → Valletta RY4501</div>
      <div className="mt-1.5 inline-block rounded px-1.5 py-0.5 text-[8px] font-sans" style={{ backgroundColor: COLORS.yellow, color: COLORS.black }}>
        Parse with AI
      </div>
    </div>
  );
}

function StepAIVisual() {
  return (
    <div className="absolute inset-2 rounded-lg border p-2 space-y-1 overflow-hidden" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight }}>
      <div className="text-[9px] font-semibold flex items-center gap-1" style={{ color: COLORS.yellow }}>
        <Sparkles className="h-2.5 w-2.5" /> 3 trips parsed
      </div>
      {[
        { t: "14:20", r: "MLA → Le Meridien", f: "KM110" },
        { t: "16:00", r: "Corinthia → MLA", f: "—" },
        { t: "17:45", r: "MLA → Valletta", f: "RY4501" },
      ].map((r) => (
        <div key={r.t} className="flex items-center gap-1.5 text-[8px]" style={{ color: COLORS.greyLight }}>
          <span className="font-mono font-semibold" style={{ color: COLORS.white }}>
            {r.t}
          </span>
          <span className="flex-1 truncate">{r.r}</span>
          <span style={{ color: COLORS.greyMed }}>{r.f}</span>
          <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
        </div>
      ))}
    </div>
  );
}

function StepDriverVisual() {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2 p-2">
      <div className="flex-1 rounded-lg border p-2 text-[8px]" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight, color: COLORS.white }}>
        <div className="font-semibold flex items-center gap-1" style={{ color: COLORS.yellow }}>
          <Send className="h-2.5 w-2.5" /> Send link
        </div>
        <div className="mt-1" style={{ color: COLORS.greyMed }}>
          Driver · Andrei
        </div>
        <div className="mt-1 h-3.5 rounded grid place-items-center text-[7px] font-bold text-white bg-emerald-500">
          WhatsApp
        </div>
      </div>
      <div className="h-24 w-14 rounded-lg border-2 p-1 text-[6px] shrink-0" style={{ borderColor: COLORS.black, backgroundColor: COLORS.white }}>
        <div className="rounded-sm px-1 py-0.5 font-semibold text-white" style={{ backgroundColor: COLORS.black }}>
          Trip
        </div>
        <div className="mt-1" style={{ color: COLORS.black }}>
          14:20 MLA → Le Meridien
        </div>
        <div className="mt-1 h-3 rounded grid place-items-center font-semibold bg-emerald-100 text-emerald-800">
          Accept
        </div>
      </div>
    </div>
  );
}

function StepTrackVisual() {
  return (
    <div className="absolute inset-2 rounded-lg border p-1.5 space-y-1 overflow-hidden" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight }}>
      {[
        { t: "14:20", tone: "emerald", who: "Andrei" },
        { t: "16:00", tone: "amber", who: "Partner ↗" },
        { t: "17:45", tone: "sky", who: "Marco" },
      ].map((c) => (
        <div key={c.t} className="relative rounded border pl-2 pr-1.5 py-1 text-[8px]" style={{ borderColor: COLORS.yellow, backgroundColor: "#0A0A0A" }}>
          <span
            className="absolute left-0 top-1 bottom-1 w-0.5 rounded"
            style={{
              backgroundColor: c.tone === "emerald" ? "#10B981" : c.tone === "amber" ? "#F59E0B" : "#0EA5E9",
            }}
          />
          <div className="font-mono font-semibold" style={{ color: COLORS.white }}>
            {c.t}
          </div>
          <div className="flex items-center gap-1" style={{ color: COLORS.greyMed }}>
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
    <section className="mx-auto max-w-6xl px-5 py-20 md:px-6 md:py-32">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[11px] md:text-xs font-semibold uppercase tracking-widest" style={{ color: COLORS.yellow }}>
          Features
        </div>
        <h2 className="mt-4 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight" style={{ color: COLORS.white }}>
          Everything a transport network needs.
        </h2>
        <p className="mt-4 text-base md:text-lg" style={{ color: COLORS.greyLight }}>
          Purpose-built for the pace and pressure of Malta's transfer market.
        </p>
      </div>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-6 gap-5 md:auto-rows-[220px]">
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
      className={`group relative overflow-hidden rounded-2xl border p-5 md:p-6 hover:shadow-lg hover:-translate-y-0.5 transition-all ${className}`}
      style={{
        borderColor: COLORS.yellow,
        backgroundColor: COLORS.blackLight,
      }}
    >
      <div className="relative z-10 max-w-md">
        <div
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border"
          style={{
            backgroundColor: COLORS.yellow,
            color: COLORS.black,
            borderColor: COLORS.yellow,
          }}
        >
          {icon}
        </div>
        <h3 className="mt-4 text-lg font-semibold" style={{ color: COLORS.white }}>
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: COLORS.greyLight }}>
          {body}
        </p>
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
          <stop offset="0" stopColor={COLORS.yellow} />
          <stop offset="1" stopColor={COLORS.yellowGlow} />
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
    <div className="pointer-events-none absolute right-4 bottom-4 h-36 w-20 rounded-[1rem] border-4 bg-white shadow-2xl overflow-hidden" style={{ borderColor: COLORS.black }}>
      <div className="text-white px-1.5 py-1 text-[7px] font-semibold" style={{ backgroundColor: COLORS.black }}>
        Your Trip
      </div>
      <div className="p-1.5 space-y-1">
        <div className="h-1.5 rounded w-3/4" style={{ backgroundColor: "#E0E0E0" }} />
        <div className="h-1.5 rounded w-1/2" style={{ backgroundColor: "#E0E0E0" }} />
        <div className="mt-1.5 rounded h-5 grid place-items-center text-[6px] font-semibold bg-emerald-100 text-emerald-800">
          Accept
        </div>
        <div className="mt-1.5 h-12 rounded grid place-items-center" style={{ backgroundColor: "#F0F0F0" }}>
          <MapPin className="h-3.5 w-3.5" style={{ color: COLORS.greyMed }} />
        </div>
      </div>
    </div>
  );
}

function AIVisual() {
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 rounded-lg border px-2.5 py-2 shadow-md" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight }}>
      <div className="flex items-center gap-1 text-[9px] font-semibold" style={{ color: COLORS.yellow }}>
        <Sparkles className="h-2.5 w-2.5" /> Parsed 12 trips
      </div>
      <div className="mt-1 space-y-0.5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-1 rounded w-16" style={{ backgroundColor: COLORS.yellow + "30" }} />
        ))}
      </div>
    </div>
  );
}

function AdVisual() {
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 flex gap-2">
      <div className="rounded-lg border p-2 shadow-md w-24 md:w-28" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight }}>
        <div className="h-10 rounded bg-gradient-to-br" style={{ backgroundImage: `linear-gradient(135deg, ${COLORS.black}, ${COLORS.yellow})` }} />
        <div className="mt-1.5 h-1 rounded w-3/4" style={{ backgroundColor: COLORS.yellow + "30" }} />
        <div className="mt-1 h-1 rounded w-1/2" style={{ backgroundColor: COLORS.yellow + "30" }} />
      </div>
      <div className="rounded-lg border p-2 shadow-md w-24 md:w-28" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight }}>
        <div className="h-10 rounded bg-gradient-to-br from-emerald-500 to-teal-600" />
        <div className="mt-1.5 h-1 rounded w-2/3" style={{ backgroundColor: COLORS.yellow + "30" }} />
        <div className="mt-1 h-1 rounded w-1/2" style={{ backgroundColor: COLORS.yellow + "30" }} />
      </div>
    </div>
  );
}

/* ==================== CLIENT EXPERIENCE ==================== */
function ClientExperience() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 md:px-6 md:py-32">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16 items-center">
        <div className="text-center md:text-left">
          <div className="text-[11px] md:text-xs font-semibold uppercase tracking-widest" style={{ color: COLORS.yellow }}>
            The client experience
          </div>
          <h2 className="mt-4 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.05]" style={{ color: COLORS.white }}>
            Put the trip in <span style={{ color: COLORS.yellow }}>their pocket.</span>
          </h2>
          <p className="mt-5 text-base md:text-lg leading-relaxed" style={{ color: COLORS.greyLight }}>
            Send a secure booking link straight to your VIP corporate client or hotel guest. They confirm in one tap, then get live driver location, private chat with the driver, and a one-tap SOS safety button — no app to install.
          </p>
          <ul className="mt-7 space-y-3 text-sm max-w-md mx-auto md:mx-0 text-left">
            {[
              ["Live driver GPS + accurate ETA", MapPin],
              ["Private chat per trip — no WhatsApp mess", MessageCircle],
              ["One-tap SOS safety button", ShieldAlert],
            ].map(([t, Icon]: any) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg shrink-0" style={{ backgroundColor: `${COLORS.yellow}15`, color: COLORS.yellow }}>
                  <Icon className="h-4 w-4" />
                </span>
                <span style={{ color: COLORS.white }}>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex justify-center">
          <div
            className="absolute -inset-6 -z-10 rounded-[3rem] blur-2xl opacity-35"
            style={{
              background: `linear-gradient(135deg, ${COLORS.yellow}20, ${COLORS.yellowGlow}05)`,
            }}
          />
          <ClientPortalPhone />
        </div>
      </div>
    </section>
  );
}

/* ============================ FINAL CTA ============================ */
function FinalCta() {
  return (
    <section className="px-5 py-14 md:px-6 md:py-20">
      <div
        className="mx-auto max-w-6xl overflow-hidden rounded-3xl p-10 md:p-24 text-center relative"
        style={{
          backgroundColor: COLORS.blackLight,
          background: `linear-gradient(135deg, ${COLORS.blackLight}, ${COLORS.black})`,
        }}
      >
        <div
          className="absolute inset-0 opacity-15"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${COLORS.yellow}40, transparent 70%)`,
          }}
        />
        <div className="relative">
          <img src={logoAsset.url} alt="" className="mx-auto h-14 md:h-16 w-auto rounded-xl p-1" style={{ backgroundColor: `${COLORS.yellow}12` }} />
          <h2 className="mt-6 md:mt-8 text-[1.75rem] md:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.05]" style={{ color: COLORS.white }}>
            Built for the realities of Maltese transport.
          </h2>
          <p className="mt-5 max-w-2xl mx-auto text-base md:text-lg" style={{ color: COLORS.greyLight }}>
            Stop turning away jobs because you don't have enough cars. Connect your network today.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
            <Link
              to="/request-access"
              className="inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-sm font-bold shadow-lg transition-all"
              style={{
                backgroundColor: COLORS.yellow,
                color: COLORS.black,
                boxShadow: `0 8px 24px ${COLORS.yellow}30`,
              }}
            >
              Get Started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/request-access"
              search={{ demo: "1" }}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-sm font-semibold transition-all"
              style={{
                borderColor: COLORS.yellow,
                color: COLORS.yellow,
                border: `1px solid ${COLORS.yellow}`,
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.backgroundColor = `${COLORS.yellow}12`;
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.backgroundColor = "transparent";
              }}
            >
              Book a Demo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================ HOW POINTS WORK ============================ */
function HowPointsWork() {
  const items = [
    { title: "Pay as you go", body: "No monthly lock-in. Buy points, spend only when you use the platform." },
    { title: "Fractional pricing", body: "A trip is 1.5 pts. Dispatching to a partner is 0.5 pts. A client SMS link is 0.25 pts." },
    { title: "Top up anytime", body: "Request a top-up from your dashboard. Volume discounts on larger packs." },
  ];

  return (
    <section id="pricing" className="border-t" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight }}>
      <div className="mx-auto max-w-6xl px-5 md:px-6 py-16 md:py-24">
        <div className="text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold" style={{ backgroundColor: `${COLORS.yellow}15`, color: COLORS.yellow }}>
            Pay as you go
          </div>
          <h2 className="mt-4 text-3xl md:text-4xl font-bold tracking-tight" style={{ color: COLORS.white }}>
            Simple points-based pricing
          </h2>
          <p className="mt-4" style={{ color: COLORS.greyLight }}>
            No subscriptions. No wasted seats. You only pay for the actions your team actually takes.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          {items.map((it) => (
            <div
              key={it.title}
              className="rounded-2xl border p-6 shadow-sm"
              style={{
                borderColor: COLORS.yellow,
                backgroundColor: COLORS.black,
              }}
            >
              <div className="h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold" style={{ backgroundColor: `${COLORS.yellow}15`, color: COLORS.yellow }}>
                pts
              </div>
              <h3 className="mt-4 font-semibold" style={{ color: COLORS.white }}>
                {it.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: COLORS.greyLight }}>
                {it.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            to="/request-access"
            className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all"
            style={{
              backgroundColor: COLORS.yellow,
              color: COLORS.black,
              boxShadow: `0 6px 20px ${COLORS.yellow}25`,
            }}
          >
            Get Started <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ============================ TRUST STRIP ============================ */
function TrustStrip() {
  return (
    <section className="border-t" style={{ borderColor: COLORS.yellow }}>
      <div className="mx-auto max-w-6xl px-5 md:px-6 py-14 md:py-20">
        <p className="text-center text-xs uppercase tracking-[0.15em] font-semibold" style={{ color: COLORS.greyMed }}>
          Trusted by operators across Malta
        </p>
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-lg border flex items-center justify-center text-[11px] font-medium"
              style={{
                borderColor: COLORS.yellow,
                backgroundColor: COLORS.blackLight,
                color: COLORS.greyMed,
              }}
            >
              Your logo
            </div>
          ))}
        </div>
        <blockquote className="mt-12 max-w-3xl mx-auto rounded-2xl border p-7 md:p-10 text-center" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight }}>
          <p className="text-base md:text-lg leading-relaxed" style={{ color: COLORS.white }}>
            "We stopped losing jobs on busy weekends. The Coordinator lets us push overflow to trusted partners in seconds."
          </p>
          <footer className="mt-4 text-sm" style={{ color: COLORS.greyMed }}>
            — Operations Manager, Maltese transport company
          </footer>
        </blockquote>
      </div>
    </section>
  );
}

/* ============================ FAQ ============================ */
function FaqSection() {
  const faqs = [
    {
      q: "How much does it cost?",
      a: "Pay-as-you-go with points. A trip costs ~1.5 pts, dispatching to a partner ~0.5 pts, sending a client tracking SMS ~0.25 pts. Top up whenever you need to — no monthly subscription required.",
    },
    {
      q: "Do drivers need to install an app?",
      a: "No. Drivers get a plain web link on their phone — no installs, no app-store hoops, no logins.",
    },
    {
      q: "Is it available outside Malta?",
      a: "Right now we're focused on serving Malta's hotels, shipping agents, and fleet owners. Reach out if you're elsewhere — we'll let you know when we expand.",
    },
    {
      q: "How do I get access?",
      a: "The Coordinator is invite-only. Submit the request form and we'll review and approve within 24 hours.",
    },
    {
      q: "Where is my data stored?",
      a: "In a secure cloud with strict role-based access. Only you and the partners you explicitly connect with can see your trips.",
    },
  ];

  return (
    <section className="border-t" style={{ borderColor: COLORS.yellow, backgroundColor: COLORS.blackLight }}>
      <div className="mx-auto max-w-3xl px-5 md:px-6 py-16 md:py-24">
        <div className="text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ color: COLORS.white }}>
            Frequently asked questions
          </h2>
        </div>
        <div className="mt-10 space-y-3">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="group rounded-xl border p-5 md:p-6 open:shadow-sm"
              style={{
                borderColor: COLORS.yellow,
                backgroundColor: COLORS.black,
              }}
            >
              <summary
                className="cursor-pointer list-none flex items-center justify-between gap-3 font-semibold"
                style={{ color: COLORS.white }}
              >
                <span>{f.q}</span>
                <span
                  className="h-6 w-6 rounded-full flex items-center justify-center group-open:rotate-45 transition-transform"
                  style={{
                    backgroundColor: `${COLORS.yellow}15`,
                    color: COLORS.yellow,
                  }}
                >
                  +
                </span>
              </summary>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: COLORS.greyLight }}>
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================ FOOTER ============================ */
function Footer() {
  return (
    <footer className="border-t" style={{ borderColor: COLORS.yellow }}>
      <div className="mx-auto max-w-6xl px-5 md:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <img src={logoAsset.url} alt="" className="h-7 w-7 object-contain" />
          <div className="text-xs md:text-sm text-center sm:text-left" style={{ color: COLORS.greyMed }}>
            © {new Date().getFullYear()} The Coordinators · Transport Network Hub
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs md:text-sm">
          <Link to="/auth" style={{ color: COLORS.yellow }}>
            Login
          </Link>
          <a href="mailto:hello@coordinatormt.com" style={{ color: COLORS.yellow }}>
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
