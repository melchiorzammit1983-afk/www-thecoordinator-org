import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getDriverManifest, driverAcceptJob, driverApproveDeletion,
} from "@/lib/coordinator-public.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
};

function DriverManifest() {
  const { token } = Route.useParams();
  const fn = useServerFn(getDriverManifest);
  const { data, isLoading } = useQuery({
    queryKey: ["driver-manifest", token],
    queryFn: () => fn({ data: { token } }) as Promise<{ link: any; jobs: Job[] } | null>,
  });

  if (isLoading) return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  if (!data) return <NotFound />;
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Driver manifest</div>
          <div className="text-xl font-semibold">{data.link.subject_label}</div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto p-4 space-y-3">
        {data.jobs.length === 0 && <div className="text-center py-16 text-muted-foreground text-sm">No trips today or tomorrow.</div>}
        {data.jobs.map((j) => <JobRow key={j.id} job={j} token={token} />)}
      </main>
    </div>
  );
}

function JobRow({ job, token }: { job: Job; token: string }) {
  const qc = useQueryClient();
  const acceptFn = useServerFn(driverAcceptJob);
  const approveDelFn = useServerFn(driverApproveDeletion);

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

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-muted-foreground">{job.date} · {job.time?.slice(0,5)}</div>
          <div className="font-medium">{job.from_location} → {job.to_location}</div>
          {job.clientcompanyname && <div className="text-xs text-muted-foreground">{job.clientcompanyname}</div>}
        </div>
        <div className="flex gap-1 flex-wrap">
          {job.qr_strict_mode && <Badge>QR required</Badge>}
          {job.tracking_enabled && <Badge variant="outline">Tracking</Badge>}
          {job.flightorship && <Badge variant="secondary">{job.flightorship}</Badge>}
          {job.driver_accepted_at && <Badge className="bg-emerald-600 hover:bg-emerald-600">Accepted</Badge>}
          {job.deletion_requested_at && <Badge variant="destructive">Deletion requested</Badge>}
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        {!job.driver_accepted_at && !job.deletion_requested_at && (
          <Button size="sm" disabled={acceptMut.isPending} onClick={() => acceptMut.mutate()}>
            {acceptMut.isPending ? "Accepting…" : "Accept trip"}
          </Button>
        )}
        {job.deletion_requested_at && (
          <Button
            size="sm" variant="destructive"
            disabled={approveDelMut.isPending}
            onClick={() => { if (confirm("Approve deletion of this trip?")) approveDelMut.mutate(); }}
          >
            {approveDelMut.isPending ? "Approving…" : "Approve deletion"}
          </Button>
        )}
      </div>
    </div>
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
