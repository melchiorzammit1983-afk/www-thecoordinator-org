import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createJob, updateJob, createJobsBulk, listJobPax, addJobPax, removeJobPax } from "@/lib/coordinator.functions";
import { parseTrips, type ParsedTrip } from "@/lib/parse-trips";
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
import { Users, PencilLine, Plus, Trash2 } from "lucide-react";
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
  onSaved: () => void;
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
}: { drivers: Driver[]; job?: Job; prefill?: Prefill; onSaved: () => void }) {
  const [from, setFrom] = useState(job?.from_location ?? prefill?.from_location ?? "");
  const [to, setTo] = useState(job?.to_location ?? prefill?.to_location ?? "");
  const [fromFlight, setFromFlight] = useState(job?.from_flight ?? prefill?.from_flight ?? "");
  const [toFlight, setToFlight] = useState(job?.to_flight ?? prefill?.to_flight ?? "");
  const [date, setDate] = useState(job?.date ?? prefill?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(job?.time?.slice(0, 5) ?? prefill?.time ?? "09:00");
  const [client, setClient] = useState(job?.clientcompanyname ?? prefill?.clientcompanyname ?? "");
  const [vehicle, setVehicle] = useState(job?.vehicle ?? "");
  const [driverId, setDriverId] = useState<string>(job?.driver_id ?? "__none__");
  const [qr, setQr] = useState(job?.qr_strict_mode ?? false);
  const [track, setTrack] = useState(job?.tracking_enabled ?? false);
  const [paxText, setPaxText] = useState(prefill?.pax?.join("\n") ?? "");
  const [labelIds, setLabelIds] = useState<string[]>(job?.labels?.map((l) => l.id) ?? []);

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
        clientcompanyname: client, vehicle,
        driver_id: driverId === "__none__" ? null : driverId,
        qr_strict_mode: qr, tracking_enabled: track,
        label_ids: labelIds,
      };
      if (job) { await updateFn({ data: { id: job.id, ...payload } }); return; }
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
    },
    onSuccess: () => {
      toast.success(job ? "Trip updated" : "Trip created");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onSaved();
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
          <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={fromFlight ? "Airport (auto)" : ""} />
          <Input
            value={fromFlight}
            onChange={(e) => setFromFlight(e.target.value.toUpperCase())}
            placeholder="Flight / Ship (e.g. EK109)"
            className="text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label>To {!to && !toFlight && <span className="text-destructive">*</span>}</Label>
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={toFlight ? "Airport (auto)" : ""} />
          <Input
            value={toFlight}
            onChange={(e) => setToFlight(e.target.value.toUpperCase())}
            placeholder="Flight / Ship (e.g. EK109)"
            className="text-xs"
          />
        </div>
        <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label>Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label>Client company</Label><Input value={client} onChange={(e) => setClient(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Vehicle</Label><Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></div>
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
      <LabelPicker value={labelIds} onChange={setLabelIds} />
      <ToggleRow
        label="Require QR Code Verification" hint="Driver must scan pax QR to check in"
        checked={qr} onChange={setQr}
      />
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

function BulkForm({ onSaved, onComplete }: { onSaved: () => void; onComplete: (t: ParsedTrip) => void }) {
  const [raw, setRaw] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const parsed = useMemo(() => parseTrips(raw), [raw]);
  const valid = parsed.filter((t) => t.errors.length === 0);
  const incomplete = parsed.filter((t) => t.errors.length > 0);

  const qc = useQueryClient();
  const bulkFn = useServerFn(createJobsBulk);
  const mut = useMutation({
    mutationFn: () => bulkFn({ data: { trips: valid.map((t) => ({
      from_location: t.from_location, to_location: t.to_location,
      date: t.date, time: t.time,
      flightorship: t.flightorship, clientcompanyname: t.clientcompanyname,
      from_flight: t.from_flight, to_flight: t.to_flight,
      pax: t.pax,
    })), label_ids: labelIds } }),
    onSuccess: (res: { created: string[] }) => {
      toast.success(`Created ${res.created.length} trip${res.created.length === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      if (incomplete.length === 0) onSaved();
      else toast.message(`${incomplete.length} incomplete — finish them in Manual`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Paste trips</Label>
        <Textarea
          rows={10} value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"📅Wed 01 Jul 2026⏰11:00\n👤Names\n*🔁 ELMER CLEMENTE AGUINALDO\n•🔁 NIXON KALATHILAPARAMBIL VINCENT\n🏢 rosetti\n📍 From: cerviola\n📍 To: Airport\n\n— or plain text —\n01/07/2026 11:00\nFrom: Cerviola\nTo: Airport\nEK109\nELMER CLEMENTE AGUINALDO"}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Emojis optional. Blank line or a new date starts a new trip. Incomplete trips can be finished in Manual.
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

