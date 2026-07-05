import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDriverSignBoard } from "@/lib/coordinator-public.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ArrowLeft, Settings2, Sun, Moon, Maximize2 } from "lucide-react";
import { useWakeLock } from "@/hooks/use-wake-lock";

export const Route = createFileRoute("/m/driver/$token/sign/$jobId")({
  head: () => ({ meta: [{ title: "Sign Board" }, { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" }] }),
  component: SignBoardPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen grid place-items-center px-4 bg-black text-white">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Sign Board error</h1>
        <p className="text-sm text-white/60 mt-2">{error.message}</p>
      </div>
    </div>
  ),
});

// Tiny silent WebM (~1KB) that keeps most iOS browsers awake when the
// Screen Wake Lock API isn't available. Base64-embedded so no network fetch.
const SILENT_VIDEO_SRC =
  "data:video/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15RIlACECPQAAAAAAAFlSua0AxrkAu14EBY8WBAZyBACK1nEADdW5khkAFVl9WUDglhohAA1ZQOIOBAeBABrCBCLqBCB9DtnVAIueBAKNAHIEAAIAwAQCdASoIAAgAAUAmJaQAA3AA/vz0AAA=";

type Field = "passenger" | "flight" | "company";

function SignBoardPage() {
  const { token, jobId } = Route.useParams();
  const dataFn = useServerFn(getDriverSignBoard);

  const { data, isLoading, error } = useQuery({
    queryKey: ["driver-sign-board", token, jobId],
    queryFn: () => dataFn({ data: { token, job_id: jobId } }),
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState<Record<Field, boolean>>({
    passenger: true,
    flight: false,
    company: false,
  });
  const [sheetOpen, setSheetOpen] = useState(false);

  // Wake lock (native) + silent-video fallback for iOS Safari
  const { supported: wakeSupported, held } = useWakeLock(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (wakeSupported && held) return;
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.play().catch(() => {
      // Retry on first user gesture (iOS may require it)
      const retry = () => {
        v.play().catch(() => {});
        document.removeEventListener("touchstart", retry);
        document.removeEventListener("click", retry);
      };
      document.addEventListener("touchstart", retry, { once: true });
      document.addEventListener("click", retry, { once: true });
    });
  }, [wakeSupported, held]);

  const job = data?.job;
  const boardCfg = data?.board_config as
    | null
    | { bg?: { type: "color" | "gradient" | "image"; value: string; imageLogoId?: string } };
  const bg = useMemo(() => {
    if (boardCfg?.bg) {
      if (boardCfg.bg.type === "image" && boardCfg.bg.imageLogoId) {
        const url = data?.logos.find((l) => l.id === boardCfg.bg?.imageLogoId)?.url;
        if (url) return { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" } as const;
      }
      if (boardCfg.bg.type === "color") return { background: boardCfg.bg.value } as const;
      if (boardCfg.bg.type === "gradient") return { backgroundImage: boardCfg.bg.value } as const;
    }
    return { background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" } as const;
  }, [boardCfg, data?.logos]);

  // Light/dark toggle — starts dark, driver can flip in bright sun.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const themeStyle =
    theme === "light"
      ? { color: "#0f172a", textShadowColor: "rgba(255,255,255,0.6)" }
      : { color: "#ffffff", textShadowColor: "rgba(0,0,0,0.55)" };
  const lightOverride =
    theme === "light" ? { background: "#ffffff", backgroundImage: "none" } : {};

  // Landscape detection for logo-left layout (tablets held sideways)
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape) and (min-width: 640px)");
    const apply = () => setLandscape(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // Fullscreen API on open (best-effort — iOS Safari ignores; that's fine)
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const req = (el as any).requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
    if (!req) return;
    const tryEnter = () => { try { req().catch?.(() => {}); } catch { /* ignore */ } };
    tryEnter();
    // Retry on first user gesture (browsers require it)
    const retry = () => {
      tryEnter();
      document.removeEventListener("touchstart", retry);
      document.removeEventListener("click", retry);
    };
    document.addEventListener("touchstart", retry, { once: true });
    document.addEventListener("click", retry, { once: true });
    return () => {
      document.removeEventListener("touchstart", retry);
      document.removeEventListener("click", retry);
    };
  }, []);

  const anchorLogo = data?.anchor_logo_url ?? null;

  const lines = useMemo(() => {
    if (!job) return [] as string[];
    const out: string[] = [];
    if (selected.passenger && job.passenger_name) out.push(job.passenger_name.toUpperCase());
    if (selected.flight && job.flight_number) out.push(job.flight_number.toUpperCase());
    if (selected.company && job.client_company_name) out.push(job.client_company_name);
    return out;
  }, [selected, job]);

  if (isLoading) {
    return <div className="min-h-screen grid place-items-center bg-black text-white/70">Loading sign board…</div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen grid place-items-center bg-black text-white/80 px-6 text-center">
        {error instanceof Error ? error.message : "Unable to load sign board"}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden text-white select-none"
      style={bg}
    >
      {/* Silent video fallback — visually hidden, keeps screen awake on iOS */}
      <video
        ref={videoRef}
        src={SILENT_VIDEO_SRC}
        muted
        loop
        playsInline
        aria-hidden
        className="pointer-events-none absolute h-px w-px opacity-0"
      />

      {/* Top bar (auto-hides after a few seconds could be added; keep static) */}
      <div className="flex items-center justify-between px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 z-10">
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="text-white/80 hover:text-white hover:bg-white/10"
        >
          <Link to="/m/driver/$token" params={{ token }}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Link>
        </Button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button size="sm" variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10">
              <Settings2 className="h-4 w-4 mr-1" /> Choose
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>Show on sign</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-3">
              <FieldRow
                label="Passenger name"
                value={job?.passenger_name}
                checked={selected.passenger}
                onChange={(v) => setSelected((s) => ({ ...s, passenger: v }))}
              />
              <FieldRow
                label="Flight number"
                value={job?.flight_number}
                checked={selected.flight}
                onChange={(v) => setSelected((s) => ({ ...s, flight: v }))}
              />
              <FieldRow
                label="Client company"
                value={job?.client_company_name}
                checked={selected.company}
                onChange={(v) => setSelected((s) => ({ ...s, company: v }))}
              />
              <p className="text-xs text-muted-foreground pt-2">
                Screen will stay awake while the sign board is open.
              </p>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Anchored dispatcher logo */}
      {anchorLogo && (
        <div className="flex justify-center pt-2 pb-1 z-10">
          <img
            src={anchorLogo}
            alt={data.company_name || "Dispatcher"}
            className="h-[10vh] max-h-24 min-h-12 w-auto object-contain drop-shadow-lg"
          />
        </div>
      )}

      {/* Main text area — auto-scaled with clamp() + viewport units */}
      <div className="flex-1 grid place-items-center px-[4vw] pb-[calc(env(safe-area-inset-bottom)+1rem)] z-10 min-h-0">
        {lines.length === 0 ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="text-center text-white/60 text-[clamp(1rem,3vw,1.5rem)] leading-snug"
          >
            Tap <span className="underline">Choose</span> to display trip info
          </button>
        ) : (
          <div
            className="grid gap-[2vh] w-full text-center font-bold tracking-tight leading-[1.05]"
            style={{
              gridAutoRows: "1fr",
            }}
          >
            {lines.map((text, i) => (
              <AutoScaleLine key={i} text={text} totalLines={lines.length} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AutoScaleLine({ text, totalLines }: { text: string; totalLines: number }) {
  // Font size scales inversely with number of lines AND character length so
  // long names shrink automatically instead of overflowing. Uses clamp on
  // both viewport axes so it works landscape + portrait, phone + tablet.
  const base = totalLines === 1 ? 18 : totalLines === 2 ? 12 : 9; // vmin
  const len = Math.max(text.length, 6);
  const shrink = Math.min(1, 18 / len); // long text → smaller
  const vmin = base * shrink;
  return (
    <div
      className="grid place-items-center min-w-0 break-words"
      style={{
        fontSize: `clamp(1.75rem, ${vmin}vmin, 22vmin)`,
      }}
    >
      <span className="block max-w-full">{text}</span>
    </div>
  );
}

function FieldRow({
  label,
  value,
  checked,
  onChange,
}: {
  label: string;
  value: string | undefined;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const disabled = !value;
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        disabled ? "opacity-50" : "cursor-pointer hover:bg-muted/40"
      }`}
    >
      <Checkbox
        checked={checked && !disabled}
        disabled={disabled}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-sm text-muted-foreground truncate">
          {value || "Not on this trip"}
        </div>
      </div>
    </label>
  );
}
