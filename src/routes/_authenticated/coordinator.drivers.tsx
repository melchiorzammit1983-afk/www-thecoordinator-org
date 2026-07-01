import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { listDrivers, createDriver } from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Drivers</h1>
          <p className="text-sm text-muted-foreground mt-1">Fleet available to receive assignments.</p>
        </div>
        <NewDriverDialog />
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>Profile updated</TableHead>
              <TableHead>Status</TableHead>
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
                <TableCell className="max-w-[240px] truncate" title={d.availability_note ?? ""}>{d.availability_note ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.profile_updated_at ? new Date(d.profile_updated_at).toLocaleString() : "—"}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{d.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
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
        <DialogHeader><DialogTitle>New driver</DialogTitle></DialogHeader>
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
