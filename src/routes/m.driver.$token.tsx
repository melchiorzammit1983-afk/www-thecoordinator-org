import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getDriverManifest, driverAcceptJob, driverApproveDeletion,
  updateJobStatus, listJobPaxDriver, markPaxOnboard,
} from "@/lib/coordinator-public.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { QrScanner } from "@/components/driver/QrScanner";

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
    queryFn: () => fn({ data: { token } }) as Promise<{ link: { subject_label: string | null }; jobs: Job[] } | null>,
  });
  const [openJob, setOpenJob] = useState<Job | null>(null);

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
        <div className="max-w-3xl mx-auto">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Driver manifest</div>
          <div className="text-2xl font-bold">{data.link.subject_label}</div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto p-4 space-y-3">
        {jobs.length === 0 && <div className="text-center py-16 text-muted-foreground">No trips today or tomorrow.</div>}
        {jobs.map((j) => <JobRow key={j.id} job={j} token={token} onOpen={() => setOpenJob(j)} />)}
      </main>
      <TripExecutionDialog job={openJob} token={token} onOpenChange={(v) => !v && setOpenJob(null)} />
    </div>
  );
}

function JobRow({ job, token, onOpen }: { job: Job; token: string; onOpen: () => void }) {
  const qc = useQueryClient();
  const acceptFn = useServerFn(driverAcceptJob);
  const approveDelFn = useServerFn(driverApproveDeletion);
  const statusFn = useServerFn(updateJobStatus);

  const acceptMut = useMutation({
    mutationFn: () => acceptFn({ data: { token, job_id: job.id } }),
    onSuccess: () => { toast.success("Trip accepted"); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const approveDelMut = useMutation({
    mutationFn: () => approveDelFn({ data: { token, job_id: job.id } }),
    onSuccess: () => { toast.success("Deletion approved"); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const statusMut = useMutation({
    mutationFn: (status: string) => statusFn({ data: { token, job_id: job.id, status: status as never } }),
    onSuccess: () => { toast.success("Status updated"); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.to_location)}`;
  const currentIdx = STATUS_FLOW.findIndex((s) => s.value === job.status);
  const nextStatus = STATUS_FLOW[currentIdx + 1] ?? (currentIdx === -1 ? STATUS_FLOW[0] : null);

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
