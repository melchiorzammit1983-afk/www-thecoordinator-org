import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getDriverManifest, driverAcceptJob, driverApproveDeletion,
  updateJobStatus, listJobPaxDriver, markPaxOnboard,
  updateDriverProfile, setJobPaymentStatus, hideJobForDriver, getDriverStatement,
} from "@/lib/coordinator-public.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { QrScanner } from "@/components/driver/QrScanner";
import { CheckCircle2, Clock, Download, X, FileText } from "lucide-react";

export const Route = createFileRoute("/m/driver/$token")({
  head: () => ({ meta: [{ title: "Driver Manifest" }] }),
  component: DriverManifest,
});

type Job = {
  id: string; from_location: string; to_location: string;
  date: string; time: string; pickup_at: string | null;
  flightorship: string | null; vehicle: string | null;
  qr_strict_mode: boolean; tracking_enabled: boolean;
  clientcompanyname: string | null;
  driver_accepted_at: string | null;
  deletion_requested_at: string | null;
  status?: string;
  payment_status?: "pending" | "paid";
};

type Driver = {
  id: string; name: string;
  seats_available: number | null;
  availability_note: string | null;
  profile_updated_at: string | null;
};

const STATUS_FLOW: Array<{ value: string; label: string }> = [
  { value: "en_route", label: "En route" },
  { value: "arrived", label: "Arrived at pickup" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

function DriverManifest() {
  const { token } = Route.useParams();
  const fn = useServerFn(getDriverManifest);
  const { data, isLoading } = useQuery({
    queryKey: ["driver-manifest", token],
    queryFn: () => fn({ data: { token } }) as Promise<{ link: { subject_label: string | null }; jobs: Job[]; driver: Driver | null } | null>,
  });
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);

  // Auto-open profile setup on first entry
  useEffect(() => {
    if (data?.driver && !data.driver.profile_updated_at) setProfileOpen(true);
  }, [data?.driver]);

  if (isLoading) return <div className="min-h-screen grid place-items-center text-muted-foreground text-base">Loading…</div>;
  if (!data) return <NotFound />;

  const jobs = [...data.jobs].sort((a, b) => {
    const ta = a.pickup_at ? new Date(a.pickup_at).getTime() : Infinity;
    const tb = b.pickup_at ? new Date(b.pickup_at).getTime() : Infinity;
    return ta - tb;
  });

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background px-4 py-5">
        <div className="max-w-3xl mx-auto flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Driver manifest</div>
            <div className="text-2xl font-bold">{data.driver?.name ?? data.link.subject_label}</div>
            {data.driver && (
              <div className="text-xs text-muted-foreground mt-1">
                {data.driver.seats_available != null ? `${data.driver.seats_available} seats` : "No seat count"}
                {data.driver.availability_note ? ` · ${data.driver.availability_note}` : ""}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {data.driver && (
              <Button size="sm" variant="outline" onClick={() => setProfileOpen(true)}>Edit profile</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setStatementOpen(true)}>
              <FileText className="h-4 w-4 mr-1" /> Statement
            </Button>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto p-4 space-y-3">
        {jobs.length === 0 && <div className="text-center py-16 text-muted-foreground">No trips yet.</div>}
        {jobs.map((j) => <JobRow key={j.id} job={j} token={token} onOpen={() => setOpenJob(j)} />)}
      </main>
      <TripExecutionDialog job={openJob} token={token} onOpenChange={(v) => !v && setOpenJob(null)} />
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} token={token} driver={data.driver} />
      <StatementDialog open={statementOpen} onOpenChange={setStatementOpen} token={token} driverName={data.driver?.name ?? "driver"} />
    </div>
  );
}

function JobRow({ job, token, onOpen }: { job: Job; token: string; onOpen: () => void }) {
  const qc = useQueryClient();
  const acceptFn = useServerFn(driverAcceptJob);
  const approveDelFn = useServerFn(driverApproveDeletion);
  const statusFn = useServerFn(updateJobStatus);
  const payFn = useServerFn(setJobPaymentStatus);
  const hideFn = useServerFn(hideJobForDriver);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["driver-manifest", token] });
  const acceptMut = useMutation({
    mutationFn: () => acceptFn({ data: { token, job_id: job.id } }),
    onSuccess: () => { toast.success("Trip accepted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const approveDelMut = useMutation({
    mutationFn: () => approveDelFn({ data: { token, job_id: job.id } }),
    onSuccess: () => { toast.success("Deletion approved"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const statusMut = useMutation({
    mutationFn: (status: string) => statusFn({ data: { token, job_id: job.id, status: status as never } }),
    onSuccess: () => { toast.success("Status updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const payMut = useMutation({
    mutationFn: (status: "paid" | "pending") => payFn({ data: { token, job_id: job.id, status } }),
    onSuccess: () => { toast.success("Payment updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const hideMut = useMutation({
    mutationFn: () => hideFn({ data: { token, job_id: job.id } }),
    onSuccess: () => { toast.success("Removed from your list"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.to_location)}`;
  const currentIdx = STATUS_FLOW.findIndex((s) => s.value === job.status);
  const nextStatus = STATUS_FLOW[currentIdx + 1] ?? (currentIdx === -1 ? STATUS_FLOW[0] : null);
  const paid = job.payment_status === "paid";

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-primary">{job.pickup_at ? new Date(job.pickup_at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : `${job.date} ${job.time?.slice(0,5)}`}</div>
          <div className="text-lg font-bold leading-tight">{job.from_location}</div>
          <div className="text-xs text-muted-foreground">↓</div>
          <div className="text-lg font-bold leading-tight">{job.to_location}</div>
          {job.clientcompanyname && <div className="text-xs text-muted-foreground mt-1">{job.clientcompanyname}</div>}
        </div>
        <div className="flex gap-1 flex-wrap items-start">
          {paid
            ? <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" /> Paid</Badge>
            : <Badge variant="outline"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>}
          {job.qr_strict_mode && <Badge>QR required</Badge>}
          {job.tracking_enabled && <Badge variant="outline">Tracking</Badge>}
          {job.flightorship && <Badge variant="secondary">{job.flightorship}</Badge>}
          {job.driver_accepted_at && <Badge className="bg-emerald-600 hover:bg-emerald-600">Accepted</Badge>}
          {job.deletion_requested_at && <Badge variant="destructive">Deletion requested</Badge>}
          {job.status && job.status !== "pending" && <Badge variant="outline" className="capitalize">{job.status.replace("_", " ")}</Badge>}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {!job.driver_accepted_at && !job.deletion_requested_at && (
          <Button size="lg" disabled={acceptMut.isPending} onClick={() => acceptMut.mutate()}>
            {acceptMut.isPending ? "Accepting…" : "Accept trip"}
          </Button>
        )}
        {job.driver_accepted_at && !job.deletion_requested_at && (
          <>
            <Button size="lg" onClick={onOpen}>Open trip</Button>
            {nextStatus && (
              <Button size="lg" variant="secondary" disabled={statusMut.isPending}
                onClick={() => statusMut.mutate(nextStatus.value)}>
                {nextStatus.label}
              </Button>
            )}
          </>
        )}
        <Button size="lg" variant="outline" asChild>
          <a href={mapsUrl} target="_blank" rel="noreferrer">Navigate</a>
        </Button>
        <Button size="lg" variant={paid ? "outline" : "default"} disabled={payMut.isPending}
          onClick={() => payMut.mutate(paid ? "pending" : "paid")}>
          {paid ? "Mark pending" : "Mark paid"}
        </Button>
        <Button size="lg" variant="ghost" disabled={hideMut.isPending}
          onClick={() => { if (confirm("Remove this trip from your list?")) hideMut.mutate(); }}>
          <X className="h-4 w-4 mr-1" /> Delete
        </Button>
        {job.deletion_requested_at && (
          <Button size="lg" variant="destructive" disabled={approveDelMut.isPending}
            onClick={() => { if (confirm("Approve deletion?")) approveDelMut.mutate(); }}>
            {approveDelMut.isPending ? "Approving…" : "Approve deletion"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ProfileDialog({ open, onOpenChange, token, driver }: {
  open: boolean; onOpenChange: (v: boolean) => void; token: string; driver: Driver | null;
}) {
  const [name, setName] = useState(driver?.name ?? "");
  const [seats, setSeats] = useState<string>(driver?.seats_available != null ? String(driver.seats_available) : "");
  const [note, setNote] = useState(driver?.availability_note ?? "");
  useEffect(() => {
    setName(driver?.name ?? "");
    setSeats(driver?.seats_available != null ? String(driver.seats_available) : "");
    setNote(driver?.availability_note ?? "");
  }, [driver, open]);

  const qc = useQueryClient();
  const fn = useServerFn(updateDriverProfile);
  const mut = useMutation({
    mutationFn: () => fn({ data: {
      token,
      name: name.trim() || undefined,
      seats_available: seats.trim() === "" ? null : Number(seats),
      availability_note: note.trim() === "" ? null : note.trim(),
    }}),
    onSuccess: () => { toast.success("Saved"); onOpenChange(false); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error) => toast.error(e.message === "driver_link_required" ? "Ask your coordinator for a personal link." : e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>Coordinators see this on their dispatch board.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Seats available</Label>
            <Input type="number" min={0} value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="e.g. 4" />
          </div>
          <div className="space-y-1.5">
            <Label>Availability</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Mon–Fri 06:00–18:00. Off Sundays." />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatementDialog({ open, onOpenChange, token, driverName }: {
  open: boolean; onOpenChange: (v: boolean) => void; token: string; driverName: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [payment, setPayment] = useState<"all" | "paid" | "pending">("all");
  const fn = useServerFn(getDriverStatement);
  const mut = useMutation({
    mutationFn: () => fn({ data: { token, from, to, payment } }),
    onSuccess: (rows) => {
      const list = rows as Array<Record<string, unknown>>;
      if (list.length === 0) { toast.info("No trips in this range"); return; }
      const headers = ["date","time","from","to","client","vehicle","status","payment"];
      const csv = [headers.join(",")].concat(list.map((r) => [
        r.date, (r.time as string || "").slice(0,5),
        csvCell(r.from_location), csvCell(r.to_location),
        csvCell(r.clientcompanyname), csvCell(r.vehicle),
        r.status, r.payment_status,
      ].join(","))).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `statement-${driverName.replace(/\s+/g, "_")}-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${list.length} trip(s) exported`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download statement</DialogTitle>
          <DialogDescription>Export a CSV of your trips.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5">
            <Label>Payment</Label>
            <div className="flex gap-2">
              {(["all","paid","pending"] as const).map((k) => (
                <Button key={k} type="button" size="sm"
                  variant={payment === k ? "default" : "outline"}
                  onClick={() => setPayment(k)}>{k}</Button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
            <Download className="h-4 w-4 mr-1" /> {mut.isPending ? "Preparing…" : "Download CSV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function TripExecutionDialog({ job, token, onOpenChange }: { job: Job | null; token: string; onOpenChange: (v: boolean) => void }) {
  const [scanning, setScanning] = useState(false);
  const qc = useQueryClient();
  const listFn = useServerFn(listJobPaxDriver);
  const markFn = useServerFn(markPaxOnboard);

  const { data: pax, refetch } = useQuery({
    queryKey: ["driver-pax", job?.id],
    queryFn: () => listFn({ data: { token, job_id: job!.id } }) as Promise<Array<{ id: string; name: string; status: string }>>,
    enabled: !!job,
  });

  const markMut = useMutation({
    mutationFn: (v: { pax_id: string; method: "qr" | "manual" }) =>
      markFn({ data: { token, job_id: job!.id, pax_id: v.pax_id, method: v.method } }),
    onSuccess: () => { toast.success("Passenger onboard"); refetch(); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error) => toast.error(e.message === "qr_required" ? "QR scan required for this trip" : e.message),
  });

  function handleScan(text: string) {
    const match = (pax ?? []).find((p) => p.id === text || p.name === text);
    if (!match) { toast.error("Passenger not on this trip"); return; }
    if (match.status === "onboard") return;
    markMut.mutate({ pax_id: match.id, method: "qr" });
  }

  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{job?.from_location} → {job?.to_location}</DialogTitle>
          <DialogDescription>
            {job?.qr_strict_mode ? "QR scan required for boarding." : "Scan QR or manually confirm each passenger."}
          </DialogDescription>
        </DialogHeader>
        {scanning ? (
          <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />
        ) : (
          <Button size="lg" onClick={() => setScanning(true)}>Open QR scanner</Button>
        )}
        <div className="space-y-2 max-h-72 overflow-auto">
          {(pax ?? []).length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No passengers on this trip.</p>}
          {(pax ?? []).map((p) => (
            <div key={p.id} className="flex items-center justify-between border rounded-md p-2.5">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{p.status}</div>
              </div>
              {p.status !== "onboard" && !job?.qr_strict_mode && (
                <Button size="sm" variant="secondary" disabled={markMut.isPending}
                  onClick={() => markMut.mutate({ pax_id: p.id, method: "manual" })}>
                  Manually confirm
                </Button>
              )}
              {p.status === "onboard" && <Badge className="bg-emerald-600 hover:bg-emerald-600">Onboard</Badge>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Link invalid or expired</h1>
        <p className="text-sm text-muted-foreground mt-2">Ask your coordinator for a new link.</p>
      </div>
    </div>
  );
}
