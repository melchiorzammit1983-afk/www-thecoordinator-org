import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDriverManifest } from "@/lib/coordinator-public.functions";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/m/driver/$token")({
  head: () => ({ meta: [{ title: "Driver Manifest" }] }),
  component: DriverManifest,
});

function DriverManifest() {
  const { token } = Route.useParams();
  const fn = useServerFn(getDriverManifest);
  const { data, isLoading } = useQuery({
    queryKey: ["driver-manifest", token],
    queryFn: () => fn({ data: { token } }) as Promise<{ link: any; jobs: any[] } | null>,
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
        {data.jobs.map((j) => (
          <div key={j.id} className="rounded-lg border bg-card p-4">
            <div className="flex justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs text-muted-foreground">{j.date} · {j.time?.slice(0,5)}</div>
                <div className="font-medium">{j.from_location} → {j.to_location}</div>
                {j.clientcompanyname && <div className="text-xs text-muted-foreground">{j.clientcompanyname}</div>}
              </div>
              <div className="flex gap-1 flex-wrap">
                {j.qr_strict_mode && <Badge>QR required</Badge>}
                {j.tracking_enabled && <Badge variant="outline">Tracking</Badge>}
                {j.flightorship && <Badge variant="secondary">{j.flightorship}</Badge>}
              </div>
            </div>
          </div>
        ))}
      </main>
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
