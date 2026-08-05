import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Anchor, CalendarClock, Plane, RefreshCw, Route as RouteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { completeShipEtaReview, completeTransportConflictReview, getOperationsInbox, listJobs } from "@/lib/coordinator.functions";
import { listOperationGroups, getOperationGroup } from "@/lib/operation-groups.functions";
import { normaliseOperationGroupColour, operationGroupColourClasses, operationGroupColourDotClasses } from "@/lib/operation-group-colours";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/coordinator/operations")({
  head: () => ({ meta: [{ title: "Operations Centre — Coordinator" }] }),
  component: OperationsCentrePage,
});

function OperationsCentrePage() {
  const inboxFn = useServerFn(getOperationsInbox);
  const completeShipEtaReviewFn = useServerFn(completeShipEtaReview);
  const completeTransportConflictReviewFn = useServerFn(completeTransportConflictReview);
  const jobsFn = useServerFn(listJobs);
  const groupsFn = useServerFn(listOperationGroups);
  const groupDetailFn = useServerFn(getOperationGroup);
  const [groupFilter, setGroupFilter] = useState<"all" | "grouped" | "ungrouped">("all");
  const [groupSearch, setGroupSearch] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["operations-inbox"],
    queryFn: () => inboxFn(),
    refetchInterval: 60_000,
  });
  const jobsQuery = useQuery({ queryKey: ["operations-jobs"], queryFn: () => jobsFn({ data: {} }) as Promise<any[]> });
  const groupsQuery = useQuery({ queryKey: ["operations-groups"], queryFn: () => groupsFn() });
  const selectedGroupQuery = useQuery({ queryKey: ["operations-group", selectedGroupId], queryFn: () => groupDetailFn({ data: { id: selectedGroupId! } }), enabled: !!selectedGroupId });
  const filteredJobs = useMemo(() => {
    const term = groupSearch.trim().toLowerCase();
    return (jobsQuery.data ?? []).filter((job: any) => {
      const grouped = Boolean(job.operation_group_id);
      const group = job.operation_groups;
      const matchesFilter = groupFilter === "all" || (groupFilter === "grouped" ? grouped : !grouped);
      const matchesSearch = !term || `${group?.reference ?? ""} ${group?.name ?? ""}`.toLowerCase().includes(term);
      return matchesFilter && matchesSearch;
    });
  }, [groupFilter, groupSearch, jobsQuery.data]);
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Operation Groups</CardTitle>
          <CardDescription>Work grouped explicitly by the coordinator. Existing ordering and calculations are unchanged.</CardDescription>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <input className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search group reference or name" />
            <div className="flex flex-wrap gap-2">
              {(["all", "grouped", "ungrouped"] as const).map((value) => <Button key={value} type="button" size="sm" variant={groupFilter === value ? "default" : "outline"} onClick={() => setGroupFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</Button>)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {jobsQuery.isLoading || groupsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading grouped work…</p> : filteredJobs.length === 0 ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No matching grouped work.</p> : filteredJobs.map((job: any) => {
            const group = job.operation_groups;
            return <div key={job.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><p className="truncate text-sm">{job.from_location} → {job.to_location}</p><p className="text-xs text-muted-foreground">{job.date} {String(job.time ?? "").slice(0, 5)} · {job.status ?? "scheduled"}</p></div>
              {group ? <Link className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:opacity-90 ${operationGroupColourClasses[normaliseOperationGroupColour(group.colour)]}`} to="/coordinator/operation-groups" onClick={() => setSelectedGroupId(job.operation_group_id)}><span className={`h-2 w-2 rounded-full ${operationGroupColourDotClasses[normaliseOperationGroupColour(group.colour)]}`} />{group.reference} · {group.name}</Link> : <span className="text-xs text-muted-foreground">Ungrouped</span>}
            </div>;
          })}
        </CardContent>
      </Card>
      {groupsQuery.data?.length ? <div className="grid gap-3 md:grid-cols-2">
        {groupsQuery.data.map((group) => {
          const jobs = (jobsQuery.data ?? []).filter((job: any) => job.operation_group_id === group.id);
          const detail = selectedGroupQuery.data?.id === group.id ? selectedGroupQuery.data : null;
          return <Card key={group.id}>
            <CardHeader className="pb-2"><CardTitle className="flex items-center justify-between gap-2 text-base"><span className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${operationGroupColourDotClasses[normaliseOperationGroupColour(group.colour)]}`} />{group.reference} · {group.name}</span><Badge variant="outline">{group.status}</Badge></CardTitle><CardDescription>{group.type.replaceAll("_", " ")}</CardDescription></CardHeader>
            <CardContent className="space-y-2 text-sm"><div className="grid grid-cols-2 gap-2"><Summary label="Jobs" value={jobs.length} /><Summary label="Trips" value={jobs.length} /></div>{detail ? <><p className="text-xs text-muted-foreground">Ships: {detail.ship_events?.map((item: any) => item.ship_events?.ship_name).filter(Boolean).join(", ") || "None"}</p><p className="text-xs text-muted-foreground">Flights: {detail.flight_records?.map((item: any) => item.flight_schedule_records?.flight_number).filter(Boolean).join(", ") || "None"}</p></> : null}<Button asChild type="button" size="sm" variant="outline" onClick={() => setSelectedGroupId(group.id)}><Link to="/coordinator/operation-groups">Open Operation Group</Link></Button></CardContent>
          </Card>;
        })}
      </div> : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) { return <div className="rounded-md bg-muted/30 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></div>; }

function InboxIcon({ type }: { type: string }) {
  const Icon = type.startsWith("Flight") ? Plane : type.startsWith("Ship") ? Anchor : type.startsWith("Draft") ? CalendarClock : RouteIcon;
  return <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>;
}

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  const variant = priority === "high" ? "destructive" : priority === "medium" ? "secondary" : "outline";
  return <Badge variant={variant} className="capitalize">{priority}</Badge>;
}
