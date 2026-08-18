import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listOperationGroups, type OperationGroup } from "@/lib/operation-groups.functions";
import { normaliseOperationGroupColour, operationGroupColourClasses, operationGroupColourDotClasses } from "@/lib/operation-group-colours";

export const Route = createFileRoute("/_authenticated/coordinator/planning")({
  head: () => ({ meta: [{ title: "Operations Planning — Coordinator" }] }),
  component: OperationsPlanningPage,
});

type PlanningFilter = "all" | "draft" | "awaiting_client" | "awaiting_coordinator" | "confirmed";

function displayStatus(status: OperationGroup["status"]): string {
  return status === "active" ? "Confirmed" : "Draft";
}

function OperationsPlanningPage() {
  const listFn = useServerFn(listOperationGroups);
  const [filter, setFilter] = useState<PlanningFilter>("all");
  const query = useQuery({ queryKey: ["operation-planning-groups"], queryFn: () => listFn() as Promise<OperationGroup[]> });
  const groups = useMemo(() => {
    const all = query.data ?? [];
    return all.filter((group) => {
      if (filter === "all") return ["draft", "active"].includes(group.status);
      if (filter === "draft") return group.status === "draft";
      if (filter === "confirmed") return group.status === "active";
      // These are reserved for the shared confirmation workflow. Until that
      // workflow stores a separate status, they intentionally remain empty.
      return false;
    });
  }, [filter, query.data]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /><h1 className="text-xl font-semibold sm:text-2xl">Operations Planning</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">Draft operations stay here until approved. They never appear as live Dispatch trips.</p>
        </div>
        <Link className="text-sm text-primary underline" to="/coordinator/operation-groups">Manage Operation Groups</Link>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Filter className="h-4 w-4" />Planning view</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(["all", "draft", "awaiting_client", "awaiting_coordinator", "confirmed"] as const).map((value) => (
            <button key={value} type="button" className={`rounded-md border px-3 py-2 text-sm ${filter === value ? "border-primary bg-primary/10 font-medium" : "bg-background"}`} onClick={() => setFilter(value)}>
              {value === "all" ? "All" : value === "awaiting_client" ? "Awaiting Client" : value === "awaiting_coordinator" ? "Awaiting Coordinator" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </CardContent>
      </Card>
      {query.isLoading && <p className="text-sm text-muted-foreground">Loading planning operations…</p>}
      {query.error && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Could not load planning operations.</p>}
      {!query.isLoading && !query.error && groups.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No operations in this planning view.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          const colour = normaliseOperationGroupColour(group.colour);
          return <Link key={group.id} to="/coordinator/operation-groups" className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-primary">
            <Card className={`h-full transition-shadow hover:shadow-md ${operationGroupColourClasses[colour]}`}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${operationGroupColourDotClasses[colour]}`} /><span className="truncate font-semibold">{group.reference} · {group.name}</span></div><p className="mt-1 text-xs text-muted-foreground">{group.type.replaceAll("_", " ")}</p></div><Badge variant="outline">{displayStatus(group.status)}</Badge></div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground"><span>Start: {group.start_date ?? "—"}</span><span>End: {group.end_date ?? "—"}</span></div>
                <p className="text-xs font-medium text-primary">Open shared Operation workspace →</p>
              </CardContent>
            </Card>
          </Link>;
        })}
      </div>
    </div>
  );
}
