import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, CalendarDays, FileText, History, Layers3 } from "lucide-react";
import { ImportPreviewWorkflow } from "@/components/import-engine/ImportPreviewWorkflow";
import {
  activateFlightScheduleDraft,
  createFlightScheduleDraft,
  getFlightScheduleOverview,
  type FlightScheduleImportSession,
  type FlightScheduleVersion,
} from "@/lib/flight-schedule.functions";
import {
  flightScheduleImportFields,
  flightScheduleValidationRules,
} from "@/lib/flight-schedule-import";
import { spreadsheetFlightScheduleAdapter } from "@/lib/flight-schedule-sources/spreadsheet.adapter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/flight-schedule")({
  head: () => ({ meta: [{ title: "Flight Schedule - Admin" }] }),
  component: FlightSchedulePage,
});

function FlightSchedulePage() {
  const [selectedVersion, setSelectedVersion] = useState<FlightScheduleVersion>();
  const overviewFn = useServerFn(getFlightScheduleOverview);
  const createDraftFn = useServerFn(createFlightScheduleDraft);
  const activateDraftFn = useServerFn(activateFlightScheduleDraft);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["flight-schedule-overview"],
    queryFn: () => overviewFn(),
  });
  const activation = useMutation({
    mutationFn: (scheduleVersionId: string) => activateDraftFn({ data: { scheduleVersionId } }),
    onSuccess: () => refetch(),
  });
  const active = data?.active;
  const activeSession = active ? sessionFor(active, data?.imports ?? []) : undefined;
  const versions = [active, ...(data?.drafts ?? []), ...(data?.archived ?? [])].filter(
    (version): version is FlightScheduleVersion => Boolean(version),
  );

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Flight Schedule</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Admin-managed schedule versions for future flight validation.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label="Schedule Versions" value={versions.length} icon={Layers3} />
        <SummaryCard label="Active Schedule" value={active ? "1" : "0"} icon={CalendarDays} />
        <SummaryCard label="Draft Schedules" value={data?.drafts.length ?? 0} icon={FileText} />
        <SummaryCard label="Archived Schedules" value={data?.archived.length ?? 0} icon={Archive} />
        <SummaryCard label="Active Flights" value={active?.flightCount ?? 0} icon={History} />
      </section>

      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <CalendarDays className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <CardTitle>Current Active Schedule</CardTitle>
            <CardDescription>Only one schedule version can be active at a time.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="text-sm">
          {isLoading ? (
            "Loading..."
          ) : active ? (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{active.name}</span>
                  <Badge>Active</Badge>
                </div>
                <p className="text-muted-foreground">
                  Active since {formatDate(active.activated_at ?? active.created_at)} - Activated by{" "}
                  <span className="font-mono text-xs">
                    {active.activated_by ?? active.created_by ?? "Unknown"}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {active.flightCount} flights in this schedule.
                </p>
                <p className="text-muted-foreground">
                  Source {activeSession?.source_filename ?? "Unavailable"} - Imported{" "}
                  {formatDate(activeSession?.created_at)}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedVersion(active)}>
                View details
              </Button>
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
          <CardTitle>Draft Schedules</CardTitle>
          <CardDescription>
            Immutable drafts. Activating a draft archives the current active schedule.
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
                  <TableHead>Flights</TableHead>
                  <TableHead>Validation</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.drafts.map((draft: FlightScheduleVersion) => {
                  const session = sessionFor(draft, data.imports);
                  return (
                    <TableRow key={draft.id}>
                      <TableCell className="font-medium">{draft.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">Draft</Badge>
                      </TableCell>
                      <TableCell>{formatDate(session?.created_at ?? draft.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {session?.created_by ?? draft.created_by ?? "Unknown"}
                      </TableCell>
                      <TableCell>{draft.flightCount}</TableCell>
                      <TableCell>{validationSummary(session)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedVersion(draft)}
                          >
                            View details
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => activation.mutate(draft.id)}
                            disabled={activation.isPending}
                          >
                            {activation.isPending ? "Activating..." : "Activate"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No draft schedules yet.</p>
          )}
          {activation.isError ? (
            <p className="mt-4 text-sm text-destructive">
              {activation.error instanceof Error
                ? activation.error.message
                : "Schedule activation failed."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Archived Schedules</CardTitle>
          <CardDescription>Archived schedules are preserved as read-only history.</CardDescription>
        </CardHeader>
        <CardContent>
          {data?.archived.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Archived date</TableHead>
                  <TableHead>Flights</TableHead>
                  <TableHead>Imported by</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.archived.map((version: FlightScheduleVersion) => {
                  const session = sessionFor(version, data.imports);
                  return (
                    <TableRow key={version.id}>
                      <TableCell className="font-medium">{version.name}</TableCell>
                      <TableCell>{formatDate(version.updated_at)}</TableCell>
                      <TableCell>{version.flightCount}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {session?.created_by ?? version.created_by ?? "Unknown"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedVersion(version)}
                        >
                          View details
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No archived schedules yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <History className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <CardTitle>Import History</CardTitle>
            <CardDescription>
              Schedule import sessions remain auditable and read-only.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {data?.imports.length
            ? `${data.imports.length} historical import records.`
            : "No imports yet."}
        </CardContent>
      </Card>

      <ScheduleDetailsDialog
        version={selectedVersion}
        session={selectedVersion ? sessionFor(selectedVersion, data?.imports ?? []) : undefined}
        onClose={() => setSelectedVersion(undefined)}
      />
    </div>
  );
}

function ScheduleDetailsDialog({
  version,
  session,
  onClose,
}: {
  version?: FlightScheduleVersion;
  session?: FlightScheduleImportSession;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(version)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{version?.name ?? "Schedule details"}</DialogTitle>
          <DialogDescription>Read-only version and import metadata.</DialogDescription>
        </DialogHeader>
        {version ? (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Detail label="Status" value={version.status} />
            <Detail label="Flights" value={version.flightCount} />
            <Detail label="Created" value={formatDate(version.created_at)} />
            <Detail label="Created by" value={version.created_by ?? "Unknown"} mono />
            <Detail label="Import source" value={session?.source_filename ?? "Unavailable"} />
            <Detail label="Import date" value={formatDate(session?.created_at)} />
            <Detail label="Validation" value={validationSummary(session)} />
            <Detail label="Coverage" value={coverageLabel(version)} />
            {version.activated_at ? (
              <>
                <Detail label="Activated" value={formatDate(version.activated_at)} />
                <Detail label="Activated by" value={version.activated_by ?? "Unknown"} mono />
              </>
            ) : null}
            {version.status === "archived" ? (
              <Detail label="Archived" value={formatDate(version.updated_at)} />
            ) : null}
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: typeof CalendarDays;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4 text-primary" />
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: number | string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-1 font-mono text-xs break-all" : "mt-1"}>{value}</dd>
    </div>
  );
}

function sessionFor(version: FlightScheduleVersion, sessions: FlightScheduleImportSession[]) {
  return sessions.find((session) => session.schedule_version_id === version.id);
}

function validationSummary(session?: FlightScheduleImportSession) {
  if (!session) return "Unavailable";
  return `${session.valid_rows} valid, ${session.warning_rows} warning, ${session.error_rows} error`;
}

function coverageLabel(version: FlightScheduleVersion) {
  if (!version.coverage_start && !version.coverage_end) return "Unavailable";
  return `${version.coverage_start ?? "Unknown"} to ${version.coverage_end ?? "Unknown"}`;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Unavailable";
}
