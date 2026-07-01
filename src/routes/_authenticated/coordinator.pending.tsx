import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listPendingBookings, approveBooking, rejectBooking, resolveModification,
} from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/coordinator/pending")({
  head: () => ({ meta: [{ title: "Pending — Coordinator" }] }),
  component: PendingPage,
});

function PendingPage() {
  const fn = useServerFn(listPendingBookings);
  const { data, refetch } = useQuery({
    queryKey: ["pending"],
    queryFn: () => fn() as Promise<{ bookings: any[]; modifications: any[] }>,
    refetchInterval: 15_000,
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold">Action required</h1>
      <p className="text-sm text-muted-foreground mt-1">New bookings and last-minute modifications from clients.</p>

      <Tabs defaultValue="new" className="mt-6">
        <TabsList>
          <TabsTrigger value="new">New bookings ({data?.bookings.filter(b => b.status === "pending").length ?? 0})</TabsTrigger>
          <TabsTrigger value="mods">Modification pending ({data?.modifications.length ?? 0})</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="mt-4 space-y-3">
          {(data?.bookings.filter(b => b.status === "pending") ?? []).map((b) => (
            <BookingCard key={b.id} b={b} onDone={refetch} />
          ))}
          {(data?.bookings.filter(b => b.status === "pending").length ?? 0) === 0 && (
            <Empty label="No new bookings." />
          )}
        </TabsContent>
        <TabsContent value="mods" className="mt-4 space-y-3">
          {(data?.modifications ?? []).map((m) => <ModCard key={m.id} m={m} onDone={refetch} />)}
          {(data?.modifications.length ?? 0) === 0 && <Empty label="No pending modifications." />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="text-center text-sm text-muted-foreground py-16 border rounded-lg bg-card">{label}</div>;
}

function BookingCard({ b, onDone }: { b: any; onDone: () => void }) {
  const approve = useServerFn(approveBooking);
  const reject = useServerFn(rejectBooking);
  const qc = useQueryClient();
  const approveMut = useMutation({
    mutationFn: () => approve({ data: { id: b.id } }),
    onSuccess: () => { toast.success("Approved"); onDone(); qc.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (e: Error) => e.message === "insufficient_points" ? toast.error("Top-Up Required to approve") : toast.error(e.message),
  });
  const rejectMut = useMutation({
    mutationFn: () => reject({ data: { id: b.id } }),
    onSuccess: () => { toast.success("Rejected"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-medium">{b.name} {b.surname}</div>
          <div className="text-xs text-muted-foreground">{b.client_email}{b.room_number ? ` · Room ${b.room_number}` : ""}</div>
          <div className="text-sm mt-2">{b.from_location} → {b.to_location}</div>
          <div className="text-xs text-muted-foreground">{b.date ?? "—"} at {b.time?.slice(0,5)}</div>
        </div>
        <Badge variant="secondary">Pending</Badge>
      </div>
      <div className="flex gap-2 mt-3">
        <Button size="sm" disabled={approveMut.isPending} onClick={() => approveMut.mutate()}>Approve</Button>
        <Button size="sm" variant="outline" disabled={rejectMut.isPending} onClick={() => rejectMut.mutate()}>Reject</Button>
      </div>
    </div>
  );
}

function ModCard({ m, onDone }: { m: any; onDone: () => void }) {
  const fn = useServerFn(resolveModification);
  const approveMut = useMutation({
    mutationFn: () => fn({ data: { id: m.id, approve: true } }),
    onSuccess: () => { toast.success("Modification approved"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rejectMut = useMutation({
    mutationFn: () => fn({ data: { id: m.id, approve: false } }),
    onSuccess: () => { toast.success("Modification rejected"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const b = m.client_bookings;
  const ch = m.requested_changes ?? {};
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-medium">{b.name} {b.surname}</div>
          <div className="text-xs text-muted-foreground">Original pickup: {b.date} {b.time?.slice(0,5)}</div>
          <div className="text-sm mt-2">Currently: {b.from_location} → {b.to_location}</div>
        </div>
        <Badge variant="destructive">2-Hour Rule</Badge>
      </div>
      <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs space-y-1">
        <div className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground mb-1">Requested changes</div>
        {Object.entries(ch).map(([k, v]) => (
          <div key={k}><span className="text-muted-foreground">{k}:</span> {String(v ?? "—")}</div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <Button size="sm" disabled={approveMut.isPending} onClick={() => approveMut.mutate()}>Approve change</Button>
        <Button size="sm" variant="outline" disabled={rejectMut.isPending} onClick={() => rejectMut.mutate()}>Reject</Button>
      </div>
    </div>
  );
}
