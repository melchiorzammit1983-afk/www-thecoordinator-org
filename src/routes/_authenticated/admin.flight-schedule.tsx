import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, History } from "lucide-react";
import { ImportPreviewWorkflow } from "@/components/import-engine/ImportPreviewWorkflow";
import {
  createFlightScheduleDraft,
  getFlightScheduleOverview,
} from "@/lib/flight-schedule.functions";
import {
  flightScheduleImportFields,
  flightScheduleValidationRules,
} from "@/lib/flight-schedule-import";
import { spreadsheetFlightScheduleAdapter } from "@/lib/flight-schedule-sources/spreadsheet.adapter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/flight-schedule")({
  head: () => ({ meta: [{ title: "Flight Schedule — Admin" }] }),
  component: FlightSchedulePage,
});

function FlightSchedulePage() {
  const overviewFn = useServerFn(getFlightScheduleOverview);
  const createDraftFn = useServerFn(createFlightScheduleDraft);
  const { data, isLoading, refetch } = useQuery({
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

      <ImportPreviewWorkflow
        sourceAdapter={spreadsheetFlightScheduleAdapter}
        fields={flightScheduleImportFields}
        rules={flightScheduleValidationRules}
        onConfirm={async ({ source, rows, summary }) => {
          await createDraftFn({
            data: {
              sourceFilename: source.fileName,
              sourceType: "spreadsheet",
              summary,
              records: rows.map((row) => ({
                rowNumber: row.rowNumber,
                flightNumber: row.values.flightNumber,
                date: row.values.date,
                direction: row.values.direction as "Arrival" | "Departure",
                scheduledTime: row.values.scheduledTime,
                airline: row.values.airline,
                origin: row.values.origin,
                destination: row.values.destination,
              })),
            },
          });
          await refetch();
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Draft Imports</CardTitle>
          <CardDescription>
            Immutable schedule drafts. Activation and editing are intentionally unavailable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data?.drafts.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Import date</TableHead>
                  <TableHead>Imported by</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Flights</TableHead>
                  <TableHead>Validation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.drafts.map((draft) => {
                  const session = data.imports.find((item) => item.schedule_version_id === draft.id);
                  return (
                    <TableRow key={draft.id}>
                      <TableCell className="font-medium">{draft.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">Draft</Badge>
                      </TableCell>
                      <TableCell>{new Date(draft.created_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{draft.created_by ?? "Unknown"}</TableCell>
                      <TableCell>{session?.source_filename ?? "Unknown"}</TableCell>
                      <TableCell>{session?.total_rows ?? 0}</TableCell>
                      <TableCell>
                        {session
                          ? `${session.valid_rows} valid, ${session.warning_rows} warning, ${session.error_rows} error`
                          : "Unavailable"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No draft imports yet.</p>
          )}
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
