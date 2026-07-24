import { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Plane as PlaneIcon, Ship as ShipIcon, Building2, MapPin, ChevronLeft, ChevronRight } from "lucide-react";

type EndpointKind = "airport" | "seaport" | "hotel" | "custom";

function inferEndpointKind(loc: string, flightOrShip: string): EndpointKind {
  const l = (loc ?? "").toLowerCase();
  const f = (flightOrShip ?? "").trim();
  if (f) {
    if (/^[a-z]{2}\s?-?\d{1,4}$/i.test(f)) return "airport";
    if (/\b(ship|vessel|berth|port|cruise|freeport|marina)\b/i.test(l)) return "seaport";
    return "airport";
  }
  if (/\bairport\b|\bairfield\b|\bmla\b/i.test(l)) return "airport";
  if (/\b(seaport|berth|terminal|marina|freeport|cruise|vessel|ship)\b/i.test(l)) return "seaport";
  if (/\b(hotel|inn|resort|hilton|marriott|radisson|hyatt|sheraton|westin|holiday inn|palace|suites|apartments|apart[- ]?hotel)\b/i.test(l)) return "hotel";
  return "custom";
}

function placeholderForKind(kind: EndpointKind, hasCode: string): string {
  if (kind === "airport") return hasCode ? "Airport (auto)" : "Airport / terminal";
  if (kind === "seaport") return "Port, berth, terminal…";
  if (kind === "hotel") return "Hotel or venue name";
  return "Address or place";
}

function EndpointKindChips({ value, onChange }: { value: EndpointKind; onChange: (k: EndpointKind) => void }) {
  const opts: { k: EndpointKind; label: string; Icon: typeof PlaneIcon }[] = [
    { k: "airport", label: "Airport", Icon: PlaneIcon },
    { k: "seaport", label: "Seaport", Icon: ShipIcon },
    { k: "hotel",   label: "Hotel",   Icon: Building2 },
    { k: "custom",  label: "Other",   Icon: MapPin },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {opts.map(({ k, label, Icon }) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] ${value === k ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground"}`}
        >
          <Icon className="h-3 w-3" /> {label}
        </button>
      ))}
    </div>
  );
}
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createJob, updateJob, createJobsBulk, listJobPax, addJobPax, removeJobPax, updateJobPax, getPaxPersonalToken, updateMyOperationsPhone, previewTripStatus, refreshJobLiveStatus } from "@/lib/coordinator.functions";
import { listStopsForJob, addStopToJob, removeStopFromJob } from "@/lib/groups.functions";
import { markJobReviewed, listOtgReassignTargets } from "@/lib/driver-otg.functions";
import { TrafficBadge } from "@/components/coordinator/TrafficBadge";
import { Plane, Ship, RefreshCw } from "lucide-react";
import { parseTrips, extractPhoneFromName, isMeaningfulName, type ParsedTrip } from "@/lib/parse-trips";
import { downloadExcelTemplate, downloadGoogleSheetsTemplate, looksLikeSheetPaste, parseSheetPaste, fileToSheetTsv } from "@/lib/sheet-template";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileDown, Paperclip } from "lucide-react";
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
import { Users, PencilLine, Plus, Trash2, ChevronDown, Undo2, Wand2 } from "lucide-react";
import { useFeature } from "@/hooks/use-features";
import { AddressAutocomplete } from "@/components/address/AddressAutocomplete";
import { resolveAddresses, estimateRouteEta } from "@/lib/places.functions";
import { useAddressSettings, toBias } from "@/hooks/use-address-settings";
import { formatEta } from "@/lib/trip-display";
import { Clock, AlertTriangle } from "lucide-react";
import { previewAssignmentConflicts, suggestAlternativeDrivers, type ConflictPair } from "@/lib/scheduling.functions";
import { ConflictTimelineDialog } from "@/components/coordinator/ConflictTimelineDialog";
import { useMyCompany } from "@/hooks/use-coordinator";

type Driver = { id: string; name: string; vehicle: string | null };

type Job = {
  id: string;
  from_location: string; to_location: string;
  date: string; time: string;
  flightorship: string | null;
  from_flight: string | null;
  to_flight: string | null;
  tracking_kind?: string | null;
  flight_status_confidence?: string | null;
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
  needs_review?: boolean | null;
  created_by_driver?: boolean | null;
};

type Prefill = Partial<{
  from_location: string; to_location: string;
  date: string; time: string;
  from_flight: string; to_flight: string;
  clientcompanyname: string;
  pax: string[];
}>;

type PassengerDraft = {
  key: string;
  name: string;
  phone: string;
  note: string;
};

function passengerDraft(key: string, name = ""): PassengerDraft {
  return { key, name, phone: "", note: "" };
}

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
  // Bulk paste remains a core feature. It parses pasted rows and spreadsheet
  // files locally without relying on an external language model.
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
  const [fromKind, setFromKind] = useState<EndpointKind>(() =>
    inferEndpointKind(job?.from_location ?? prefill?.from_location ?? "", job?.from_flight ?? prefill?.from_flight ?? ""),
  );
  const [toKind, setToKind] = useState<EndpointKind>(() =>
    inferEndpointKind(job?.to_location ?? prefill?.to_location ?? "", job?.to_flight ?? prefill?.to_flight ?? ""),
  );
  const trackingKind: "flight" | "vessel" =
    (fromKind === "seaport" && toKind !== "airport") || (toKind === "seaport" && fromKind !== "airport")
      ? "vessel"
      : "flight";
  const [date, setDate] = useState(job?.date ?? prefill?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(job?.time?.slice(0, 5) ?? prefill?.time ?? "09:00");
  const [client, setClient] = useState(job?.clientcompanyname ?? prefill?.clientcompanyname ?? "");
  const [operationsPhone, setOperationsPhone] = useState("");
  const [operationsPhoneDirty, setOperationsPhoneDirty] = useState(false);
  const [driverId, setDriverId] = useState<string>(job?.driver_id ?? "__none__");
  const isMobile = useIsMobile();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [track, setTrack] = useState(job?.tracking_enabled ?? false);
  const [passengers, setPassengers] = useState<PassengerDraft[]>(() =>
    prefill?.pax?.length
      ? prefill.pax.map((name, index) => passengerDraft(`prefill-${index}`, name))
      : [passengerDraft("passenger-0")],
  );
  const nextPassengerKey = useRef(prefill?.pax?.length ?? 1);
  const [showPassengerPaste, setShowPassengerPaste] = useState(false);
  const [passengerPasteText, setPassengerPasteText] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>(job?.labels?.map((l) => l.id) ?? []);
  const [flightHint, setFlightHint] = useState<{ side: "from" | "to"; msg: string } | null>(null);

  const duplicatePassengerNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const passenger of passengers) {
      const key = passenger.name.trim().toLocaleLowerCase();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [passengers]);

  function patchPassenger(key: string, patch: Partial<Omit<PassengerDraft, "key">>) {
    setPassengers((current) =>
      current.map((passenger) => passenger.key === key ? { ...passenger, ...patch } : passenger),
    );
  }

  function addPassenger(name = "") {
    const key = `passenger-${nextPassengerKey.current++}`;
    setPassengers((current) => [...current, passengerDraft(key, name)]);
  }

  function removePassenger(key: string) {
    setPassengers((current) => current.filter((passenger) => passenger.key !== key));
  }

  function addPastedPassengers() {
    const names = passengerPasteText.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
    if (names.length === 0) return;
    setPassengers((current) => {
      const additions = names.map((name) => passengerDraft(`passenger-${nextPassengerKey.current++}`, name));
      const onlyBlankRow = current.length === 1
        && !current[0].name.trim()
        && !current[0].phone.trim()
        && !current[0].note.trim();
      return onlyBlankRow ? additions : [...current, ...additions];
    });
    setPassengerPasteText("");
    setShowPassengerPaste(false);
  }

  // OTG-only: coordinator can reassign the trip to another connected
  // coordinator company while it is still `created_by_driver && needs_review`.
  const isOtgEditable = !!(job?.created_by_driver && job?.needs_review);
  const [coordCompanyId, setCoordCompanyId] = useState<string>("");
  const otgTargetsFn = useServerFn(listOtgReassignTargets);
  const { data: otgTargets } = useQuery({
    enabled: isOtgEditable && !!job?.id,
    queryKey: ["otg-reassign", job?.id],
    queryFn: () => otgTargetsFn({ data: { job_id: job!.id } }),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (otgTargets?.current_company_id && !coordCompanyId) {
      setCoordCompanyId(otgTargets.current_company_id);
    }
  }, [otgTargets, coordCompanyId]);


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
  const { data: myCompany } = useMyCompany();
  const saveOperationsPhoneFn = useServerFn(updateMyOperationsPhone);
  const createFn = useServerFn(createJob);
  const updateFn = useServerFn(updateJob);
  const previewFn = useServerFn(previewTripStatus);
  const refreshFn = useServerFn(refreshJobLiveStatus);
  const reviewFn = useServerFn(markJobReviewed);
  useEffect(() => {
    if (!myCompany || operationsPhoneDirty) return;
    setOperationsPhone(myCompany.operations_phone ?? "");
  }, [myCompany, operationsPhoneDirty]);

  const reviewMut = useMutation({
    mutationFn: () => reviewFn({ data: { job_id: job!.id } }),
    onSuccess: () => {
      toast.success("Marked reviewed");
      qc.invalidateQueries({ queryKey: ["coord-jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not mark reviewed"),
  });

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
        tracking_kind: trackingKind,
      } });
    },
    onSuccess: () => {
      if (job?.id) qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const preview = previewMut.data;

  // Schedule-conflict gate: DriverAssignmentConflictHint reports severity;
  // when it's "conflict" the coordinator must tick "Assign anyway" before
  // submit is allowed. Prevents accidental double-booking of a driver.
  const [conflictSeverity, setConflictSeverity] = useState<"free" | "tight" | "conflict" | null>(null);
  const [assignAnyway, setAssignAnyway] = useState(false);
  useEffect(() => { setAssignAnyway(false); }, [driverId, date, time, from, to]);
  const hardBlocked = conflictSeverity === "conflict" && !assignAnyway;

  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [createdDate, setCreatedDate] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const effFrom = from || (fromFlight ? "Airport" : "");
      const effTo = to || (toFlight ? "Airport" : "");
      const incompletePassengerIndex = passengers.findIndex((passenger) =>
        !passenger.name.trim() && (!!passenger.phone.trim() || !!passenger.note.trim()),
      );
      if (incompletePassengerIndex >= 0) {
        throw new Error(`Passenger ${incompletePassengerIndex + 1} needs a name.`);
      }
      const passengerPayload = passengers
        .filter((passenger) => passenger.name.trim())
        .map((passenger) => ({
          name: passenger.name.trim(),
          phone: passenger.phone.trim() || null,
          note: passenger.note.trim() || null,
        }));

      const cleanOperationsPhone = operationsPhone.trim();
      const savedOperationsPhone = myCompany?.operations_phone?.trim() ?? "";
      if (operationsPhoneDirty && cleanOperationsPhone !== savedOperationsPhone) {
        const saved = await saveOperationsPhoneFn({ data: { phone: cleanOperationsPhone || null } });
        qc.setQueryData(["my-company"], (current: any) =>
          current ? { ...current, operations_phone: saved.operations_phone } : current,
        );
        setOperationsPhoneDirty(false);
      }

      const payload = {
        from_location: effFrom, to_location: effTo, date, time,
        flightorship: fromFlight || toFlight || "",
        from_flight: fromFlight, to_flight: toFlight,
        tracking_kind: trackingKind,
        clientcompanyname: client,
        // This legacy field is the customer/booking phone. The visible 24/7
        // number is company-level, so preserve an existing value on edit and
        // never write the operations number into it.
        contact_phone: job?.contact_phone ?? "",
        driver_id: driverId === "__none__" ? null : driverId,
        qr_strict_mode: false, tracking_enabled: track,
        label_ids: labelIds,
        pickup_place_id: fromPlaceId,
        dropoff_place_id: toPlaceId,
        pickup_display_name: fromDisplayName,
        dropoff_display_name: toDisplayName,
      };
      if (job) {
        const editPayload: any = { id: job.id, ...payload };
        if (isOtgEditable && coordCompanyId && coordCompanyId !== otgTargets?.current_company_id) {
          editPayload.company_id = coordCompanyId;
        }
        await updateFn({ data: editPayload });
        return { date, jobId: job.id, isNew: false };
      }
      const row: any = await createFn({ data: { ...payload, passengers: passengerPayload } });
      return { date, jobId: row?.id as string | undefined, isNew: true };
    },
    onSuccess: (res) => {
      toast.success(job ? "Trip updated" : "Trip created");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["driver-manifest"] });
      if (res.isNew && res.jobId) {
        // Keep the dialog open for a quick passenger review and optional
        // intermediate stops. onSaved() closes it from Done / Skip.
        setCreatedJobId(res.jobId);
        setCreatedDate(res.date);
        return;
      }
      onSaved(res.date);
    },
    onError: (e: Error) => toast.error(e.message),
  });


  // Live from→to ETA badge. Debounced auto-fetch so we only ping Google once
  // the user has stopped typing. Charged as "route_eta" — if the company has
  // it disabled or out of points, we silently show nothing.
  const etaFn = useServerFn(estimateRouteEta);
  const [etaLoading, setEtaLoading] = useState(false);
  const [etaResult, setEtaResult] = useState<{
    duration_sec: number; distance_m: number; duration_text: string; distance_text: string;
  } | { error: string } | null>(() => {
    if (job?.route_duration_sec) {
      return {
        duration_sec: job.route_duration_sec,
        distance_m: job.route_distance_m ?? 0,
        duration_text: formatEta(job.route_duration_sec) ?? "",
        distance_text: job.route_distance_m ? `${(job.route_distance_m / 1000).toFixed(1)} km` : "",
      };
    }
    return null;
  });
  // Seed the key with the persisted from/to when the job already has a cached
  // ETA, so simply opening an existing trip doesn't re-charge a "route_eta"
  // credit. A fetch only fires once the coordinator actually edits an address.
  const etaKeyRef = useRef<string>(
    job?.route_duration_sec ? `${job?.from_location ?? ""}||${job?.to_location ?? ""}` : "",
  );
  useEffect(() => {
    const key = `${from}||${to}`;
    if (!from.trim() || !to.trim() || from.trim().length < 3 || to.trim().length < 3) {
      etaKeyRef.current = key;
      return;
    }
    if (etaKeyRef.current === key) return;
    const timer = setTimeout(async () => {
      etaKeyRef.current = key;
      setEtaLoading(true);
      try {
        const r = await etaFn({ data: {
          from, to,
          job_id: job?.id,
          cache_on_job: !!job?.id,
        } });
        if ((r as any).ok) {
          setEtaResult({
            duration_sec: (r as any).duration_sec,
            distance_m: (r as any).distance_m,
            duration_text: (r as any).duration_text,
            distance_text: (r as any).distance_text,
          });
        } else {
          setEtaResult({ error: (r as any).reason ?? "unavailable" });
        }
      } catch {
        setEtaResult({ error: "network" });
      } finally {
        setEtaLoading(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [from, to, etaFn, job?.id]);

  if (createdJobId) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          Trip created. Review the passenger details and add any intermediate stops, or finish now.
        </div>
        <PaxEditor jobId={createdJobId} initiallyExpanded />
        <StopsEditor jobId={createdJobId} />
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onSaved(createdDate ?? undefined)}>Skip</Button>
          <Button type="button" onClick={() => onSaved(createdDate ?? undefined)}>Done</Button>
        </DialogFooter>
      </div>
    );
  }


  return (
    <form className="flex flex-col min-h-0 gap-3" onSubmit={(e) => { e.preventDefault(); if (hardBlocked) { toast.error("Driver has a schedule conflict — tick 'Assign anyway' to override, or pick another driver."); return; } mut.mutate(); }}>

      {prefill && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          Prefilled from paste — fill in any missing fields highlighted below.
        </div>
      )}
      {job?.needs_review && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex items-center gap-2">
          <span className="flex-1">
            {job.created_by_driver
              ? "This trip was created by the driver on the go. Fill in the client name / fare, then mark it reviewed."
              : "This trip is pending your review."}
          </span>
          <Button
            type="button" size="sm" variant="outline"
            onClick={() => reviewMut.mutate()}
            disabled={reviewMut.isPending}
          >
            {reviewMut.isPending ? "Marking…" : "Mark reviewed"}
          </Button>
        </div>
      )}
      {isMobile && (
        <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
          {[
            { n: 1, label: "Who" },
            { n: 2, label: "Where" },
            { n: 3, label: "When" },
          ].map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => setStep(s.n as 1 | 2 | 3)}
              className={`flex-1 rounded-md border px-2 py-1.5 ${step === s.n ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground"}`}
            >
              {s.n}. {s.label}
            </button>
          ))}
        </div>
      )}
      <div className={isMobile ? "wizard-mobile space-y-3" : "space-y-3"} data-active-step={step}>
        {/* STEP 1 — WHO */}
        <section data-step="1" className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Client / company</Label><Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Hilton Malta" /></div>
            <div className="space-y-1.5">
              <Label>24/7 trip support number</Label>
              <Input
                type="tel"
                value={operationsPhone}
                maxLength={40}
                onChange={(e) => {
                  setOperationsPhone(e.target.value);
                  setOperationsPhoneDirty(true);
                }}
                placeholder="+356 …"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                Shown on every client link. Changing it updates the current on-duty number for all active trips.
              </p>
            </div>
          </div>
          {!job && (
            <div className="space-y-2 rounded-lg border bg-muted/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Passengers (optional)</Label>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Add contact details once, before creating the trip.</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => addPassenger()}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add passenger
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowPassengerPaste((value) => !value)}>
                    Paste many names
                  </Button>
                </div>
              </div>

              {showPassengerPaste && (
                <div className="space-y-2 rounded-md border bg-background p-2">
                  <Textarea
                    rows={4}
                    value={passengerPasteText}
                    onChange={(e) => setPassengerPasteText(e.target.value)}
                    placeholder={"ELMER CLEMENTE AGUINALDO\nNIXON KALATHILAPARAMBIL VINCENT"}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowPassengerPaste(false)}>Cancel</Button>
                    <Button type="button" size="sm" onClick={addPastedPassengers} disabled={!passengerPasteText.trim()}>Add names</Button>
                  </div>
                </div>
              )}

              {passengers.length === 0 && (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  No passengers added yet.
                </p>
              )}

              <div className="space-y-2">
                {passengers.map((passenger, index) => {
                  const duplicate = duplicatePassengerNames.has(passenger.name.trim().toLocaleLowerCase());
                  return (
                    <div key={passenger.key} className="rounded-md border bg-background p-2.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">Passenger {index + 1}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={`Remove passenger ${index + 1}`}
                          onClick={() => removePassenger(passenger.key)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <Input
                            value={passenger.name}
                            maxLength={200}
                            onChange={(e) => patchPassenger(passenger.key, { name: e.target.value })}
                            placeholder="Full name"
                            aria-label={`Passenger ${index + 1} full name`}
                          />
                          {duplicate && <p className="mt-1 text-[10px] text-amber-700">Duplicate name — both passengers will be kept.</p>}
                        </div>
                        <Input
                          type="tel"
                          value={passenger.phone}
                          maxLength={40}
                          onChange={(e) => patchPassenger(passenger.key, { phone: e.target.value })}
                          placeholder="Phone (optional)"
                          aria-label={`Passenger ${index + 1} phone`}
                        />
                        <Input
                          value={passenger.note}
                          maxLength={500}
                          onChange={(e) => patchPassenger(passenger.key, { note: e.target.value })}
                          placeholder="Internal note — e.g. wheelchair, room, luggage"
                          aria-label={`Passenger ${index + 1} internal note`}
                          className="sm:col-span-2"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Passenger notes are private: only the coordinator and assigned driver can see them.
              </p>
            </div>
          )}
          {job && <PaxEditor jobId={job.id} />}
        </section>

        {/* STEP 2 — WHERE */}
        <section data-step="2" className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 min-w-0">
              <Label>From {!from && !fromFlight && <span className="text-destructive">*</span>}</Label>
              <EndpointKindChips value={fromKind} onChange={setFromKind} />
              <AddressAutocomplete
                value={from}
                placeId={fromPlaceId}
                onChange={(v) => {
                  setFrom(v.address);
                  setFromPlaceId(v.place_id);
                  setFromDisplayName(v.display_name ?? null);
                }}
                onBlur={() => handleLocationBlur("from")}
                placeholder={placeholderForKind(fromKind, fromFlight)}
              />
              {(fromKind === "airport" || fromKind === "seaport") && (
                <Input
                  value={fromFlight}
                  onChange={(e) => setFromFlight(e.target.value.toUpperCase())}
                  onBlur={() => handleFlightBlur("from")}
                  placeholder={fromKind === "seaport" ? "Vessel name (e.g. Asso Venticinque)" : "Flight code (e.g. EK109)"}
                  className="text-xs"
                />
              )}
              {flightHint?.side === "from" && (
                <div className="text-[10px] text-emerald-600">{flightHint.msg}</div>
              )}
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label>To {!to && !toFlight && <span className="text-destructive">*</span>}</Label>
              <EndpointKindChips value={toKind} onChange={setToKind} />
              <AddressAutocomplete
                value={to}
                placeId={toPlaceId}
                onChange={(v) => {
                  setTo(v.address);
                  setToPlaceId(v.place_id);
                  setToDisplayName(v.display_name ?? null);
                }}
                onBlur={() => handleLocationBlur("to")}
                placeholder={placeholderForKind(toKind, toFlight)}
              />
              {(toKind === "airport" || toKind === "seaport") && (
                <Input
                  value={toFlight}
                  onChange={(e) => setToFlight(e.target.value.toUpperCase())}
                  onBlur={() => handleFlightBlur("to")}
                  placeholder={toKind === "seaport" ? "Vessel name (e.g. Asso Venticinque)" : "Flight code (e.g. EK109)"}
                  className="text-xs"
                />
              )}
              {flightHint?.side === "to" && (
                <div className="text-[10px] text-emerald-600">{flightHint.msg}</div>
              )}
            </div>
          </div>
          {(from.trim().length >= 3 && to.trim().length >= 3) && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center gap-2 text-xs">
              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {etaLoading ? (
                <span className="text-muted-foreground">Estimating drive time…</span>
              ) : etaResult && "duration_sec" in etaResult ? (
                <>
                  <span className="font-semibold text-foreground">
                    {formatEta(etaResult.duration_sec) ?? etaResult.duration_text}
                  </span>
                  {etaResult.distance_text && (
                    <span className="text-muted-foreground">· {etaResult.distance_text}</span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">estimated drive time</span>
                </>
              ) : etaResult && "error" in etaResult ? (
                <span className="text-muted-foreground">ETA unavailable</span>
              ) : (
                <span className="text-muted-foreground">Estimated drive time will show here</span>
              )}
            </div>
          )}
          {job && <StopsEditor jobId={job.id} />}
        </section>


        {/* STEP 3 — WHEN */}
        <section data-step="3" className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <div className="flex items-center gap-1.5">
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required className="flex-1" />
                <div className="flex items-center gap-0.5">
                  {[-15, -5, 5, 15].map((delta) => (
                    <Button
                      key={delta}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-1.5 text-[10px] font-mono tabular-nums"
                      onClick={() => setTime(shiftTime(time, delta))}
                      disabled={!time}
                      title={`Shift ${delta > 0 ? "+" : ""}${delta} min`}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground">Nudge the pickup time to re-check driver availability.</div>
            </div>
          </div>
          {isOtgEditable && (otgTargets?.coordinators?.length ?? 0) > 1 && (
            <div className="space-y-1.5">
              <Label>Coordinator company</Label>
              <Select value={coordCompanyId} onValueChange={setCoordCompanyId}>
                <SelectTrigger><SelectValue placeholder="Select coordinator" /></SelectTrigger>
                <SelectContent>
                  {(otgTargets?.coordinators ?? []).map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-[10px] text-muted-foreground">
                On-the-go trip — reassign to another connected coordinator before you mark it reviewed.
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Driver</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <DriverAssignmentConflictHint
              driverId={driverId === "__none__" ? null : driverId}
              jobId={job?.id ?? null}
              drivers={drivers}
              onPickDriver={(id) => setDriverId(id)}
              onSeverityChange={setConflictSeverity}
              candidate={
                job
                  ? null
                  : {
                      pickup_at: makeIsoOrNull(date, time),
                      from_location: from || (fromFlight ? "Airport" : ""),
                      to_location: to || (toFlight ? "Airport" : ""),
                      pickup_display_name: fromDisplayName ?? null,
                      dropoff_display_name: toDisplayName ?? null,
                      route_duration_sec: etaResult && "duration_sec" in etaResult ? etaResult.duration_sec : null,
                    }
              }
            />
            {conflictSeverity === "conflict" && driverId !== "__none__" && (
              <label className="mt-1 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-red-900 dark:text-red-200 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={assignAnyway}
                  onChange={(e) => setAssignAnyway(e.target.checked)}
                />
                <span>
                  <span className="font-semibold">Assign anyway</span> — I understand this driver's
                  schedule collides with another trip and I take responsibility for the double-booking.
                </span>
              </label>
            )}

          </div>
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
                      {trackingKind === "vessel"
                        ? <Ship className="h-3.5 w-3.5 mt-0.5 text-primary" />
                        : <Plane className="h-3.5 w-3.5 mt-0.5 text-primary" />}
                      <div>
                        <div className="font-medium">
                          {preview.flight.code} · {preview.flight.status}
                          {preview.flight.confidence === "low" && (
                            <span className="ml-1 text-[10px] text-amber-600">(unconfirmed)</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{preview.flight.note}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {trackingKind === "vessel"
                        ? <Ship className="h-3.5 w-3.5" />
                        : <Plane className="h-3.5 w-3.5" />}
                      {trackingKind === "vessel" ? "Vessel" : "Flight"} {preview.flight.code}: {preview.flight.reason === "not_configured" ? "live lookup not configured" : preview.flight.reason === "no_result" ? "no confident match found" : "check failed"}
                    </div>
                  )
                ) : (
                  (fromFlight || toFlight) ? null : (
                    <div className="text-[11px] text-muted-foreground">Add a {trackingKind === "vessel" ? "vessel name" : "flight code"} to see live status.</div>
                  )
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      {isMobile ? (
        <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t bg-background/95 px-1 pb-1 pt-2 backdrop-blur">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            type="button" variant="ghost" size="sm"
            disabled={step === 1}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {step < 3 ? (
              <Button
                type="button" size="sm"
                onClick={() => setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s))}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={mut.isPending}>
                {mut.isPending ? "Saving…" : job ? "Save" : "Create"}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Saving…" : job ? "Save" : "Create"}</Button>
        </DialogFooter>
      )}
    </form>
  );
}


function recomputeTripErrors(t: ParsedTrip): ParsedTrip {
  const errors: string[] = [];
  if (!t.date?.trim()) errors.push("Missing date");
  if (!t.time?.trim()) errors.push("Missing time");
  if (!t.from_location?.trim()) errors.push("Missing pickup");
  if (!t.to_location?.trim()) errors.push("Missing delivery");
  return { ...t, errors };
}

const SHEET_EXT_RE = /\.(xlsx|xls|csv)$/i;

function BulkForm({ onSaved, onComplete, onCancel }: { onSaved: (createdDate?: string) => void; onComplete: (t: ParsedTrip) => void; onCancel: () => void }) {
  const [raw, setRaw] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const parsed = useMemo(
    () => (looksLikeSheetPaste(raw) ? parseSheetPaste(raw) : parseTrips(raw)),
    [raw],
  );
  // Editable overrides — mirror `parsed` and let coordinators tweak fields in place.
  const [edited, setEdited] = useState<ParsedTrip[]>(parsed);
  useEffect(() => { setEdited(parsed); }, [parsed]);
  const inferredOperationName = useMemo(() => {
    const values = parsed.map((t) => t.operation_name?.trim()).filter((value): value is string => !!value);
    if (values.length === 0) return "";
    const first = values[0];
    return values.every((value) => value === first) ? first : "";
  }, [parsed]);
  const [operationName, setOperationName] = useState("");
  useEffect(() => {
    setOperationName((current) => (current.trim() ? current : inferredOperationName));
  }, [inferredOperationName]);
  const withErrors = useMemo(() => edited.map(recomputeTripErrors), [edited]);
  const valid = withErrors.filter((t) => t.errors.length === 0);
  const incomplete = withErrors.filter((t) => t.errors.length > 0);
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

  const qc = useQueryClient();
  const bulkFn = useServerFn(createJobsBulk);
  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;

    const sheets = arr.filter((f) => SHEET_EXT_RE.test(f.name) || /spreadsheet|excel|csv/i.test(f.type));
    for (const f of sheets) {
      try {
        const tsv = await fileToSheetTsv(f);
        if (tsv) {
          setRaw((prev) => (prev.trim() ? prev + "\n" + tsv : tsv));
          toast.success(`Loaded ${f.name}`);
        } else {
          toast.error(`${f.name}: empty spreadsheet`);
        }
      } catch (e: any) {
        toast.error(`${f.name}: ${e?.message || "could not read"}`);
      }
    }
    const rejected = arr.filter((f) => !sheets.includes(f));
    if (rejected.length) toast.error(`Only Excel and CSV files are supported: ${rejected.map((f) => f.name).join(", ")}`);
  };


  const earliestValidDate = valid
    .map((t) => t.date)
    .filter(Boolean)
    .sort()[0];

  const mut = useMutation({
    mutationFn: () => bulkFn({ data: {
      operation_name: operationName.trim() || undefined,
      trips: valid.map((t) => ({
        from_location: t.from_location, to_location: t.to_location,
        date: t.date, time: t.time,
        flightorship: t.flightorship, clientcompanyname: t.clientcompanyname,
        from_flight: t.from_flight, to_flight: t.to_flight,
        contact_phone: t.contact_phone,
        pax: t.pax,
      })),
      label_ids: labelIds,
    } }),
    onSuccess: (res: { created: string[]; operation_name?: string }) => {
      const operationLabel = res.operation_name ? ` in operation "${res.operation_name}"` : "";
      toast.success(`Created ${res.created.length} trip${res.created.length === 1 ? "" : "s"}${operationLabel}`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
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
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button" size="sm" variant="outline"
              className="h-7"
              onClick={() => fileInputRef.current?.click()}
              title="Import an Excel or CSV file"
            >
              <Paperclip className="h-3 w-3 mr-1" />
              Import file
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Operation name (optional)</Label>
          <Input
            value={operationName}
            onChange={(e) => setOperationName(e.target.value)}
            placeholder="e.g. Everest Crew Change"
            className="h-8 text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Leave this blank if you want the system to derive a name from the first row.
          </p>
        </div>

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
              placeholder={"Paste trip rows here, or import an Excel/CSV file. Headers are optional.\n\nColumn order (if no header row):\nPickup Date  Pickup Time  Pickup Address  Delivery Address  Customer Name  Contact Number  Transport Type  Quantity  Operation Name"}
              className="font-mono text-xs"
            />
        </div>

        <p className="text-xs text-muted-foreground">
          You can paste rows straight from the template (headers optional). Blank line or a new date starts a new trip. Use the operation name to keep rows grouped together. Incomplete trips can be finished in Manual.
        </p>


      </div>
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
                    <span className="text-[10px] text-muted-foreground">Booking contact phone</span>
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

function PaxEditor({ jobId, initiallyExpanded = false }: { jobId: string; initiallyExpanded?: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listJobPax);
  const addFn = useServerFn(addJobPax);
  const removeFn = useServerFn(removeJobPax);
  const updateFn = useServerFn(updateJobPax);
  const tokenFn = useServerFn(getPaxPersonalToken);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data } = useQuery({
    queryKey: ["job-pax", jobId],
    queryFn: () => listFn({ data: { job_id: jobId } }) as Promise<Array<{ id: string; name: string; phone?: string | null; note?: string | null }>>,
  });

  // Auto-expand every existing row when the parent asks for one-by-one entry
  // (post-save step after creating a trip with a bulk name list).
  useEffect(() => {
    if (!initiallyExpanded || !data) return;
    setExpanded((prev) => {
      const next = { ...prev };
      for (const p of data) if (!(p.id in next)) next[p.id] = true;
      return next;
    });
  }, [initiallyExpanded, data]);


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["job-pax", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };

  const addMut = useMutation({
    mutationFn: async () => {
      const raw = name.trim();
      const cleanPhone = phone.trim() || null;
      const cleanNote = note.trim() || null;
      const parsed = extractPhoneFromName(raw);
      const finalName = parsed.cleanName || raw;
      const finalPhone = cleanPhone || parsed.phone || null;
      if (!isMeaningfulName(finalName)) {
        toast.error("Enter a passenger name");
        throw new Error("empty");
      }
      await addFn({ data: { job_id: jobId, name: finalName, phone: finalPhone, note: cleanNote } });
    },
    onSuccess: () => { setName(""); setPhone(""); setNote(""); invalidate(); },
    onError: (e: Error) => { if (e.message !== "empty") toast.error(e.message); },
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { pax_id: id } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: (v: { pax_id: string; name?: string; phone?: string | null; note?: string | null }) =>
      updateFn({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const copyLink = async (paxId: string) => {
    try {
      const r: any = await tokenFn({ data: { pax_id: paxId } });
      const url = `${window.location.origin}/track/${r.token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Personal link copied");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not copy link");
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Passengers ({data?.length ?? 0})</Label>
      {(data ?? []).length > 0 ? (
        <ul className="space-y-1">
          {(data ?? []).map((p) => (
            <li key={p.id} className="rounded bg-muted/40 px-2 py-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="flex-1 text-left truncate hover:underline"
                  onClick={() => setExpanded((s) => ({ ...s, [p.id]: !s[p.id] }))}
                >
                  <span className="font-medium">{p.name}</span>
                  {p.phone && <span className="ml-2 text-xs text-muted-foreground">· {p.phone}</span>}
                  {p.note && <span className="ml-2 text-xs text-muted-foreground italic">· {p.note}</span>}
                </button>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => copyLink(p.id)}>
                  Link
                </Button>
                <Button
                  type="button" size="icon" variant="ghost" className="h-7 w-7"
                  disabled={removeMut.isPending}
                  onClick={() => removeMut.mutate(p.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {expanded[p.id] && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    defaultValue={p.name}
                    maxLength={200}
                    placeholder="Passenger name"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && p.name !== v) updateMut.mutate({ pax_id: p.id, name: v });
                    }}
                  />
                  <Input
                    type="tel"
                    defaultValue={p.phone ?? ""}
                    maxLength={40}
                    placeholder="Phone (optional)"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if ((p.phone ?? "") !== v) updateMut.mutate({ pax_id: p.id, phone: v || null });
                    }}
                  />
                  <Input
                    defaultValue={p.note ?? ""}
                    maxLength={500}
                    placeholder="Internal note (e.g. wheelchair or luggage)"
                    className="sm:col-span-2"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if ((p.note ?? "") !== v) updateMut.mutate({ pax_id: p.id, note: v || null });
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No passengers yet.</p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr,1fr]">
        <Input
          value={name} onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder="Passenger name"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (name.trim()) addMut.mutate(); } }}
        />
        <Input
          type="tel"
          value={phone} onChange={(e) => setPhone(e.target.value)}
          maxLength={40}
          placeholder="Phone (optional)"
        />
      </div>
      <div className="flex gap-2">
        <Input
          value={note} onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Internal note (optional)"
          className="flex-1"
        />
        <Button type="button" onClick={() => addMut.mutate()} disabled={addMut.isPending || !name.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Internal notes are visible only to the coordinator and assigned driver.
      </p>
    </div>
  );
}


function makeIsoOrNull(date: string, time: string): string | null {
  if (!date || !time) return null;
  try {
    return new Date(`${date}T${time}:00`).toISOString();
  } catch {
    return null;
  }
}

/** Add/subtract minutes from an HH:MM string, wrapping across day boundary. */
function shiftTime(hhmm: string, deltaMin: number): string {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  let total = h * 60 + m + deltaMin;
  total = ((total % 1440) + 1440) % 1440;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

/**
 * Shows a preview of schedule conflicts if the currently selected driver is
 * assigned to this trip. Runs `previewAssignmentConflicts` server-side.
 * On conflict, offers a "View timeline" breakdown modal and a "Suggest
 * alternative driver" one-click ranking across the provided drivers list.
 */
function DriverAssignmentConflictHint({
  driverId,
  jobId,
  candidate,
  drivers,
  onPickDriver,
  onSeverityChange,
}: {
  driverId: string | null;
  jobId: string | null;
  candidate:
    | {
        pickup_at: string | null;
        from_location: string;
        to_location: string;
        pickup_display_name: string | null;
        dropoff_display_name: string | null;
        route_duration_sec: number | null;
      }
    | null;
  drivers: Driver[];
  onPickDriver: (id: string) => void;
  onSeverityChange?: (s: "free" | "tight" | "conflict" | null) => void;
}) {
  const fn = useServerFn(previewAssignmentConflicts);
  const suggestFn = useServerFn(suggestAlternativeDrivers);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [suggestPairs, setSuggestPairs] = useState<Array<{ driver_id: string; severity: "free" | "tight" | "conflict"; min_slack_min: number; pairs: ConflictPair[] }> | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const enabled = !!driverId && (!!jobId || (!!candidate && !!candidate.pickup_at));
  const q = useQuery({
    queryKey: [
      "assignment-preview",
      driverId,
      jobId,
      candidate?.pickup_at,
      candidate?.from_location,
      candidate?.to_location,
    ],
    enabled,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: () =>
      fn({
        data: jobId
          ? { driver_id: driverId!, job_id: jobId }
          : {
              driver_id: driverId!,
              candidate: {
                pickup_at: candidate!.pickup_at!,
                from_location: candidate!.from_location,
                to_location: candidate!.to_location,
                pickup_display_name: candidate!.pickup_display_name,
                dropoff_display_name: candidate!.dropoff_display_name,
                route_duration_sec: candidate!.route_duration_sec,
              },
            },
      }),
  });

  // Reset suggestions whenever the inputs change so stale rankings don't linger.
  useEffect(() => {
    setSuggestPairs(null);
  }, [driverId, jobId, candidate?.pickup_at, candidate?.from_location, candidate?.to_location]);

  const runSuggest = async () => {
    if (!drivers.length) return;
    setSuggesting(true);
    try {
      const payload = jobId
        ? { driver_ids: drivers.map((d) => d.id), exclude_driver_id: driverId ?? null, job_id: jobId }
        : {
            driver_ids: drivers.map((d) => d.id),
            exclude_driver_id: driverId ?? null,
            candidate: {
              pickup_at: candidate!.pickup_at!,
              from_location: candidate!.from_location,
              to_location: candidate!.to_location,
              pickup_display_name: candidate!.pickup_display_name,
              dropoff_display_name: candidate!.dropoff_display_name,
              route_duration_sec: candidate!.route_duration_sec,
            },
          };
      const res = await suggestFn({ data: payload });
      setSuggestPairs(res.suggestions);
    } catch (e) {
      toast.error((e as Error).message || "Could not suggest alternatives");
    } finally {
      setSuggesting(false);
    }
  };

  const data = q.data;
  useEffect(() => {
    if (!enabled) onSeverityChange?.(null);
    else if (data) onSeverityChange?.(data.severity);
  }, [enabled, data, onSeverityChange]);

  if (!enabled) return null;
  if (q.isLoading) {
    return (
      <div className="text-[11px] text-muted-foreground">Checking driver's schedule…</div>
    );
  }

  if (!data || data.severity === "free") {
    if (data?.severity === "free") {
      return (
        <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
          ✓ Driver has no schedule conflicts around this time.
        </div>
      );
    }
    return null;
  }

  const isHard = data.severity === "conflict";
  const cls = isHard
    ? "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200"
    : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200";
  const currentDriverName = drivers.find((d) => d.id === driverId)?.name ?? null;
  const topFree = (suggestPairs ?? []).filter((s) => s.severity === "free").slice(0, 3);
  const topAny = (suggestPairs ?? []).slice(0, 3);
  const bestList = topFree.length ? topFree : topAny;

  return (
    <div className={`rounded-md border px-2.5 py-1.5 text-[11px] leading-snug ${cls}`}>
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-semibold">
            {isHard ? "Schedule conflict" : "Tight schedule"}
          </div>
          {data.pairs.map((p, i) => (
            <div key={i} className="opacity-90">{p.reason}</div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setTimelineOpen(true)}
            >
              View timeline
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={runSuggest}
              disabled={suggesting || drivers.length === 0}
            >
              {suggesting ? "Searching…" : "Suggest alternative driver"}
            </Button>
          </div>
          {suggestPairs !== null && (
            <div className="mt-1 space-y-0.5">
              {bestList.length === 0 ? (
                <div className="opacity-80">No other drivers available around this time.</div>
              ) : (
                <>
                  <div className="opacity-80">Best matches:</div>
                  {bestList.map((s) => {
                    const drv = drivers.find((d) => d.id === s.driver_id);
                    if (!drv) return null;
                    const tag =
                      s.severity === "free"
                        ? `free · +${s.min_slack_min} min slack`
                        : s.severity === "tight"
                          ? `tight · ${s.min_slack_min} min slack`
                          : `conflict · ${s.min_slack_min} min short`;
                    return (
                      <button
                        key={s.driver_id}
                        type="button"
                        onClick={() => onPickDriver(s.driver_id)}
                        className="w-full flex items-center justify-between gap-2 rounded border border-current/20 bg-background/40 px-2 py-1 text-left hover:bg-background/70"
                      >
                        <span className="font-medium truncate">{drv.name}</span>
                        <span className="text-[10px] tabular-nums opacity-80">{tag}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <ConflictTimelineDialog
        open={timelineOpen}
        onOpenChange={setTimelineOpen}
        pairs={data.pairs}
        driverName={currentDriverName}
      />
    </div>
  );
}

// ── Intermediate stops (adds/removes rows in group_stops for the job) ───
function StopsEditor({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listStopsForJob);
  const addFn = useServerFn(addStopToJob);
  const removeFn = useServerFn(removeStopFromJob);
  // AddressAutocomplete reads bias itself via the same hook.

  const [addr, setAddr] = useState("");
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["job-stops", jobId],
    queryFn: () => listFn({ data: { job_id: jobId } }) as Promise<{ group_id: string | null; stops: Array<{ id: string; stop_index: number; address: string }> }>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["job-stops", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };
  const addMut = useMutation({
    mutationFn: () => addFn({ data: { job_id: jobId, address: addr.trim(), place_id: placeId, lat, lng } }),
    onSuccess: () => { setAddr(""); setPlaceId(null); setLat(null); setLng(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { stop_id: id } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const stops = data?.stops ?? [];
  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Intermediate stops ({stops.length})</Label>
      {stops.length > 0 ? (
        <ul className="space-y-1">
          {stops.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 rounded bg-muted/40 px-2 py-1.5 text-sm">
              <span className="text-[10px] font-mono text-muted-foreground w-6 shrink-0">#{i + 1}</span>
              <span className="flex-1 truncate">{s.address}</span>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={removeMut.isPending} onClick={() => removeMut.mutate(s.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No intermediate stops. The trip goes straight from pickup to drop-off.</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1 min-w-0">
          <AddressAutocomplete
            value={addr}
            placeId={placeId}
            onChange={(v) => {
              setAddr(v.address);
              setPlaceId(v.place_id);
              setLat(v.lat ?? null);
              setLng(v.lng ?? null);
            }}
            placeholder="Add a stop (address or place)"
          />
        </div>
        <Button type="button" disabled={addMut.isPending || !addr.trim()} onClick={() => addMut.mutate()}>
          <Plus className="h-4 w-4 mr-1" /> Add stop
        </Button>
      </div>
    </div>
  );
}





