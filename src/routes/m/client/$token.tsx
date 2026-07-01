import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClientBookings } from "@/lib/coordinator-public.functions";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/m/clients/$token")({
  head: () => ({ meta: [{ title: "My Bookings" }] }),
  component: ClientPortal,
});

function ClientPortal() {
  const { token } = Route.useParams();
  const fn = useServerFn(getClientBookings);
  const { data, isLoading } = useQuery({
    queryKey: ["client-portal", token],
    queryFn: () => fn({ data: { token } }) as Promise<{ link: any; bookings: any[] } | null>,
  });
  if (isLoading) return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  if (!data) return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Link invalid or expired</h1>
        <p className="text-sm text-muted-foreground mt-2">Ask your coordinator for a new link.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Your bookings</div>
          <div className="text-xl font-semibold">{data.link.subject_label}</div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto p-4 space-y-3">
        {data.bookings.length === 0 && <div className="text-center py-16 text-muted-foreground text-sm">No bookings yet.</div>}
        {data.bookings.map((b) => (
          <div key={b.id} className="rounded-lg border bg-card p-4">
            <div className="flex justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs text-muted-foreground">{b.date ?? "—"} · {b.time?.slice(0,5)}</div>
                <div className="font-medium">{b.from_location} → {b.to_location}</div>
                <div className="text-xs text-muted-foreground">{b.name} {b.surname}{b.room_number ? ` · Room ${b.room_number}` : ""}</div>
              </div>
              <Badge variant={b.status === "accepted" ? "default" : b.status === "rejected" ? "destructive" : "secondary"} className="capitalize">
                {String(b.status).replace("_", " ")}
              </Badge>
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
