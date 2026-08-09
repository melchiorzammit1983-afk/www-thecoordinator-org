import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getOperationLinkView } from "@/lib/operation-links.server";

export const Route = createFileRoute("/operation-link/$token")({
  head: () => ({ meta: [{ title: "Operation Link" }] }),
  component: OperationLinkPage,
});

function OperationLinkPage() {
  const { token } = Route.useParams();
  const viewFn = useServerFn(getOperationLinkView);
  const query = useQuery({ queryKey: ["operation-link", token], queryFn: () => viewFn({ data: { token } }) });
  if (query.isLoading) return <main className="grid min-h-screen place-items-center p-6 text-sm text-muted-foreground">Loading Operation Link…</main>;
  if (query.error || !query.data) return <main className="grid min-h-screen place-items-center bg-muted/20 p-6"><div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center"><h1 className="text-xl font-semibold">Operation Link unavailable</h1><p className="mt-2 text-sm text-muted-foreground">This link is expired, revoked, or invalid.</p></div></main>;
  const { group, link, ships, flights, jobs } = query.data;
  return <main className="min-h-screen bg-muted/20 px-4 py-6 sm:px-6"><div className="mx-auto max-w-2xl space-y-4"><header className="rounded-2xl border bg-card p-5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operation Link</p><h1 className="mt-1 text-2xl font-semibold">{group.name}</h1><p className="mt-1 text-sm text-muted-foreground">{group.reference} · {group.type.replaceAll("_", " ")} · {group.status}</p><p className="mt-2 text-xs text-muted-foreground">For {link.recipient_name} · Updated {new Date().toLocaleString()}</p></header>
    <section className="rounded-2xl border bg-card p-5"><h2 className="font-semibold">Schedule</h2><p className="mt-2 text-sm">{group.start_date ?? "No start date"} → {group.end_date ?? "No end date"}</p></section>
    {ships.length > 0 && <section className="rounded-2xl border bg-card p-5"><h2 className="font-semibold">Ship</h2><div className="mt-3 space-y-2 text-sm">{ships.map((row: any, index: number) => <div key={index} className="rounded-lg border p-3"><p className="font-medium">{row.ship_events?.ship_name}</p><p className="text-xs text-muted-foreground">ETA {row.ship_events?.eta ?? "—"} · Departure {row.ship_events?.expected_departure ?? "—"}</p><p className="text-xs text-muted-foreground">{row.ship_events?.port ?? "—"} · {row.ship_events?.berths?.name ?? "No pickup point"} · {row.ship_events?.status ?? "Scheduled"}</p></div>)}</div></section>}
    {flights.length > 0 && <section className="rounded-2xl border bg-card p-5"><h2 className="font-semibold">Flights</h2><div className="mt-3 space-y-2 text-sm">{flights.map((row: any, index: number) => <div key={index} className="rounded-lg border p-3"><p className="font-medium">{row.flight_schedule_records?.flight_number} · {row.flight_schedule_records?.airline}</p><p className="text-xs text-muted-foreground">{row.flight_schedule_records?.origin} → {row.flight_schedule_records?.destination} · {row.flight_schedule_records?.scheduled_date} {row.flight_schedule_records?.scheduled_time}</p></div>)}</div></section>}
    {jobs.length > 0 && <section className="rounded-2xl border bg-card p-5"><h2 className="font-semibold">Trip progress</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{jobs.map((job: any) => <div key={job.id} className="rounded-lg border p-3 text-center text-sm"><p className="font-medium capitalize">{job.status}</p><p className="text-xs text-muted-foreground">{job.date} {String(job.time ?? "").slice(0, 5)}</p></div>)}</div></section>}
  </div></main>;
}
