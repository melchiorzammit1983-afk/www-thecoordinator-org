import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listPendingCoordChangesForDriver,
  decideCoordChangeRequest,
} from "@/lib/coordinator-public.functions";

type ReqRow = {
  id: string;
  job_id: string;
  kind: "edit" | "reassign" | "cancel" | "delete";
  requested_changes: Record<string, unknown>;
  note: string | null;
  created_at: string;
  job: {
    from_location: string | null;
    to_location: string | null;
    date: string | null;
    time: string | null;
    pickup_display_name: string | null;
    dropoff_display_name: string | null;
  } | null;
};

const KIND_LABEL: Record<ReqRow["kind"], string> = {
  edit: "Trip changes",
  reassign: "Driver reassignment",
  cancel: "Cancel trip",
  delete: "Delete trip",
};

function summarize(kind: ReqRow["kind"], c: Record<string, unknown>): string[] {
  if (kind === "cancel") return ["Mark this trip as cancelled."];
  if (kind === "delete") return ["Remove this trip from your list."];
  if (kind === "reassign") return ["Move this trip to a different driver."];
  const out: string[] = [];
  const map: Record<string, string> = {
    from_location: "Pickup",
    to_location: "Drop-off",
    date: "Date",
    time: "Time",
    vehicle: "Vehicle",
    contact_phone: "Contact phone",
    from_flight: "From flight",
    to_flight: "To flight",
    clientcompanyname: "Client company",
    pickup_display_name: "Pickup name",
    dropoff_display_name: "Drop-off name",
  };
  for (const [k, v] of Object.entries(c)) {
    if (map[k]) out.push(`${map[k]}: ${v ? String(v) : "—"}`);
  }
  return out.length ? out : ["Update trip details."];
}

export function CoordChangeRequestsPanel({ token }: { token: string }) {
  const listFn = useServerFn(listPendingCoordChangesForDriver);
  const decideFn = useServerFn(decideCoordChangeRequest);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["driver-coord-change-requests", token],
    queryFn: () => listFn({ data: { token } }),
    refetchInterval: 20_000,
  });

  const decide = useMutation({
    mutationFn: (v: { request_id: string; approve: boolean }) =>
      decideFn({ data: { token, ...v } }),
    onSuccess: (_r, v) => {
      toast.success(v.approve ? "Change approved" : "Change rejected");
      qc.invalidateQueries({ queryKey: ["driver-coord-change-requests", token] });
      qc.invalidateQueries({ queryKey: ["driver-manifest"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requests = (data?.requests ?? []) as ReqRow[];
  if (requests.length === 0) return null;

  return (
    <div className="mx-3 mt-3 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <AlertCircle className="h-4 w-4" />
        Coordinator requests waiting for your approval ({requests.length})
      </div>
      {requests.map((r) => {
        const trip = r.job;
        const from = trip?.pickup_display_name || trip?.from_location || "—";
        const to = trip?.dropoff_display_name || trip?.to_location || "—";
        return (
          <div key={r.id} className="rounded-md border bg-background p-2.5 text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="text-[10px]">{KIND_LABEL[r.kind]}</Badge>
              <span className="text-[10px] text-muted-foreground">
                {trip?.time?.slice(0, 5) ?? ""} · {trip?.date ?? ""}
              </span>
            </div>
            <div className="truncate">
              <span className="font-medium">{from}</span> → <span className="font-medium">{to}</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              {summarize(r.kind, r.requested_changes).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            {r.note && <div className="italic text-muted-foreground">Note: {r.note}</div>}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ request_id: r.id, approve: true })}
              >
                <Check className="h-3 w-3 mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ request_id: r.id, approve: false })}
              >
                <X className="h-3 w-3 mr-1" /> Reject
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
