import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createJob, updateJob, createJobsBulk, listJobPax, addJobPax, removeJobPax, setJobContactPhoneIfEmpty, extractTripsFromText } from "@/lib/coordinator.functions";
import { parseTrips, extractPhoneFromName, isMeaningfulName, type ParsedTrip } from "@/lib/parse-trips";
import { downloadExcelTemplate, downloadGoogleSheetsTemplate, looksLikeSheetPaste, parseSheetPaste } from "@/lib/sheet-template";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileDown } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
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
import { Users, PencilLine, Plus, Trash2, Sparkles } from "lucide-react";
import { useFeature } from "@/hooks/use-features";

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit trip" : "New trip"}</DialogTitle>
          <DialogDescription>Schedule a transfer, add passengers, and assign resources.</DialogDescription>
        </DialogHeader>
        {isEdit ? (
          <ManualForm drivers={drivers} job={job} onSaved={onSaved} />
        ) : !bulkEnabled ? (
          <ManualForm key={prefill ? "prefill" : "blank"} drivers={drivers} prefill={prefill} onSaved={onSaved} />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "manual" | "bulk")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Manual</TabsTrigger>
              <TabsTrigger value="bulk">Paste bulk</TabsTrigger>
            </TabsList>
            <TabsContent value="manual" className="mt-3">
              <ManualForm key={prefill ? "prefill" : "blank"} drivers={drivers} prefill={prefill} onSaved={onSaved} />
            </TabsContent>
            <TabsContent value="bulk" className="mt-3">
              <BulkForm onSaved={onSaved} onComplete={handleComplete} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManualForm({
  drivers, job, prefill, onSaved,
}: { drivers: Driver[]; job?: Job; prefill?: Prefill; onSaved: (createdDate?: string) => void }) {

  const [from, setFrom] = useState(job?.from_location ?? prefill?.from_location ?? "");
  const [to, setTo] = useState(job?.to_location ?? prefill?.to_location ?? "");
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>From {!from && !fromFlight && <span className="text-destructive">*</span>}</Label>
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onBlur={() => handleLocationBlur("from")}
            placeholder={fromFlight ? "Airport (auto)" : ""}
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
        <div className="space-y-1.5">
          <Label>To {!to && !toFlight && <span className="text-destructive">*</span>}</Label>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={() => handleLocationBlur("to")}
            placeholder={toFlight ? "Airport (auto)" : ""}
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
      <DialogFooter>
        <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Saving…" : job ? "Save" : "Create"}</Button>
      </DialogFooter>
    </form>
  );
}

function BulkForm({ onSaved, onComplete }: { onSaved: (createdDate?: string) => void; onComplete: (t: ParsedTrip) => void }) {
  const [raw, setRaw] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const parsed = useMemo(
    () => (looksLikeSheetPaste(raw) ? parseSheetPaste(raw) : parseTrips(raw)),
    [raw],
  );
  const valid = parsed.filter((t) => t.errors.length === 0);
  const incomplete = parsed.filter((t) => t.errors.length > 0);
  const aiEnabled = useFeature("ai_extraction");

  const qc = useQueryClient();
  const bulkFn = useServerFn(createJobsBulk);
  const aiFn = useServerFn(extractTripsFromText);

  const aiMut = useMutation({
    mutationFn: () => aiFn({ data: { text: raw } }) as Promise<{ trips: any[] }>,
    onSuccess: (res) => {
      const trips = res?.trips ?? [];
      if (!trips.length) { toast.error("AI could not find any trips"); return; }
      // Convert AI trips back to the parser's paste format so the existing review UI handles them.
      const blocks = trips.map((t) => {
        const lines: string[] = [];
        if (t.pickup_date) lines.push(`📅 ${t.pickup_date} ⏰ ${t.pickup_time || ""}`.trim());
        if (t.client_company) lines.push(`🏢 ${t.client_company}`);
        if (t.from_location || t.flight_code) lines.push(`📍 From: ${t.from_location || "Airport"}`);
        if (t.to_location || t.flight_code) lines.push(`📍 To: ${t.to_location || "Airport"}`);
        if (t.flight_code) lines.push(`✈ ${t.flight_code}`);
        if (t.contact_phone) lines.push(`📞 ${t.contact_phone}`);
        if (t.passengers?.length) {
          lines.push("👤 Names");
          for (const p of t.passengers) lines.push(`• ${p}`);
        }
        return lines.join("\n");
      }).join("\n\n");
      setRaw(blocks);
      toast.success(`AI extracted ${trips.length} trip${trips.length === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const earliestValidDate = valid
    .map((t) => t.date)
    .filter(Boolean)
    .sort()[0];

  const mut = useMutation({
    mutationFn: () => bulkFn({ data: { trips: valid.map((t) => ({
      from_location: t.from_location, to_location: t.to_location,
      date: t.date, time: t.time,
      flightorship: t.flightorship, clientcompanyname: t.clientcompanyname,
      from_flight: t.from_flight, to_flight: t.to_flight,
      contact_phone: t.contact_phone,
      pax: t.pax,
    })), label_ids: labelIds } }),
    onSuccess: (res: { created: string[] }) => {
      toast.success(`Created ${res.created.length} trip${res.created.length === 1 ? "" : "s"}`);
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
            {aiEnabled && (
              <Button
                type="button" size="sm" variant="outline"
                disabled={aiMut.isPending || raw.trim().length < 3}
                onClick={() => aiMut.mutate()}
                className="h-7"
              >
                <Sparkles className="h-3 w-3 mr-1" />
                {aiMut.isPending ? "Understanding…" : "Understand with AI"}
              </Button>
            )}
          </div>
        </div>
        <Textarea
          rows={10} value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"Paste rows copied from your Excel or Google Sheet — headers are optional.\nOr paste a WhatsApp/email message in any language.\n\nColumn order (if no header row):\nPickup Date  Pickup Time  Pickup Address  Delivery Address  Customer Name  Contact Number  Transport Type  Quantity"}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          {aiEnabled
            ? "You can paste rows straight from the template (headers optional), a WhatsApp/email message, or click ✨ Understand with AI."
            : "You can paste rows straight from the template (headers optional). Blank line or a new date starts a new trip. Incomplete trips can be finished in Manual."}
        </p>

      </div>
      {parsed.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-auto rounded-md border p-2">
          {parsed.map((t, i) => (
            <div key={i} className={`rounded p-2 text-xs ${t.errors.length ? "bg-destructive/10 border border-destructive/30" : "bg-muted/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">
                    {t.from_location || "?"} → {t.to_location || "?"}
                    <span className="text-muted-foreground"> · {t.date || "?"} {t.time || "?"} · {t.pax.length} pax</span>
                  </div>
                  {(t.from_flight || t.to_flight) && (
                    <div className="text-muted-foreground">✈ {t.from_flight || t.to_flight}</div>
                  )}
                  {t.clientcompanyname && <div className="text-muted-foreground">🏢 {t.clientcompanyname}</div>}
                  {t.pax.length > 0 && (
                    <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Names</summary>
                      <ul className="pl-4 mt-1 list-disc">{t.pax.map((n, j) => <li key={j}>{n}</li>)}</ul>
                    </details>
                  )}
                  {t.errors.length > 0 && (
                    <div className="text-destructive mt-1">Missing: {t.errors.map((e) => e.replace("Missing ", "")).join(", ")}</div>
                  )}
                </div>
                {t.errors.length > 0 && (
                  <Button type="button" size="sm" variant="outline" className="h-7 shrink-0"
                    onClick={() => onComplete(t)}>
                    <PencilLine className="h-3 w-3 mr-1" /> Complete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <LabelPicker value={labelIds} onChange={setLabelIds} />
      <DialogFooter>
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


