import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Anchor, CalendarClock, Plane, RefreshCw, Route as RouteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { completeShipEtaReview, completeTransportConflictReview, getOperationsInbox } from "@/lib/coordinator.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/coordinator/operations")({
  head: () => ({ meta: [{ title: "Operations Centre — Coordinator" }] }),
  component: OperationsCentrePage,
});

function OperationsCentrePage() {
  const inboxFn = useServerFn(getOperationsInbox);
  const completeShipEtaReviewFn = useServerFn(completeShipEtaReview);
  const completeTransportConflictReviewFn = useServerFn(completeTransportConflictReview);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["operations-inbox"],
    queryFn: () => inboxFn(),
    refetchInterval: 60_000,
  });
  const completeReview = useMutation({
    mutationFn: ({ kind, id }: { kind: "ship_eta" | "transport_conflict"; id: string }) => kind === "ship_eta"
      ? completeShipEtaReviewFn({ data: { eta_history_id: id } })
      : completeTransportConflictReviewFn({ data: { job_id: id } }),
    onSuccess: (result) => {
      toast.success(result.alreadyCompleted ? "This review was already completed." : "Review marked complete.");
      refetch();
    },
    onError: (reason: Error) => toast.error(reason.message || "Ship ETA review could not be completed."),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Operations Centre</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A read-only view of operational items that need coordinator attention.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-4 w-4 text-primary" /> Operations Inbox
          </CardTitle>
          <CardDescription>
            {data ? `${data.total} item${data.total === 1 ? "" : "s"} requiring attention.` : "Verified current operational data only."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
              <span>{error.message || "Operations Inbox could not be loaded."}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : isLoading ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Loading Operations Inbox…
            </div>
          ) : data?.items.length ? (
            <div className="space-y-2">
              {data.items.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <InboxIcon type={item.type} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.type}</span>
                        <PriorityBadge priority={item.priority} />
                      </div>
                      <p className="mt-1 truncate text-sm text-foreground">{item.transport}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    <span className="text-xs text-muted-foreground">
                      {item.affectedTrips} affected trip{item.affectedTrips === 1 ? "" : "s"}
                    </span>
                    {item.reviewKind && item.reviewTargetId ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button asChild type="button" variant="outline" size="sm">
                          <Link to={item.href}>{item.action}</Link>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => completeReview.mutate({ kind: item.reviewKind, id: item.reviewTargetId })}
                          disabled={completeReview.isPending}
                        >
                          {completeReview.isPending ? "Markingâ€¦" : "Mark Review Complete"}
                        </Button>
                      </div>
                    ) : (
                      <Button asChild type="button" variant="outline" size="sm">
                        <Link to={item.href}>{item.action}</Link>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No operational items need attention right now.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InboxIcon({ type }: { type: string }) {
  const Icon = type.startsWith("Flight") ? Plane : type.startsWith("Ship") ? Anchor : type.startsWith("Draft") ? CalendarClock : RouteIcon;
  return <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>;
}

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  const variant = priority === "high" ? "destructive" : priority === "medium" ? "secondary" : "outline";
  return <Badge variant={variant} className="capitalize">{priority}</Badge>;
}
