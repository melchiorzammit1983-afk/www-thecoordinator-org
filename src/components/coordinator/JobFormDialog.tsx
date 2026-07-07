import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createJob, updateJob, createJobsBulk, listJobPax, addJobPax, removeJobPax, setJobContactPhoneIfEmpty, extractTripsFromText, previewTripStatus, refreshJobLiveStatus, logAiTrainingSample } from "@/lib/coordinator.functions";
import { TrafficBadge } from "@/components/coordinator/TrafficBadge";
import { Plane, RefreshCw } from "lucide-react";
import { parseTrips, extractPhoneFromName, isMeaningfulName, type ParsedTrip } from "@/lib/parse-trips";
import { downloadExcelTemplate, downloadGoogleSheetsTemplate, looksLikeSheetPaste, parseSheetPaste, fileToSheetTsv, SHEET_HEADERS } from "@/lib/sheet-template";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileDown, Paperclip, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription,
  ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/mobile/ResponsiveDialog";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LabelPicker } from "@/components/coordinator/LabelPicker";
import { Users, PencilLine, Plus, Trash2, Sparkles, ChevronDown, Undo2, Wand2 } from "lucide-react";
import { useFeature } from "@/hooks/use-features";
import { VoiceToTripButton, type VoiceTrip } from "@/components/coordinator/VoiceToTripButton";
import { AddressAutocomplete } from "@/components/address/AddressAutocomplete";
import { resolveAddresses, estimateRouteEta } from "@/lib/places.functions";
import { useAddressSettings, toBias } from "@/hooks/use-address-settings";
import { formatEta } from "@/lib/trip-display";
import { Clock } from "lucide-react";

type Driver = { id: string; name: string; vehicle: string | null };

type Job = {
  id: string;
  from_location: string; to_location: string;
  date: string; time: string;
  flightorship: string | null;
  from_flight: string | null;
  to_flight: string | null;
  tracking_enabled: boolean; qr_strict_mode: boolean;
  vehicle: string | null;
  contact_phone: string | null;
  driver_id: string | null;
  clientcompanyname: string | null;
  pickup_place_id?: string | null;
  dropoff_place_id?: string | null;
  pickup_display_name?: string | null;
  dropoff_display_name?: string | null;
  route_duration_sec?: number | null;
  route_distance_m?: number | null;
  labels?: { id: string; name: string; color: string }[];
};

type Prefill = Partial<{
  from_location: string; to_location: string;
  date: string; time: string;
  from_flight: string; to_flight: string;
  clientcompanyname: string;
  pax: string[];
}>;

export function JobFormDialog({
  open, onOpenChange, drivers, job, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drivers: Driver[];
  job?: Job;
  onSaved: (createdDate?: string) => void;
}) {
  const isEdit = !!job;
  const bulkEnabled = useFeature("bulk_paste");
  const [tab, setTab] = useState<"manual" | "bulk">("manual");
  const [prefill, setPrefill] = useState<Prefill | undefined>(undefined);
  useEffect(() => { if (open) { setTab("manual"); setPrefill(undefined); } }, [open]);

  const handleComplete = (t: ParsedTrip) => {
    setPrefill({
      from_location: t.from_location, to_location: t.to_location,
      date: t.date, time: t.time,
      from_flight: t.from_flight, to_flight: t.to_flight,
      clientcompanyname: t.clientcompanyname,
      pax: t.pax,
    });
    setTab("manual");
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={(e: any) => e.preventDefault()}
        onInteractOutside={(e: any) => e.preventDefault()}
        onEscapeKeyDown={(e: any) => e.preventDefault()}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEdit ? "Edit trip" : "New trip"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Schedule a transfer, add passengers, and assign resources.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {isEdit ? (
          <ManualForm drivers={drivers} job={job} onSaved={onSaved} onCancel={() => onOpenChange(false)} />
        ) : !bulkEnabled ? (
          <ManualForm key={prefill ? "prefill" : "blank"} drivers={drivers} prefill={prefill} onSaved={onSaved} onCancel={() => onOpenChange(false)} />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "manual" | "bulk")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Manual</TabsTrigger>
              <TabsTrigger value="bulk">Paste bulk</TabsTrigger>
            </TabsList>
            <TabsContent value="manual" className="mt-3">
              <ManualForm key={prefill ? "prefill" : "blank"} drivers={drivers} prefill={prefill} onSaved={onSaved} onCancel={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="bulk" className="mt-3">
              <BulkForm onSaved={onSaved} onComplete={handleComplete} onCancel={() => onOpenChange(false)} />
            </TabsContent>
          </Tabs>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function ManualForm({
  drivers, job, prefill, onSaved, onCancel,
}: { drivers: Driver[]; job?: Job; prefill?: Prefill; onSaved: (createdDate?: string) => void; onCancel: () => void }) {

  const [from, setFrom] = useState(job?.from_location ?? prefill?.from_location ?? "");
  const [fromPlaceId, setFromPlaceId] = useState<string | null>(job?.pickup_place_id ?? null);
  const [fromDisplayName, setFromDisplayName] = useState<string | null>(job?.pickup_display_name ?? null);
  const [to, setTo] = useState(job?.to_location ?? prefill?.to_location ?? "");
  const [toPlaceId, setToPlaceId] = useState<string | null>(job?.dropoff_place_id ?? null);
  const [toDisplayName, setToDisplayName] = useState<string | null>(job?.dropoff_display_name ?? null);
  const [fromFlight, setFromFlight] = useState(job?.from_flight ?? prefill?.from_flight ?? "");
  const [toFlight, setToFlight] = useState(job?.to_flight ?? prefill?.to_flight ?? "");
  const [date, setDate] = useState(job?.date ?? prefill?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(job?.time?.slice(0, 5) ?? prefill?.time ?? "09:00");
  const [client, setClient] = useState(job?.clientcompanyname ?? prefill?.clientcompanyname ?? "");
  const [phone, setPhone] = useState(job?.contact_phone ?? "");
  const [driverId, setDriverId] = useState<string>(job?.driver_id ?? "__none__");
  
  const [track, setTrack] = useState(job?.tracking_enabled ?? false);
  const [paxText, setPaxText] = useState(prefill?.pax?.join("\n") ?? "");
  const [labelIds, setLabelIds] = useState<string[]>(job?.labels?.map((l) => l.id) ?? []);
  const [flightHint, setFlightHint] = useState<{ side: "from" | "to"; msg: string } | null>(null);

  // Detect a flight code in any format (KM 643 / km-0643 / flight KM643 / #KM643)
  // and return the normalized code plus the remaining text with the match removed.
  const FLIGHT_RE = /(?:^|\s|#|✈|\bflight\b|\bflt\b)\s*([A-Za-z]{2})\s*-?\s*(\d{1,4})(?=$|\s|[,.;])/i;
  function extractFlightCode(text: string): { code: string | null; rest: string } {
    const raw = (text ?? "").trim();
    if (!raw) return { code: null, rest: "" };
    const m = FLIGHT_RE.exec(raw);
    if (!m) return { code: null, rest: raw };
    const code = `${m[1].toUpperCase()}${m[2]}`;
    const rest = (raw.slice(0, m.index) + " " + raw.slice(m.index + m[0].length))
      .replace(/\b(flight|flt)\b/gi, "")
      .replace(/[#✈]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return { code, rest };
  }
  function showHint(side: "from" | "to", msg: string) {
    setFlightHint({ side, msg });
    setTimeout(() => setFlightHint((h) => (h && h.side === side && h.msg === msg ? null : h)), 3000);
  }
  function handleLocationBlur(side: "from" | "to") {
    const value = side === "from" ? from : to;
    const currentFlight = side === "from" ? fromFlight : toFlight;
    const setLoc = side === "from" ? setFrom : setTo;
    const setFlight = side === "from" ? setFromFlight : setToFlight;
    const { code, rest } = extractFlightCode(value);
    if (!code) return;
    if (currentFlight && currentFlight.toUpperCase() !== code) {
      setLoc(rest || "Airport");
      showHint(side, `Kept existing flight ${currentFlight}`);
      return;
    }
    setFlight(code);
    setLoc(rest || "Airport");
    showHint(side, `Moved ${code} to flight`);
  }
  function handleFlightBlur(side: "from" | "to") {
    const value = side === "from" ? fromFlight : toFlight;
    const loc = side === "from" ? from : to;
    const setLoc = side === "from" ? setFrom : setTo;
    const setFlight = side === "from" ? setFromFlight : setToFlight;
    const { code } = extractFlightCode(value);
    if (code) {
      if (code !== value.trim().toUpperCase()) setFlight(code);
      if (!loc.trim()) setLoc("Airport");
    }
  }

  const qc = useQueryClient();
  const createFn = useServerFn(createJob);
  const updateFn = useServerFn(updateJob);
  const bulkFn = useServerFn(createJobsBulk);
  const previewFn = useServerFn(previewTripStatus);
  const refreshFn = useServerFn(refreshJobLiveStatus);

  const canPreview = (!!from || !!to || !!fromFlight || !!toFlight) && !!date && !!time;
  const previewMut = useMutation({
    mutationFn: () => {
      // If the trip is already saved, persist the refresh so the calendar card
      // and client portal reflect it — otherwise fall back to a read-only preview.
      if (job?.id) return refreshFn({ data: { job_id: job.id } });
      return previewFn({ data: {
        from_location: from || (fromFlight ? "Airport" : ""),
        to_location: to || (toFlight ? "Airport" : ""),
        date, time,
        from_flight: fromFlight || undefined,
        to_flight: toFlight || undefined,
      } });
    },
    onSuccess: () => {
      if (job?.id) qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const preview = previewMut.data;


  const mut = useMutation({
    mutationFn: async () => {
      const effFrom = from || (fromFlight ? "Airport" : "");
      const effTo = to || (toFlight ? "Airport" : "");
      const payload = {
        from_location: effFrom, to_location: effTo, date, time,
        flightorship: fromFlight || toFlight || "",
        from_flight: fromFlight, to_flight: toFlight,
        clientcompanyname: client, contact_phone: phone,
        driver_id: driverId === "__none__" ? null : driverId,
        qr_strict_mode: false, tracking_enabled: track,
        label_ids: labelIds,
      };
      if (job) { await updateFn({ data: { id: job.id, ...payload } }); return date; }
      const pax = paxText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (pax.length) {
        await bulkFn({ data: { trips: [{
          from_location: effFrom, to_location: effTo, date, time,
          flightorship: fromFlight || toFlight || "",
          from_flight: fromFlight, to_flight: toFlight,
          clientcompanyname: client, pax,
        }], label_ids: labelIds } });
      } else {
        await createFn({ data: payload });
      }
      return date;
    },
    onSuccess: (savedDate) => {
      toast.success(job ? "Trip updated" : "Trip created");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onSaved(savedDate);
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
      {prefill && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          Prefilled from paste — fill in any missing fields highlighted below.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 min-w-0">
          <Label>From {!from && !fromFlight && <span className="text-destructive">*</span>}</Label>
          <AddressAutocomplete
            value={from}
            placeId={fromPlaceId}
            onChange={(v) => { setFrom(v.address); setFromPlaceId(v.place_id); }}
            onBlur={() => handleLocationBlur("from")}
            placeholder={fromFlight ? "Airport (auto)" : "Hotel, address…"}
          />
          <Input
            value={fromFlight}
            onChange={(e) => setFromFlight(e.target.value.toUpperCase())}
            onBlur={() => handleFlightBlur("from")}
            placeholder="Flight / Ship (e.g. EK109)"
            className="text-xs"
          />
          {flightHint?.side === "from" && (
            <div className="text-[10px] text-emerald-600">{flightHint.msg}</div>
          )}
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label>To {!to && !toFlight && <span className="text-destructive">*</span>}</Label>
          <AddressAutocomplete
            value={to}
            placeId={toPlaceId}
            onChange={(v) => { setTo(v.address); setToPlaceId(v.place_id); }}
            onBlur={() => handleLocationBlur("to")}
            placeholder={toFlight ? "Airport (auto)" : "Airport, address…"}
          />
          <Input
            value={toFlight}
            onChange={(e) => setToFlight(e.target.value.toUpperCase())}
            onBlur={() => handleFlightBlur("to")}
            placeholder="Flight / Ship (e.g. EK109)"
            className="text-xs"
          />
          {flightHint?.side === "to" && (
            <div className="text-[10px] text-emerald-600">{flightHint.msg}</div>
          )}
        </div>
        <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label>Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label>Client company</Label><Input value={client} onChange={(e) => setClient(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Phone number</Label><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+356 …" /></div>
        <div className="space-y-1.5 col-span-2">
          <Label>Driver</Label>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!job && (
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Passengers (one per line, optional)</Label>
          <Textarea
            rows={4} value={paxText}
            onChange={(e) => setPaxText(e.target.value)}
            placeholder={"ELMER CLEMENTE AGUINALDO\nNIXON KALATHILAPARAMBIL VINCENT"}
          />
        </div>
      )}
      {job && <PaxEditor jobId={job.id} />}
      <LabelPicker value={labelIds} onChange={setLabelIds} />
      <ToggleRow
        label="Enable Live Tracking" hint="GPS updates from driver device"
        checked={track} onChange={setTrack}
      />
      <div className="rounded-md border bg-muted/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-muted-foreground">Live status preview</div>
          <Button
            type="button" size="sm" variant="outline"
            disabled={!canPreview || previewMut.isPending}
            onClick={() => previewMut.mutate()}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${previewMut.isPending ? "animate-spin" : ""}`} />
            {previewMut.isPending ? "Checking…" : preview ? "Refresh" : "Check traffic & flight"}
          </Button>
        </div>
        {!preview && !previewMut.isPending && (
          <div className="text-[11px] text-muted-foreground">
            Fill from/to and date/time (and optional flight) then check for real-time delays before saving. Preview only — no points spent.
          </div>
        )}
        {preview && (
          <div className="space-y-2 text-xs">
            {preview.traffic ? (
              preview.traffic.ok ? (
                <div className="space-y-1">
                  <TrafficBadge info={{
                    traffic_delay_minutes: preview.traffic.delay_minutes ?? 0,
                    traffic_severity: preview.traffic.severity ?? null,
                    leave_by_at: preview.traffic.leave_by_at ?? null,
                  }} />
                  <div className="text-[11px] text-muted-foreground">
                    {preview.traffic.duration_text}
                    {preview.traffic.distance_text ? ` · ${preview.traffic.distance_text}` : ""}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  Traffic unavailable ({preview.traffic.reason ?? "error"}).
                </div>
              )
            ) : (
              <div className="text-[11px] text-muted-foreground">Traffic: need both From and To to estimate.</div>
            )}
            {preview.flight ? (
              preview.flight.ok ? (
                <div className="flex items-start gap-2">
                  <Plane className="h-3.5 w-3.5 mt-0.5 text-primary" />
                  <div>
                    <div className="font-medium">{preview.flight.code} · {preview.flight.status}</div>
                    <div className="text-[11px] text-muted-foreground">{preview.flight.note}</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Plane className="h-3.5 w-3.5" />
                  Flight {preview.flight.code}: {preview.flight.reason === "not_found" ? "not on Malta board" : preview.flight.reason === "not_configured" ? "flight lookup not configured" : "check failed"}
                </div>
              )
            ) : (
              (fromFlight || toFlight) ? null : (
                <div className="text-[11px] text-muted-foreground">Add a flight code to see arrival/departure status.</div>
              )
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Saving…" : job ? "Save" : "Create"}</Button>
      </DialogFooter>
    </form>
  );
}

type AiRow = {
  pickupDate: string; pickupTime: string;
  pickupAddress: string; deliveryAddress: string;
  customerName: string; contactNumber: string;
  transportType: string; quantity: string;
};
type AiResp =
  | { type: "question"; payload: string }
  | { type: "data"; payload: AiRow[]; is_low_confidence?: boolean; accuracy_score?: number; is_half_price?: boolean };
type ChatMsg = { role: "user" | "model"; text: string };

function rowsToTsv(rows: AiRow[]): string {
  const header = (SHEET_HEADERS as readonly string[]).join("\t");
  const body = rows.map((r) => [
    r.pickupDate, r.pickupTime, r.pickupAddress, r.deliveryAddress,
    r.customerName, r.contactNumber, r.transportType, r.quantity,
  ].map((c) => (c ?? "").toString().replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"));
  return [header, ...body].join("\n");
}

function recomputeTripErrors(t: ParsedTrip): ParsedTrip {
  const errors: string[] = [];
  if (!t.date?.trim()) errors.push("Missing date");
  if (!t.time?.trim()) errors.push("Missing time");
  if (!t.from_location?.trim()) errors.push("Missing pickup");
  if (!t.to_location?.trim()) errors.push("Missing delivery");
  return { ...t, errors };
}

type Attachment = { name: string; mimeType: string; size: number; dataBase64: string };

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const AI_MIME_RE = /^image\/(png|jpe?g|webp|heic|heif|gif)$|^application\/pdf$/i;
const SHEET_EXT_RE = /\.(xlsx|xls|csv)$/i;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(file);
  });
}

function BulkForm({ onSaved, onComplete, onCancel }: { onSaved: (createdDate?: string) => void; onComplete: (t: ParsedTrip) => void; onCancel: () => void }) {
  const [raw, setRaw] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const parsed = useMemo(
    () => (looksLikeSheetPaste(raw) ? parseSheetPaste(raw) : parseTrips(raw)),
    [raw],
  );
  // Editable overrides — mirror `parsed` and let coordinators tweak fields in place.
  const [edited, setEdited] = useState<ParsedTrip[]>(parsed);
  useEffect(() => { setEdited(parsed); }, [parsed]);
  const withErrors = useMemo(() => edited.map(recomputeTripErrors), [edited]);
  const valid = withErrors.filter((t) => t.errors.length === 0);
  const incomplete = withErrors.filter((t) => t.errors.length > 0);
  const aiEnabled = useFeature("ai_extraction");

  // ------- Address auto-fix (Google Places) -------
  // When enabled in settings, replace fuzzy From/To text with Google's top
  // match. Original text is stashed in trip.autoFixed so the user can undo.
  const { settings: addressSettings } = useAddressSettings();
  const resolveFn = useServerFn(resolveAddresses);
  const [autoFixBusy, setAutoFixBusy] = useState(false);
  const [autoFixed, setAutoFixed] = useState(false);

  useEffect(() => {
    if (!addressSettings.auto_fix_bulk) return;
    if (autoFixed) return;
    if (parsed.length === 0) return;
    let cancelled = false;
    const items: { key: string; text: string }[] = [];
    parsed.forEach((t, i) => {
      if (t.from_location && t.from_location.length >= 2 && !t.from_place_id) {
        items.push({ key: `${i}:from`, text: t.from_location });
      }
      if (t.to_location && t.to_location.length >= 2 && !t.to_place_id) {
        items.push({ key: `${i}:to`, text: t.to_location });
      }
    });
    if (items.length === 0) { setAutoFixed(true); return; }
    setAutoFixBusy(true);
    resolveFn({ data: { items, bias: toBias(addressSettings) } })
      .then((res) => {
        if (cancelled) return;
        setEdited((prev) => prev.map((t, i) => {
          const fromR = res.results[`${i}:from`];
          const toR = res.results[`${i}:to`];
          const next: ParsedTrip = { ...t };
          const af: NonNullable<ParsedTrip["autoFixed"]> = { ...(t.autoFixed ?? {}) };
          if (fromR && fromR.address && fromR.address !== t.from_location) {
            af.from_location = t.from_location;
            next.from_location = fromR.address;
            next.from_place_id = fromR.place_id;
            next.from_lat = fromR.lat;
            next.from_lng = fromR.lng;
          }
          if (toR && toR.address && toR.address !== t.to_location) {
            af.to_location = t.to_location;
            next.to_location = toR.address;
            next.to_place_id = toR.place_id;
            next.to_lat = toR.lat;
            next.to_lng = toR.lng;
          }
          if (af.from_location || af.to_location) next.autoFixed = af;
          return next;
        }));
        const fixedCount = Object.values(res.results).filter(Boolean).length;
        if (fixedCount > 0) toast.message(`Address auto-fix: cleaned ${fixedCount} field${fixedCount === 1 ? "" : "s"}`);
      })
      .catch(() => { /* silent — user can still fix manually */ })
      .finally(() => {
        if (!cancelled) { setAutoFixBusy(false); setAutoFixed(true); }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  // Any new paste resets the auto-fix guard.
  useEffect(() => { setAutoFixed(false); }, [raw]);

  // Chat state for the "Understand with AI" mini-chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  // Voice-to-trip transcript (surfaced when the coordinator uses the voice button)
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  // AI confidence — true when Gemini flags the extraction as fuzzy / partial.
  const [aiLowConfidence, setAiLowConfidence] = useState(false);

  // Learning-loop capture: remember the exact text + first AI draft so we
  // can compare it against the coordinator's final edits on save.
  const [aiOriginalText, setAiOriginalText] = useState<string | null>(null);
  const [aiInitialOutput, setAiInitialOutput] = useState<AiRow[] | null>(null);
  // Dynamic billing flags from the AI extraction (accuracy < 75% → half-price).
  const [aiBilling, setAiBilling] = useState<{ is_half_price: boolean; accuracy_score: number } | null>(null);

  const handleVoiceTrips = (trips: VoiceTrip[], transcript: string) => {
    setRaw((prev) => {
      const tsv = rowsToTsv(trips);
      return prev.trim() ? prev + "\n" + tsv : tsv;
    });
    setVoiceTranscript(transcript || null);
    setShowTranscript(false);
    setChatOpen(false);
  };

  const qc = useQueryClient();
  const bulkFn = useServerFn(createJobsBulk);
  const aiFn = useServerFn(extractTripsFromText);
  const logAiFn = useServerFn(logAiTrainingSample);

  const aiMut = useMutation({
    mutationFn: (payload: { messages: ChatMsg[]; attachments?: Omit<Attachment, "size">[]; urls?: string[] }) =>
      aiFn({ data: payload }) as Promise<AiResp>,
    onSuccess: (res) => {
      if (res.type === "question") {
        setPendingQuestion(res.payload);
        setChat((prev) => [...prev, { role: "model", text: res.payload }]);
        return;
      }
      const rows = res.payload ?? [];
      if (!rows.length) { toast.error("AI could not find any trips"); return; }
      // Capture the first AI draft + the raw text that produced it so we
      // can compare against the coordinator's final edits on save.
      const firstUserMsg = aiMut.variables?.messages?.find((m) => m.role === "user")?.text ?? raw;
      setAiOriginalText(firstUserMsg);
      setAiInitialOutput(rows);
      setRaw(rowsToTsv(rows));
      setAiLowConfidence(res.is_low_confidence === true);
      // Dynamic billing: record the accuracy-based discount flag so the bulk
      // save can forward it to the billing/invoice module.
      const score = typeof res.accuracy_score === "number" ? res.accuracy_score : 1;
      const halfPrice = res.is_half_price === true;
      setAiBilling({ is_half_price: halfPrice, accuracy_score: score });
      setChatOpen(false);
      setChat([]);
      setPendingQuestion(null);
      setReply("");
      setAttachments([]);
      if (halfPrice) {
        toast.warning(`AI accuracy ${Math.round(score * 100)}% — 50% discount will apply on save.`);
      } else if (res.is_low_confidence) {
        toast.warning("AI extracted trips, but confidence is low — please review.");
      } else {
        toast.success(`AI extracted ${rows.length} trip${rows.length === 1 ? "" : "s"}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;

    // 1) Handle spreadsheet files locally — no AI, no attachments.
    const sheets = arr.filter((f) => SHEET_EXT_RE.test(f.name) || /spreadsheet|excel|csv/i.test(f.type));
    for (const f of sheets) {
      try {
        const tsv = await fileToSheetTsv(f);
        if (tsv) {
          setRaw((prev) => (prev.trim() ? prev + "\n" + tsv : tsv));
          toast.success(`Loaded ${f.name} — parsed without AI`);
        } else {
          toast.error(`${f.name}: empty spreadsheet`);
        }
      } catch (e: any) {
        toast.error(`${f.name}: ${e?.message || "could not read"}`);
      }
    }

    // 2) Handle images/PDFs as AI attachments.
    const media = arr.filter((f) => AI_MIME_RE.test(f.type));
    const rejected = arr.filter((f) => !sheets.includes(f) && !media.includes(f));
    if (rejected.length) toast.error(`Unsupported: ${rejected.map((f) => f.name).join(", ")}`);

    const next: Attachment[] = [];
    for (const f of media) {
      if (f.size > MAX_BYTES) { toast.error(`${f.name} is over 10 MB`); continue; }
      if (attachments.length + next.length >= MAX_FILES) { toast.error(`Max ${MAX_FILES} attachments`); break; }
      try {
        const dataBase64 = await fileToBase64(f);
        next.push({ name: f.name, mimeType: f.type, size: f.size, dataBase64 });
      } catch {
        toast.error(`Could not read ${f.name}`);
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next].slice(0, MAX_FILES));
  };

  const startAi = () => {
    const text = raw.trim();
    if (!text && attachments.length === 0) return;
    // Skip the AI entirely when the paste already looks like sheet/CSV rows —
    // parseSheetPaste handles it locally at zero token cost.
    if (text && !attachments.length && looksLikeSheetPaste(text)) {
      toast.message("Looks like sheet data — parsed without AI");
      return;
    }
    const urls = Array.from(new Set(text.match(URL_RE) ?? [])).slice(0, 3);
    const userText = text || (attachments.length ? "Extract trips from the attached file(s)." : "");
    const messages: ChatMsg[] = [{ role: "user", text: userText }];
    setChat(messages);
    setChatOpen(true);
    setPendingQuestion(null);
    aiMut.mutate({
      messages,
      attachments: attachments.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 })),
      urls,
    });
  };

  const sendReply = () => {
    const t = reply.trim();
    if (!t) return;
    const next: ChatMsg[] = [...chat, { role: "user", text: t }];
    setChat(next);
    setReply("");
    setPendingQuestion(null);
    // Follow-ups keep attachments/urls (AI may need to re-read them for context).
    const urls = Array.from(new Set((raw.match(URL_RE) ?? []))).slice(0, 3);
    aiMut.mutate({
      messages: next,
      attachments: attachments.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 })),
      urls,
    });
  };

  const cancelChat = () => {
    setChatOpen(false); setChat([]); setPendingQuestion(null); setReply("");
  };


  const earliestValidDate = valid
    .map((t) => t.date)
    .filter(Boolean)
    .sort()[0];

  const mut = useMutation({
    mutationFn: () => bulkFn({ data: {
      trips: valid.map((t) => ({
        from_location: t.from_location, to_location: t.to_location,
        date: t.date, time: t.time,
        flightorship: t.flightorship, clientcompanyname: t.clientcompanyname,
        from_flight: t.from_flight, to_flight: t.to_flight,
        contact_phone: t.contact_phone,
        pax: t.pax,
      })),
      label_ids: labelIds,
      billing_flags: aiBilling ? {
        is_half_price: aiBilling.is_half_price,
        accuracy_score: aiBilling.accuracy_score,
      } : undefined,
    } }),
    onSuccess: (res: { created: string[]; billing?: { is_half_price: boolean; accuracy_score: number | null } }) => {
      const discountNote = res.billing?.is_half_price ? " (50% AI-accuracy discount applied)" : "";
      toast.success(`Created ${res.created.length} trip${res.created.length === 1 ? "" : "s"}${discountNote}`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      // Learning loop — fire-and-forget capture of AI draft vs. final human data.
      if (aiOriginalText && aiInitialOutput && aiInitialOutput.length) {
        logAiFn({ data: {
          original_text: aiOriginalText,
          ai_initial_output: aiInitialOutput,
          human_corrected_output: valid,
        } }).catch(() => { /* silent — must not block save */ });
        setAiOriginalText(null);
        setAiInitialOutput(null);
      }
      setAiBilling(null);
      if (incomplete.length === 0) onSaved(earliestValidDate);
      else toast.message(`${incomplete.length} incomplete — finish them in Manual`);
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Paste trips</Label>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="h-7">
                  <FileDown className="h-3 w-3 mr-1" />
                  Template
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => downloadExcelTemplate()}>
                  Microsoft Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadGoogleSheetsTemplate()}>
                  Google Sheets (.csv)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {aiEnabled && !chatOpen && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button" size="sm" variant="outline"
                  className="h-7"
                  disabled={aiMut.isPending || attachments.length >= MAX_FILES}
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach images, PDFs, or spreadsheet files"
                >
                  <Paperclip className="h-3 w-3 mr-1" />
                  Attach
                </Button>
                <Button
                  type="button" size="sm" variant="outline"
                  disabled={aiMut.isPending || (raw.trim().length < 3 && attachments.length === 0)}
                  onClick={startAi}
                  className="h-7"
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  {aiMut.isPending ? "Understanding…" : "Understand with AI"}
                </Button>
              </>
            )}
          </div>
        </div>

        {!chatOpen && (
          <div className="flex items-center gap-2">
            <VoiceToTripButton onTrips={handleVoiceTrips} disabled={aiMut.isPending} />
            <span className="text-[11px] text-muted-foreground">Record a voice note or upload audio — AI extracts trips.</span>
          </div>
        )}

        {!chatOpen && voiceTranscript && (
          <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
            <button
              type="button"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setShowTranscript((v) => !v)}
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${showTranscript ? "" : "-rotate-90"}`} />
              Voice transcript
            </button>
            {showTranscript && (
              <p className="mt-1.5 whitespace-pre-wrap text-foreground/80">{voiceTranscript}</p>
            )}
          </div>
        )}


        {!chatOpen && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                <Paperclip className="h-3 w-3" />
                <span className="max-w-[160px] truncate">{a.name}</span>
                <span className="text-muted-foreground">({Math.round(a.size / 1024)} KB)</span>
                <button
                  type="button"
                  className="ml-0.5 rounded-full hover:bg-background"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove ${a.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {chatOpen ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="max-h-60 overflow-auto space-y-2">
              {chat.map((m, i) => (
                <div key={i} className={`text-xs rounded-md px-2 py-1.5 whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground ml-auto max-w-[85%] w-fit"
                    : "bg-background border max-w-[85%] w-fit"
                }`}>
                  {m.text}
                </div>
              ))}
              {aiMut.isPending && (
                <div className="text-xs text-muted-foreground italic">
                  {attachments.length > 0 ? "Analyzing attachment(s)…" : "AI is thinking…"}
                </div>
              )}
            </div>
            {pendingQuestion && !aiMut.isPending && (
              <div className="flex gap-2">
                <Input
                  autoFocus value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type your answer…"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendReply(); } }}
                />
                <Button type="button" size="sm" onClick={sendReply} disabled={!reply.trim()}>
                  Send
                </Button>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={cancelChat}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setIsDragging(false);
              if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
            }}
            className={isDragging ? "rounded-md ring-2 ring-primary" : ""}
          >
            <Textarea
              rows={10} value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files || []);
                if (files.length) { e.preventDefault(); void addFiles(files); }
              }}
              placeholder={"Paste text, drop an image/PDF, or paste a link.\nExcel/CSV rows also work — headers optional.\n\nColumn order (if no header row):\nPickup Date  Pickup Time  Pickup Address  Delivery Address  Customer Name  Contact Number  Transport Type  Quantity"}
              className="font-mono text-xs"
            />
          </div>
        )}

        {!chatOpen && (
          <p className="text-xs text-muted-foreground">
            {aiEnabled
              ? "Paste text, a link, or attach an image/PDF (WhatsApp screenshot, booking confirmation, itinerary). Excel/CSV files are parsed locally with no AI cost."
              : "You can paste rows straight from the template (headers optional). Blank line or a new date starts a new trip. Incomplete trips can be finished in Manual."}
          </p>
        )}


      </div>
      {aiLowConfidence && withErrors.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <div className="font-medium">⚠ The AI had trouble reading parts of this request.</div>
          <div className="mt-0.5">Please review and complete the fields below before creating trips.</div>
        </div>
      )}
      {autoFixBusy && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <Wand2 className="h-3.5 w-3.5 animate-pulse text-primary" />
          Address auto-fix: matching pickup/drop-off with Google…
        </div>
      )}
      {withErrors.length > 0 && (
        <div className="space-y-2 max-h-[380px] overflow-auto rounded-md border p-2">
          {withErrors.map((t, i) => {
            const patch = (u: Partial<ParsedTrip>) =>
              setEdited((prev) => prev.map((r, j) => (j === i ? { ...r, ...u } : r)));
            const bad = t.errors.length > 0;
            return (
              <div key={i} className={`rounded p-2 text-xs space-y-2 ${bad ? "bg-destructive/5 border border-destructive/30" : "bg-muted/40"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                    Trip {i + 1}
                    {bad && <span className="ml-2 text-destructive normal-case tracking-normal">Missing: {t.errors.map((e) => e.replace("Missing ", "")).join(", ")}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {t.errors.length > 0 && (
                      <Button type="button" size="sm" variant="ghost" className="h-7"
                        onClick={() => onComplete(t)} title="Open in Manual form for full editing">
                        <PencilLine className="h-3 w-3 mr-1" /> Manual
                      </Button>
                    )}
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => setEdited((prev) => prev.filter((_, j) => j !== i))}
                      title="Remove this trip">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">Date</span>
                    <Input type="date" value={t.date} className="h-7 text-xs"
                      onChange={(e) => patch({ date: e.target.value })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">Time</span>
                    <Input type="time" value={t.time} className="h-7 text-xs"
                      onChange={(e) => patch({ time: e.target.value })} />
                  </label>
                  <div className="space-y-1 col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">Pickup</span>
                      {t.autoFixed?.from_location && (
                        <button type="button"
                          className="inline-flex items-center gap-1 text-[10px] text-emerald-700 hover:underline"
                          onClick={() => {
                            const original = t.autoFixed!.from_location!;
                            const nextAf = { ...(t.autoFixed ?? {}) };
                            delete nextAf.from_location;
                            patch({
                              from_location: original,
                              from_place_id: null, from_lat: null, from_lng: null,
                              autoFixed: (nextAf.from_location || nextAf.to_location) ? nextAf : undefined,
                            });
                          }}
                          title={`Undo — restore "${t.autoFixed.from_location}"`}
                        >
                          <Undo2 className="h-3 w-3" /> Auto-fixed · undo
                        </button>
                      )}
                    </div>
                    <AddressAutocomplete
                      value={t.from_location}
                      placeId={t.from_place_id ?? null}
                      onChange={(v) => patch({
                        from_location: v.address,
                        from_place_id: v.place_id, from_lat: v.lat, from_lng: v.lng,
                      })}
                      placeholder="Pickup address"
                      inputClassName="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">Delivery</span>
                      {t.autoFixed?.to_location && (
                        <button type="button"
                          className="inline-flex items-center gap-1 text-[10px] text-emerald-700 hover:underline"
                          onClick={() => {
                            const original = t.autoFixed!.to_location!;
                            const nextAf = { ...(t.autoFixed ?? {}) };
                            delete nextAf.to_location;
                            patch({
                              to_location: original,
                              to_place_id: null, to_lat: null, to_lng: null,
                              autoFixed: (nextAf.from_location || nextAf.to_location) ? nextAf : undefined,
                            });
                          }}
                          title={`Undo — restore "${t.autoFixed.to_location}"`}
                        >
                          <Undo2 className="h-3 w-3" /> Auto-fixed · undo
                        </button>
                      )}
                    </div>
                    <AddressAutocomplete
                      value={t.to_location}
                      placeId={t.to_place_id ?? null}
                      onChange={(v) => patch({
                        to_location: v.address,
                        to_place_id: v.place_id, to_lat: v.lat, to_lng: v.lng,
                      })}
                      placeholder="Delivery address"
                      inputClassName="h-8 text-xs"
                    />
                  </div>
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">Company</span>
                    <Input value={t.clientcompanyname} className="h-7 text-xs"
                      placeholder="Client / company"
                      onChange={(e) => patch({ clientcompanyname: e.target.value })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">Contact phone</span>
                    <Input value={t.contact_phone} className="h-7 text-xs"
                      placeholder="+…"
                      onChange={(e) => patch({ contact_phone: e.target.value })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">Flight (from)</span>
                    <Input value={t.from_flight} className="h-7 text-xs"
                      placeholder="e.g. KM101"
                      onChange={(e) => patch({ from_flight: e.target.value })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">Flight (to)</span>
                    <Input value={t.to_flight} className="h-7 text-xs"
                      placeholder="e.g. KM102"
                      onChange={(e) => patch({ to_flight: e.target.value })} />
                  </label>
                  <label className="space-y-1 col-span-2">
                    <span className="text-[10px] text-muted-foreground">Passengers (one per line)</span>
                    <Textarea rows={2} value={t.pax.join("\n")} className="text-xs font-mono"
                      placeholder="One name per line"
                      onChange={(e) => patch({ pax: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <LabelPicker value={labelIds} onChange={setLabelIds} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={mut.isPending || valid.length === 0} onClick={() => mut.mutate()}>
          {mut.isPending ? "Creating…" : `Create ${valid.length} trip${valid.length === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ToggleRow({
  label, hint, checked, onChange,
}: {
  label: string; hint: string;
  checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function PaxEditor({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listJobPax);
  const addFn = useServerFn(addJobPax);
  const removeFn = useServerFn(removeJobPax);
  const setPhoneFn = useServerFn(setJobContactPhoneIfEmpty);
  const [name, setName] = useState("");

  const { data } = useQuery({
    queryKey: ["job-pax", jobId],
    queryFn: () => listFn({ data: { job_id: jobId } }) as Promise<Array<{ id: string; name: string }>>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["job-pax", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };

  const addMut = useMutation({
    mutationFn: async (raw: string) => {
      const { cleanName, phone } = extractPhoneFromName(raw);
      const hasName = isMeaningfulName(cleanName);
      if (hasName) {
        await addFn({ data: { job_id: jobId, name: cleanName } });
      }
      if (phone) {
        try {
          const r: any = await setPhoneFn({ data: { job_id: jobId, phone } });
          if (r?.set) toast.success(hasName ? `Moved ${phone} to phone number` : `Saved phone number ${phone}`);
        } catch { /* ignore */ }
      } else if (!hasName) {
        toast.error("Enter a passenger name or a phone number");
        throw new Error("empty");
      }
    },
    onSuccess: () => { setName(""); invalidate(); },
    onError: (e: Error) => { if (e.message !== "empty") toast.error(e.message); },
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { pax_id: id } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const submitAdd = () => {
    const n = name.trim();
    if (!n) return;
    addMut.mutate(n);
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Passengers ({data?.length ?? 0})</Label>
      {(data ?? []).length > 0 ? (
        <ul className="space-y-1">
          {(data ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-sm">
              <span className="truncate">{p.name}</span>
              <Button
                type="button" size="icon" variant="ghost" className="h-7 w-7"
                disabled={removeMut.isPending}
                onClick={() => removeMut.mutate(p.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No passengers yet.</p>
      )}
      <div className="flex gap-2">
        <Input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Add passenger name"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitAdd(); } }}
        />
        <Button type="button" onClick={submitAdd} disabled={addMut.isPending || !name.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}


