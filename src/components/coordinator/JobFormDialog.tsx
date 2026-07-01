import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createJob, updateJob, createJobsBulk } from "@/lib/coordinator.functions";
import { parseTrips } from "@/lib/parse-trips";
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
import { useFeatureCost, useMyCompany } from "@/hooks/use-coordinator";
import { Coins, Users } from "lucide-react";

type Driver = { id: string; name: string; vehicle: string | null };

type Job = {
  id: string;
  from_location: string; to_location: string;
  date: string; time: string;
  flightorship: string | null;
  tracking_enabled: boolean; qr_strict_mode: boolean;
  vehicle: string | null;
  driver_id: string | null;
  clientcompanyname: string | null;
};

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
  const [tab, setTab] = useState<"manual" | "bulk">("manual");
  useEffect(() => { if (open) setTab("manual"); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit trip" : "New trip"}</DialogTitle>
          <DialogDescription>Schedule a transfer, add passengers, and assign resources.</DialogDescription>
        </DialogHeader>
        {isEdit ? (
          <ManualForm drivers={drivers} job={job} onSaved={onSaved} />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "manual" | "bulk")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Manual</TabsTrigger>
              <TabsTrigger value="bulk">Paste bulk</TabsTrigger>
            </TabsList>
            <TabsContent value="manual" className="mt-3">
              <ManualForm drivers={drivers} onSaved={onSaved} />
            </TabsContent>
            <TabsContent value="bulk" className="mt-3">
              <BulkForm onSaved={onSaved} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManualForm({
  drivers, job, onSaved,
}: { drivers: Driver[]; job?: Job; onSaved: () => void }) {
  const [from, setFrom] = useState(job?.from_location ?? "");
  const [to, setTo] = useState(job?.to_location ?? "");
  const [date, setDate] = useState(job?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(job?.time?.slice(0, 5) ?? "09:00");
  const [flight, setFlight] = useState(job?.flightorship ?? "");
  const [client, setClient] = useState(job?.clientcompanyname ?? "");
  const [vehicle, setVehicle] = useState(job?.vehicle ?? "");
  const [driverId, setDriverId] = useState<string>(job?.driver_id ?? "__none__");
  const [qr, setQr] = useState(job?.qr_strict_mode ?? false);
  const [track, setTrack] = useState(job?.tracking_enabled ?? false);
  const [paxText, setPaxText] = useState("");

  const qc = useQueryClient();
  const createFn = useServerFn(createJob);
  const updateFn = useServerFn(updateJob);
  const bulkFn = useServerFn(createJobsBulk);
  const qrCost = useFeatureCost("qr");
  const trackCost = useFeatureCost("tracking");
  const { data: company } = useMyCompany();
  const balance = company?.points_balance ?? 0;

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        from_location: from, to_location: to, date, time,
        flightorship: flight, clientcompanyname: client, vehicle,
        driver_id: driverId === "__none__" ? null : driverId,
        qr_strict_mode: qr, tracking_enabled: track,
      };
      if (job) { await updateFn({ data: { id: job.id, ...payload } }); return; }
      const pax = paxText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (pax.length) {
        // Use bulk fn so pax get inserted in one shot.
        await bulkFn({ data: { trips: [{
          from_location: from, to_location: to, date, time,
          flightorship: flight, clientcompanyname: client, pax,
        }] } });
      } else {
        await createFn({ data: payload });
      }
    },
    onSuccess: () => {
      toast.success(job ? "Trip updated" : "Trip created");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onSaved();
    },
    onError: (e: Error) => {
      if (e.message === "insufficient_points") toast.error("Top-Up Required to enable that feature");
      else toast.error(e.message);
    },
  });

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>From</Label><Input value={from} onChange={(e) => setFrom(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label>To</Label><Input value={to} onChange={(e) => setTo(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label>Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label>Flight / Ship</Label><Input value={flight} onChange={(e) => setFlight(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Client company</Label><Input value={client} onChange={(e) => setClient(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Vehicle</Label><Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></div>
        <div className="space-y-1.5">
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
      <ToggleRow
        label="Require QR Code Verification" hint="Driver must scan pax QR to check in"
        cost={qrCost} balance={balance} checked={qr} onChange={setQr}
      />
      <ToggleRow
        label="Enable Live Tracking" hint="GPS updates from driver device"
        cost={trackCost} balance={balance} checked={track} onChange={setTrack}
      />
      <DialogFooter>
        <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Saving…" : job ? "Save" : "Create"}</Button>
      </DialogFooter>
    </form>
  );
}

function BulkForm({ onSaved }: { onSaved: () => void }) {
  const [raw, setRaw] = useState("");
  const parsed = useMemo(() => parseTrips(raw), [raw]);
  const valid = parsed.filter((t) => t.errors.length === 0);

  const qc = useQueryClient();
  const bulkFn = useServerFn(createJobsBulk);
  const mut = useMutation({
    mutationFn: () => bulkFn({ data: { trips: valid.map((t) => ({
      from_location: t.from_location, to_location: t.to_location,
      date: t.date, time: t.time,
      flightorship: t.flightorship, clientcompanyname: t.clientcompanyname,
      pax: t.pax,
    })) } }),
    onSuccess: (res: { created: string[] }) => {
      toast.success(`Created ${res.created.length} trip${res.created.length === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onSaved();
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
          placeholder={"📅Wed 01 Jul 2026⏰11:00\n👤Names\n*🔁 ELMER CLEMENTE AGUINALDO\n•🔁 NIXON KALATHILAPARAMBIL VINCENT\n🏢 rosetti\n📍 From: cerviola\n📍 To: Airport"}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Multiple trip blocks OK. Each block starts with 📅. Names under 👤 become passengers.
        </p>
      </div>
      {parsed.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-auto rounded-md border p-2">
          {parsed.map((t, i) => (
            <div key={i} className={`rounded p-2 text-xs ${t.errors.length ? "bg-destructive/10 border border-destructive/30" : "bg-muted/40"}`}>
              <div className="font-medium">
                {t.from_location || "?"} → {t.to_location || "?"}
                <span className="text-muted-foreground"> · {t.date || "?"} {t.time || "?"} · {t.pax.length} pax</span>
              </div>
              {t.clientcompanyname && <div className="text-muted-foreground">🏢 {t.clientcompanyname}</div>}
              {t.pax.length > 0 && (
                <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Names</summary>
                  <ul className="pl-4 mt-1 list-disc">{t.pax.map((n, j) => <li key={j}>{n}</li>)}</ul>
                </details>
              )}
              {t.errors.length > 0 && (
                <div className="text-destructive mt-1">Skipped: {t.errors.join(", ")}</div>
              )}
            </div>
          ))}
        </div>
      )}
      <DialogFooter>
        <Button disabled={mut.isPending || valid.length === 0} onClick={() => mut.mutate()}>
          {mut.isPending ? "Creating…" : `Create ${valid.length} trip${valid.length === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ToggleRow({
  label, hint, cost, balance, checked, onChange,
}: {
  label: string; hint: string; cost: number | undefined; balance: number;
  checked: boolean; onChange: (v: boolean) => void;
}) {
  const free = cost === 0 || cost === undefined;
  const canAfford = free || balance >= (cost ?? 0);
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div>
        <div className="text-sm font-medium flex items-center gap-2">
          {label}
          {!free && cost ? (
            <span className="inline-flex items-center gap-1 text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              <Coins className="h-3 w-3" /> {cost}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">{hint}</div>
        {!canAfford && !checked && <div className="text-xs text-destructive mt-1">Top-Up Required</div>}
      </div>
      <Switch checked={checked} disabled={!canAfford && !checked} onCheckedChange={onChange} />
    </div>
  );
}
