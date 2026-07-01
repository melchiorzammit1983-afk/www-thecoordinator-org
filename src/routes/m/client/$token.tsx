import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getClientBookings, cancelClientBooking } from "@/lib/coordinator-public.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditBookingDialog } from "@/components/client/EditBookingDialog";
import { RecurringDialog } from "@/components/client/RecurringDialog";

export const Route = createFileRoute("/m/client/$token")({
  head: () => ({ meta: [{ title: "My Bookings" }] }),
  component: ClientPortal,
});

type Booking = {
  id: string; name: string; surname: string; client_email: string;
  from_location: string; to_location: string;
  date: string | null; time: string | null; pickup_at: string | null;
  status: string; room_number: string | null;
};

function ClientPortal() {
  const { token } = Route.useParams();
  const fn = useServerFn(getClientBookings);
  const { data, isLoading } = useQuery({
    queryKey: ["client-portal", token],
    queryFn: () => fn({ data: { token } }) as Promise<{ link: { subject_label: string | null }; bookings: Booking[] } | null>,
  });
  const [editing, setEditing] = useState<Booking | null>(null);

  if (isLoading) return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  if (!data) return <NotFound />;

  const upcoming = data.bookings.filter((b) => !b.pickup_at || new Date(b.pickup_at).getTime() > Date.now() - 3600_000);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Your bookings</div>
          <div className="text-xl font-semibold">{data.link.subject_label ?? "Client portal"}</div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto p-4 space-y-3">
        <RecurringDialog token={token} defaultName={data.link.subject_label ?? ""} />
        {upcoming.length === 0 && <div className="text-center py-16 text-muted-foreground text-sm">No upcoming bookings.</div>}
        {upcoming.map((b) => (
          <BookingRow key={b.id} b={b} token={token} onEdit={() => setEditing(b)} />
        ))}
      </main>
      <EditBookingDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        token={token}
        booking={editing}
      />
    </div>
  );
}

function BookingRow({ b, token, onEdit }: { b: Booking; token: string; onEdit: () => void }) {
  const qc = useQueryClient();
  const cancelFn = useServerFn(cancelClientBooking);
  const cancelMut = useMutation({
    mutationFn: () => cancelFn({ data: { token, booking_id: b.id } }),
    onSuccess: (r) => {
      toast.success(r.mode === "pending"
        ? "Cancellation within 2 hours requires coordinator approval."
        : "Booking cancelled.");
      qc.invalidateQueries({ queryKey: ["client-portal", token] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const locked = b.status === "cancelled" || b.status === "rejected";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-muted-foreground">{b.date ?? "—"} · {b.time?.slice(0,5)}</div>
          <div className="font-medium">{b.from_location} → {b.to_location}</div>
          <div className="text-xs text-muted-foreground">
            {b.name} {b.surname}{b.room_number ? ` · Room ${b.room_number}` : ""} · 1 pax
          </div>
        </div>
        <Badge variant={b.status === "accepted" ? "default" : b.status === "rejected" || b.status === "cancelled" ? "destructive" : "secondary"} className="capitalize">
          {String(b.status).replace("_", " ")}
        </Badge>
      </div>
      {!locked && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost"
            disabled={cancelMut.isPending}
            onClick={() => { if (confirm("Cancel this booking?")) cancelMut.mutate(); }}>
            {cancelMut.isPending ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      )}
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
