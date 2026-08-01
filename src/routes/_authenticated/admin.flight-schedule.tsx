import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, FileUp, History } from "lucide-react";
import { getFlightScheduleOverview } from "@/lib/flight-schedule.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/flight-schedule")({
  head: () => ({ meta: [{ title: "Flight Schedule — Admin" }] }),
  component: FlightSchedulePage,
});

function FlightSchedulePage() {
  const overviewFn = useServerFn(getFlightScheduleOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["flight-schedule-overview"],
    queryFn: () => overviewFn(),
  });
  const active = data?.active;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Flight Schedule</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Admin-managed schedule versions for future flight validation.
        </p>
      </header>

      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <CalendarDays className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <CardTitle>Active Schedule</CardTitle>
            <CardDescription>Only one schedule version will be active at a time.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="text-sm">
          {isLoading ? (
            "Loading…"
          ) : active ? (
            <div className="flex items-center gap-2">
              <span>{active.name}</span>
              <Badge>Active</Badge>
            </div>
          ) : (
            <span className="text-muted-foreground">No active schedule yet.</span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <FileUp className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <CardTitle>Upload Schedule</CardTitle>
            <CardDescription>
              CSV and Excel upload, mapping, validation, and preview will be added in Milestones
              2–5.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The import foundation is ready; no files can be uploaded in this milestone.
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <History className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <CardTitle>Import History</CardTitle>
            <CardDescription>Future imports will be versioned and auditable.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {data?.imports.length
            ? `${data.imports.length} historical import records.`
            : "No imports yet."}
        </CardContent>
      </Card>
    </div>
  );
}
