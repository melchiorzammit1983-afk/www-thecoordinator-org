import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createJob, updateJob } from "@/lib/coordinator.functions";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useFeatureCost, useMyCompany } from "@/hooks/use-coordinator";
import { Coins } from "lucide-react";

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
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [date, setDate] = useState(""); const [time, setTime] = useState("");
  const [flight, setFlight] = useState(""); const [client, setClient] = useState("");
  const [vehicle, setVehicle] = useState(""); const [driverId, setDriverId] = useState<string>("__none__");
  const [qr, setQr] = useState(false); const [track, setTrack] = useState(false);

  useEffect(() => {
    if (open) {
      setFrom(job?.from_location ?? ""); setTo(job?.to_location ?? "");
      setDate(job?.date ?? new Date().toISOString().slice(0, 10));
      setTime(job?.time?.slice(0, 5) ?? "09:00");
      setFlight(job?.flightorship ?? ""); setClient(job?.clientcompanyname ?? "");
      setVehicle(job?.vehicle ?? ""); setDriverId(job?.driver_id ?? "__none__");
      setQr(job?.qr_strict_mode ?? false); setTrack(job?.tracking_enabled ?? false);
    }
  }, [open, job]);

  const qc = useQueryClient();
  const createFn = useServerFn(createJob);
  const updateFn = useServerFn(updateJob);
  const qrCost = useFeatureCost("qr"); const trackCost = useFeatureCost("tracking");
  const { data: company } = useMyCompany();
  const balance = company?.points_balance ?? 0;

  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        from_location: from, to_location: to, date, time,
        flightorship: flight, clientcompanyname: client, vehicle,
        driver_id: driverId === "__none__" ? null : driverId,
        qr_strict_mode: qr, tracking_enabled: track,
      };
      return job ? updateFn({ data: { id: job.id, ...payload } }) : createFn({ data: payload });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{job ? "Edit trip" : "New trip"}</DialogTitle>
          <DialogDescription>Schedule a transfer and assign resources.</DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
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
