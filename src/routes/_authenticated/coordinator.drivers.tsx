import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { listDrivers, createDriver } from "@/lib/coordinator.functions";
import { updateDriverRates, getPricingSettings } from "@/lib/pricing.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Wallet } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/coordinator/drivers")({
  head: () => ({ meta: [{ title: "Drivers — Coordinator" }] }),
  component: DriversPage,
});

function DriversPage() {
  const fn = useServerFn(listDrivers);
  const { data } = useQuery({ queryKey: ["drivers"], queryFn: () => fn() as Promise<any[]> });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6 gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Drivers</h1>
          <p className="text-sm text-muted-foreground mt-1">Fleet available to receive assignments.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/coordinator/pricing"><Wallet className="h-4 w-4 mr-1" /> Pricing</Link>
          </Button>
          <NewDriverDialog />
        </div>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Rates</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No drivers yet.</TableCell></TableRow>
            ) : (data ?? []).map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>{d.phone ?? "—"}</TableCell>
                <TableCell>{d.vehicle ?? "—"}</TableCell>
                <TableCell>{d.seats_available ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  <RatesSummary d={d} />
                </TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{d.status}</Badge></TableCell>
                <TableCell className="text-right"><DriverRatesDialog driver={d} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RatesSummary({ d }: { d: any }) {
  const bits: string[] = [];
  if (d.pay_per_km != null) bits.push(`${Number(d.pay_per_km).toFixed(2)}/km`);
  if (d.pay_per_hour != null) bits.push(`${Number(d.pay_per_hour).toFixed(2)}/hr`);
  if (d.commission_pct != null) bits.push(`${Number(d.commission_pct).toFixed(0)}% comm`);
  if (d.wait_share_pct != null) bits.push(`wait ${Number(d.wait_share_pct).toFixed(0)}%`);
  return <span className="text-muted-foreground">{bits.length ? bits.join(" · ") : "Company defaults"}</span>;
}

function DriverRatesDialog({ driver }: { driver: any }) {
  const [open, setOpen] = useState(false);
  const settingsFn = useServerFn(getPricingSettings);
  const settingsQ = useQuery({ queryKey: ["pricing", "settings"], queryFn: () => settingsFn() as Promise<any>, enabled: open });
  const cur = settingsQ.data?.currency ?? "EUR";
  const [f, setF] = useState({
    pay_per_km: driver.pay_per_km, pay_per_hour: driver.pay_per_hour,
    wait_share_pct: driver.wait_share_pct, commission_pct: driver.commission_pct,
  });
  const qc = useQueryClient();
  const fn = useServerFn(updateDriverRates);
  const mut = useMutation({
    mutationFn: () => fn({ data: { id: driver.id, ...f } as any }),
    onSuccess: () => { toast.success("Rates saved"); setOpen(false); qc.invalidateQueries({ queryKey: ["drivers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const num = (v: any) => (v === "" || v == null ? null : Number(v));
  const val = (v: any) => (v == null ? "" : String(v));
  const def = settingsQ.data ?? {};
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Edit rates</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{driver.name} — rate overrides</DialogTitle>
          <DialogDescription>Leave a field blank to fall back to the company default (shown as the hint).</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Pay per km ({cur})</Label>
            <Input type="number" min={0} step="0.01" value={val(f.pay_per_km)}
              placeholder={`Default: ${def.default_driver_pay_per_km ?? 0}`}
              onChange={(e) => setF({ ...f, pay_per_km: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Pay per hour ({cur})</Label>
            <Input type="number" min={0} step="0.01" value={val(f.pay_per_hour)}
              placeholder={`Default: ${def.default_driver_pay_per_hour ?? 0}`}
              onChange={(e) => setF({ ...f, pay_per_hour: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Waiting share (%)</Label>
            <Input type="number" min={0} max={100} step="1" value={val(f.wait_share_pct)}
              placeholder={`Default: ${def.default_driver_wait_share_pct ?? 100}`}
              onChange={(e) => setF({ ...f, wait_share_pct: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Commission (%)</Label>
            <Input type="number" min={0} max={100} step="1" value={val(f.commission_pct)}
              placeholder={`Default: ${def.default_driver_commission_pct ?? 0}`}
              onChange={(e) => setF({ ...f, commission_pct: num(e.target.value) })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>Save rates</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewDriverDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(""); const [vehicle, setVehicle] = useState("");
  const qc = useQueryClient();
  const fn = useServerFn(createDriver);
  const mut = useMutation({
    mutationFn: () => fn({ data: { name, phone, email, vehicle } }),
    onSuccess: () => { toast.success("Driver added"); setOpen(false); qc.invalidateQueries({ queryKey: ["drivers"] });
      setName(""); setPhone(""); setEmail(""); setVehicle(""); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> New driver</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New driver</DialogTitle>
          <DialogDescription>Add a driver profile that can receive trip assignments.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={e=>setName(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={phone} onChange={e=>setPhone(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Vehicle</Label><Input value={vehicle} onChange={e=>setVehicle(e.target.value)} /></div>
          <DialogFooter><Button type="submit" disabled={mut.isPending || !name}>{mut.isPending?"Saving…":"Create"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
