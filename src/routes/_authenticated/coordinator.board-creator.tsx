import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Rnd } from "react-rnd";
import { QRCodeSVG } from "qrcode.react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { z } from "zod";
import {
  listMyLogos,
  getLogoUploadUrl,
  registerUploadedLogo,
  deleteMyLogo,
  setPrimaryLogo,
  getBoardTripContext,
  saveTripBoardConfig,
} from "@/lib/board-creator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Trash2, Upload, Star, StarOff, Type, Image as ImageIcon, QrCode,
  ArrowUp, ArrowDown, Copy, Save, Download, ArrowLeft, Plus, PaintBucket,
} from "lucide-react";

const CANVAS_W = 720;
const CANVAS_H = 1280;
const PREVIEW_W = 300; // ~iPhone SE width
const searchSchema = z.object({ jobId: z.string().uuid().optional() });

type ElementBase = { id: string; x: number; y: number; w: number; h: number; z: number };
type TextElement = ElementBase & {
  type: "text";
  content: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  fontFamily: string;
};
type LogoElement = ElementBase & { type: "logo"; logoId: string };
type QRElement = ElementBase & { type: "qr"; value: string };
type BoardElement = TextElement | LogoElement | QRElement;

type BoardConfig = {
  version: 1;
  bg: { type: "color" | "gradient" | "image"; value: string; imageLogoId?: string };
  elements: BoardElement[];
};

const DEFAULT_CFG: BoardConfig = {
  version: 1,
  bg: { type: "gradient", value: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" },
  elements: [],
};

const FONT_OPTIONS = [
  { label: "System Sans", value: "system-ui, -apple-system, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, SFMono-Regular, monospace" },
];

const BG_PRESETS = [
  { name: "Midnight", type: "gradient" as const, value: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" },
  { name: "Ocean", type: "gradient" as const, value: "linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)" },
  { name: "Sunset", type: "gradient" as const, value: "linear-gradient(135deg, #dc2626 0%, #f59e0b 100%)" },
  { name: "Forest", type: "gradient" as const, value: "linear-gradient(135deg, #064e3b 0%, #059669 100%)" },
  { name: "White", type: "color" as const, value: "#ffffff" },
  { name: "Black", type: "color" as const, value: "#000000" },
];

export const Route = createFileRoute("/_authenticated/coordinator/board-creator")({
  head: () => ({ meta: [{ title: "Board Creator — Coordinator" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: BoardCreatorPage,
});

function BoardCreatorPage() {
  const { jobId } = Route.useSearch();
  const qc = useQueryClient();

  const listLogosFn = useServerFn(listMyLogos);
  const getUploadUrlFn = useServerFn(getLogoUploadUrl);
  const registerFn = useServerFn(registerUploadedLogo);
  const deleteLogoFn = useServerFn(deleteMyLogo);
  const setPrimaryFn = useServerFn(setPrimaryLogo);
  const getTripFn = useServerFn(getBoardTripContext);
  const saveBoardFn = useServerFn(saveTripBoardConfig);

  const { data: logosData, refetch: refetchLogos } = useQuery({
    queryKey: ["board-creator", "logos"],
    queryFn: () => listLogosFn(),
  });

  const { data: trip } = useQuery({
    queryKey: ["board-creator", "trip", jobId],
    queryFn: () => (jobId ? getTripFn({ data: { job_id: jobId } }) : Promise.resolve(null)),
    enabled: !!jobId,
  });

  const [cfg, setCfg] = useState<BoardConfig>(DEFAULT_CFG);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const bootstrappedRef = useRef(false);

  // Seed from trip context once, when trip data lands
  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (!trip) {
      // Seed a sample layout so an empty board doesn't look broken
      if (!jobId) {
        setCfg((c) => ({
          ...c,
          elements: c.elements.length ? c.elements : sampleElements("SAMPLE PASSENGER", "FLIGHT AA123"),
        }));
        bootstrappedRef.current = true;
      }
      return;
    }
    if (trip.board_config) {
      setCfg(trip.board_config as BoardConfig);
    } else {
      const paxLine = trip.first_pax || "Welcome";
      const flightLine = trip.flight_number ? `Flight ${trip.flight_number}` : "";
      setCfg((c) => ({ ...c, elements: sampleElements(paxLine, flightLine) }));
    }
    bootstrappedRef.current = true;
  }, [trip, jobId]);

  const updateCfg = (updater: (c: BoardConfig) => BoardConfig) => {
    setCfg((prev) => updater(prev));
    setDirty(true);
  };

  const selectedElement = cfg.elements.find((e) => e.id === selectedId) ?? null;

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const info = await getUploadUrlFn({
        data: { filename: file.name, content_type: file.type || "application/octet-stream" },
      });
      const putRes = await fetch(info.signed_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      return registerFn({ data: { storage_path: info.path } });
    },
    onSuccess: (res) => {
      toast.success("Logo uploaded");
      if (res.over_limit) {
        toast.warning(
          `You now have ${res.logo_count} logos. 5 are free — a flat weekly fee of ${res.weekly_cost} points applies while you have more than 5.`,
        );
      }
      qc.invalidateQueries({ queryKey: ["board-creator", "logos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteLogoFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["board-creator", "logos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const primaryMut = useMutation({
    mutationFn: (id: string) => setPrimaryFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Primary logo set");
      qc.invalidateQueries({ queryKey: ["board-creator", "logos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      if (!jobId) throw new Error("Open this page from a Trip Card to save.");
      return saveBoardFn({ data: { job_id: jobId, board_config: cfg } });
    },
    onSuccess: () => {
      toast.success("Board saved to trip");
      setDirty(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addText = () => {
    const el: TextElement = {
      id: crypto.randomUUID(), type: "text",
      x: 80, y: 200, w: 560, h: 120, z: nextZ(cfg),
      content: "New Text", fontSize: 72, fontWeight: 700,
      color: "#ffffff", align: "center", fontFamily: FONT_OPTIONS[0].value,
    };
    updateCfg((c) => ({ ...c, elements: [...c.elements, el] }));
    setSelectedId(el.id);
  };

  const addLogo = () => {
    const primary = logosData?.logos.find((l: any) => !l.is_background && l.is_primary) || logosData?.logos.find((l: any) => !l.is_background);
    if (!primary) return toast.info("Upload a logo first (bottom of the panel)");
    const el: LogoElement = {
      id: crypto.randomUUID(), type: "logo",
      x: 220, y: 60, w: 280, h: 280, z: nextZ(cfg),
      logoId: primary.id,
    };
    updateCfg((c) => ({ ...c, elements: [...c.elements, el] }));
    setSelectedId(el.id);
  };

  const addQR = () => {
    const url = trip?.client_link_token
      ? `${window.location.origin}/track/${trip.client_link_token}`
      : `${window.location.origin}/`;
    const el: QRElement = {
      id: crypto.randomUUID(), type: "qr",
      x: 260, y: 940, w: 200, h: 200, z: nextZ(cfg),
      value: url,
    };
    updateCfg((c) => ({ ...c, elements: [...c.elements, el] }));
    setSelectedId(el.id);
  };

  const deleteEl = (id: string) => {
    updateCfg((c) => ({ ...c, elements: c.elements.filter((e) => e.id !== id) }));
    setSelectedId(null);
  };

  const duplicateEl = (id: string) => {
    const src = cfg.elements.find((e) => e.id === id);
    if (!src) return;
    const copy = { ...src, id: crypto.randomUUID(), x: src.x + 24, y: src.y + 24, z: nextZ(cfg) } as BoardElement;
    updateCfg((c) => ({ ...c, elements: [...c.elements, copy] }));
    setSelectedId(copy.id);
  };

  const moveZ = (id: string, dir: 1 | -1) => {
    updateCfg((c) => ({
      ...c,
      elements: c.elements.map((e) => e.id === id ? { ...e, z: e.z + dir } : e),
    }));
  };

  const exportPng = async () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = await toPng(canvasRef.current, { pixelRatio: 2, cacheBust: true });
      const link = document.createElement("a");
      link.download = `sign-board-${trip?.first_pax || "preview"}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      toast.error("Could not export image");
    }
  };

  const scale = PREVIEW_W / CANVAS_W;

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3 flex-wrap">
        <Link
          to={jobId ? "/coordinator/calendar" : "/coordinator"}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Board Creator</h1>
          <p className="text-xs text-muted-foreground">
            {trip ? (
              <>Linked to trip · {trip.first_pax || "—"}{trip.flight_number ? ` · ${trip.flight_number}` : ""}</>
            ) : jobId ? "Loading trip…" : "No trip linked — design a template preview"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportPng}>
          <Download className="h-4 w-4 mr-1" /> Export PNG
        </Button>
        <Button size="sm" onClick={() => saveMut.mutate()} disabled={!jobId || saveMut.isPending || !dirty}>
          <Save className="h-4 w-4 mr-1" /> {dirty ? "Save" : "Saved"}
        </Button>
      </header>

      {logosData?.over_limit && (
        <div className="mx-4 mt-3 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <strong>Extra-logo fee active.</strong> You have <b>{logosData.logo_count}</b> logos.
          The first 5 are free — a flat weekly fee of <b>{logosData.weekly_cost} points</b> is charged
          every Monday while you have more than 5.
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-4 p-4">
        {/* Left: Editor */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={addText}><Type className="h-4 w-4 mr-1" /> Text</Button>
            <Button size="sm" variant="outline" onClick={addLogo}><ImageIcon className="h-4 w-4 mr-1" /> Logo</Button>
            <Button size="sm" variant="outline" onClick={addQR}><QrCode className="h-4 w-4 mr-1" /> QR</Button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex items-center gap-1"><PaintBucket className="h-3 w-3" /> Background</span>
              {BG_PRESETS.map((p) => (
                <button
                  key={p.name}
                  title={p.name}
                  onClick={() => updateCfg((c) => ({ ...c, bg: { type: p.type, value: p.value } }))}
                  className="h-6 w-6 rounded border shadow-sm"
                  style={{ background: p.value }}
                />
              ))}
            </div>
          </div>

          {/* Canvas (scaled to fit; kept at true CANVAS_W×CANVAS_H internally) */}
          <div className="rounded-lg border bg-muted/30 p-4 overflow-auto">
            <div className="mx-auto" style={{ width: CANVAS_W * 0.6, height: CANVAS_H * 0.6 }}>
              <div
                style={{ transform: `scale(0.6)`, transformOrigin: "top left", width: CANVAS_W, height: CANVAS_H }}
              >
                <Canvas
                  cfg={cfg}
                  logos={logosData?.logos ?? []}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onUpdate={(el) => updateCfg((c) => ({ ...c, elements: c.elements.map((x) => x.id === el.id ? el : x) }))}
                  editable
                />
              </div>
            </div>
          </div>

          {/* Selected element controls */}
          {selectedElement && (
            <div className="rounded-lg border bg-card p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium capitalize">{selectedElement.type} element</div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => moveZ(selectedElement.id, 1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => moveZ(selectedElement.id, -1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => duplicateEl(selectedElement.id)}><Copy className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteEl(selectedElement.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>

              {selectedElement.type === "text" && (
                <TextElementEditor
                  el={selectedElement}
                  onChange={(patch) => updateCfg((c) => ({
                    ...c,
                    elements: c.elements.map((e) => e.id === selectedElement.id ? { ...e, ...patch } as TextElement : e),
                  }))}
                />
              )}
              {selectedElement.type === "logo" && (
                <LogoElementEditor
                  el={selectedElement}
                  logos={logosData?.logos ?? []}
                  onChange={(patch) => updateCfg((c) => ({
                    ...c,
                    elements: c.elements.map((e) => e.id === selectedElement.id ? { ...e, ...patch } as LogoElement : e),
                  }))}
                />
              )}
              {selectedElement.type === "qr" && (
                <div>
                  <Label className="text-xs">QR value (URL)</Label>
                  <Input
                    value={selectedElement.value}
                    onChange={(e) => updateCfg((c) => ({
                      ...c,
                      elements: c.elements.map((x) => x.id === selectedElement.id ? { ...x, value: e.target.value } as QRElement : x),
                    }))}
                  />
                </div>
              )}
            </div>
          )}

          {/* Logos panel */}
          <div className="rounded-lg border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium">Company Logos</h2>
                <p className="text-xs text-muted-foreground">
                  {logosData?.logo_count ?? 0} of {logosData?.free_limit ?? 5} free · beyond that: {logosData?.weekly_cost ?? 0} pts/week (flat)
                </p>
              </div>
              <UploadButton onFile={(f) => uploadMut.mutate(f)} pending={uploadMut.isPending} />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {(logosData?.logos ?? []).filter((l: any) => !l.is_background).map((l: any) => (
                <div key={l.id} className="relative group border rounded p-1 bg-white">
                  <img src={l.url} alt={l.label || "logo"} className="h-16 w-full object-contain" />
                  <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 p-1 opacity-0 group-hover:opacity-100 bg-black/40 transition">
                    <button
                      className="text-white text-[10px] p-1 rounded bg-white/10 hover:bg-white/20"
                      title={l.is_primary ? "Primary" : "Set primary"}
                      onClick={() => primaryMut.mutate(l.id)}
                    >
                      {l.is_primary ? <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" /> : <StarOff className="h-3 w-3" />}
                    </button>
                    <button
                      className="text-white text-[10px] p-1 rounded bg-white/10 hover:bg-destructive"
                      title="Delete"
                      onClick={() => { if (confirm("Delete this logo?")) deleteMut.mutate(l.id); }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
              {(logosData?.logos ?? []).filter((l: any) => !l.is_background).length === 0 && (
                <div className="col-span-full text-center text-xs text-muted-foreground py-6">
                  No logos yet — upload your first one.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Live phone preview */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="text-xs text-muted-foreground mb-2 text-center">Live driver preview</div>
          <div className="mx-auto" style={{ width: PREVIEW_W + 24 }}>
            <div className="rounded-[36px] border-4 border-neutral-800 bg-neutral-800 p-2 shadow-2xl">
              <div className="relative rounded-[28px] overflow-hidden bg-black" style={{ width: PREVIEW_W, height: PREVIEW_W * (CANVAS_H / CANVAS_W) }}>
                <div className="absolute top-1 left-1/2 -translate-x-1/2 h-3 w-16 rounded-full bg-black z-10" />
                <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: CANVAS_W, height: CANVAS_H }}>
                  <Canvas cfg={cfg} logos={logosData?.logos ?? []} selectedId={null} onSelect={() => {}} onUpdate={() => {}} editable={false} />
                </div>
              </div>
            </div>
          </div>
          {/* Hidden canvas used for PNG export (real size) */}
          <div style={{ position: "absolute", left: -99999, top: 0 }}>
            <div ref={canvasRef} style={{ width: CANVAS_W, height: CANVAS_H }}>
              <Canvas cfg={cfg} logos={logosData?.logos ?? []} selectedId={null} onSelect={() => {}} onUpdate={() => {}} editable={false} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function nextZ(cfg: BoardConfig) {
  return (cfg.elements.reduce((m, e) => Math.max(m, e.z), 0) || 0) + 1;
}

function sampleElements(paxName: string, subLine: string): BoardElement[] {
  const els: BoardElement[] = [
    {
      id: crypto.randomUUID(), type: "text", x: 80, y: 220, w: 560, h: 100, z: 1,
      content: "Welcome", fontSize: 56, fontWeight: 500, color: "#f8fafc",
      align: "center", fontFamily: FONT_OPTIONS[0].value,
    },
    {
      id: crypto.randomUUID(), type: "text", x: 40, y: 340, w: 640, h: 200, z: 2,
      content: paxName.toUpperCase(), fontSize: 96, fontWeight: 800, color: "#ffffff",
      align: "center", fontFamily: FONT_OPTIONS[0].value,
    },
  ];
  if (subLine) {
    els.push({
      id: crypto.randomUUID(), type: "text", x: 80, y: 560, w: 560, h: 80, z: 3,
      content: subLine, fontSize: 44, fontWeight: 500, color: "#e0e7ef",
      align: "center", fontFamily: FONT_OPTIONS[0].value,
    });
  }
  return els;
}

/* ---------------- Canvas ---------------- */

function Canvas({
  cfg, logos, selectedId, onSelect, onUpdate, editable,
}: {
  cfg: BoardConfig;
  logos: any[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (el: BoardElement) => void;
  editable: boolean;
}) {
  const bgStyle = useMemo(() => {
    if (cfg.bg.type === "color") return { background: cfg.bg.value };
    if (cfg.bg.type === "gradient") return { background: cfg.bg.value };
    if (cfg.bg.type === "image" && cfg.bg.imageLogoId) {
      const lg = logos.find((l) => l.id === cfg.bg.imageLogoId);
      if (lg) return { backgroundImage: `url(${lg.url})`, backgroundSize: "cover", backgroundPosition: "center" };
    }
    return { background: "#0f172a" };
  }, [cfg.bg, logos]);

  const sorted = [...cfg.elements].sort((a, b) => a.z - b.z);
  return (
    <div
      className="relative select-none"
      style={{ width: CANVAS_W, height: CANVAS_H, ...bgStyle }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      {sorted.map((el) =>
        editable ? (
          <Rnd
            key={el.id}
            size={{ width: el.w, height: el.h }}
            position={{ x: el.x, y: el.y }}
            onDragStop={(_, d) => onUpdate({ ...el, x: d.x, y: d.y })}
            onResizeStop={(_, __, ref, ___, pos) =>
              onUpdate({ ...el, w: parseInt(ref.style.width), h: parseInt(ref.style.height), x: pos.x, y: pos.y })
            }
            bounds="parent"
            style={{ zIndex: el.z, outline: selectedId === el.id ? "2px solid #22d3ee" : "none" }}
            onMouseDown={() => onSelect(el.id)}
          >
            <ElementRenderer el={el} logos={logos} />
          </Rnd>
        ) : (
          <div key={el.id} style={{ position: "absolute", left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.z }}>
            <ElementRenderer el={el} logos={logos} />
          </div>
        ),
      )}
    </div>
  );
}

function ElementRenderer({ el, logos }: { el: BoardElement; logos: any[] }) {
  if (el.type === "text") {
    return (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center",
          justifyContent: el.align === "left" ? "flex-start" : el.align === "right" ? "flex-end" : "center",
          textAlign: el.align, color: el.color, fontSize: el.fontSize, fontWeight: el.fontWeight,
          fontFamily: el.fontFamily, lineHeight: 1.1, padding: "0 8px", overflow: "hidden",
          textShadow: "0 2px 12px rgba(0,0,0,0.25)",
        }}
      >
        {el.content}
      </div>
    );
  }
  if (el.type === "logo") {
    const lg = logos.find((l) => l.id === el.logoId);
    if (!lg) return <div className="w-full h-full flex items-center justify-center text-xs text-white/60">Logo missing</div>;
    return <img src={lg.url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
  }
  if (el.type === "qr") {
    return (
      <div className="w-full h-full bg-white p-2 flex items-center justify-center">
        <QRCodeSVG value={el.value} size={Math.min(el.w, el.h) - 16} />
      </div>
    );
  }
  return null;
}

/* ---------------- Editors ---------------- */

function TextElementEditor({ el, onChange }: { el: TextElement; onChange: (patch: Partial<TextElement>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Label className="text-xs">Text</Label>
        <Textarea rows={2} value={el.content} onChange={(e) => onChange({ content: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Font size ({el.fontSize})</Label>
        <Slider value={[el.fontSize]} min={16} max={200} step={2} onValueChange={([v]) => onChange({ fontSize: v })} />
      </div>
      <div>
        <Label className="text-xs">Weight ({el.fontWeight})</Label>
        <Slider value={[el.fontWeight]} min={300} max={900} step={100} onValueChange={([v]) => onChange({ fontWeight: v })} />
      </div>
      <div>
        <Label className="text-xs">Color</Label>
        <Input type="color" value={el.color} onChange={(e) => onChange({ color: e.target.value })} className="h-9 p-1" />
      </div>
      <div>
        <Label className="text-xs">Align</Label>
        <div className="flex gap-1">
          {(["left", "center", "right"] as const).map((a) => (
            <Button key={a} size="sm" variant={el.align === a ? "default" : "outline"} className="flex-1" onClick={() => onChange({ align: a })}>
              {a}
            </Button>
          ))}
        </div>
      </div>
      <div className="col-span-2">
        <Label className="text-xs">Font family</Label>
        <select
          className="w-full h-9 px-2 rounded-md border bg-background text-sm"
          value={el.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
        >
          {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
    </div>
  );
}

function LogoElementEditor({ el, logos, onChange }: { el: LogoElement; logos: any[]; onChange: (patch: Partial<LogoElement>) => void }) {
  return (
    <div>
      <Label className="text-xs">Choose logo</Label>
      <div className="grid grid-cols-4 gap-2 mt-1">
        {logos.filter((l) => !l.is_background).map((l: any) => (
          <button
            key={l.id}
            className={`border rounded p-1 bg-white ${el.logoId === l.id ? "ring-2 ring-primary" : ""}`}
            onClick={() => onChange({ logoId: l.id })}
          >
            <img src={l.url} className="h-12 w-full object-contain" />
          </button>
        ))}
      </div>
    </div>
  );
}

function UploadButton({ onFile, pending }: { onFile: (f: File) => void; pending: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); if (ref.current) ref.current.value = ""; }}
      />
      <Button size="sm" onClick={() => ref.current?.click()} disabled={pending}>
        <Upload className="h-4 w-4 mr-1" /> {pending ? "Uploading…" : "Upload"}
      </Button>
    </>
  );
}
