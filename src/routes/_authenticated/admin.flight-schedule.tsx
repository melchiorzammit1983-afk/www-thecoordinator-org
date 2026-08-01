import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, CalendarDays, FileText, History, Layers3, RotateCcw, Search } from "lucide-react";
import { ImportPreviewWorkflow } from "@/components/import-engine/ImportPreviewWorkflow";
import {
  activateFlightScheduleDraft,
  compareFlightScheduleVersions,
  createFlightScheduleDraft,
  getFlightScheduleOverview,
  searchFlightScheduleRecords,
  type FlightScheduleComparisonResult,
  type FlightScheduleImportSession,
  type FlightScheduleSearchRecord,
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
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [leftComparisonId, setLeftComparisonId] = useState("");
  const [rightComparisonId, setRightComparisonId] = useState("");
  const overviewFn = useServerFn(getFlightScheduleOverview);
  const createDraftFn = useServerFn(createFlightScheduleDraft);
  const activateDraftFn = useServerFn(activateFlightScheduleDraft);
  const compareVersionsFn = useServerFn(compareFlightScheduleVersions);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["flight-schedule-overview"],
    queryFn: () => overviewFn(),
  });
  const activation = useMutation({
    mutationFn: (scheduleVersionId: string) => activateDraftFn({ data: { scheduleVersionId } }),
    onSuccess: () => refetch(),
  });
  const comparison = useMutation({
    mutationFn: () =>
      compareVersionsFn({
        data: { leftVersionId: leftComparisonId, rightVersionId: rightComparisonId },
      }),
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

      <ScheduleComparisonCard
        versions={versions}
        leftVersionId={leftComparisonId}
        rightVersionId={rightComparisonId}
        onLeftVersionChange={setLeftComparisonId}
        onRightVersionChange={setRightComparisonId}
        onCompare={() => comparison.mutate()}
        isComparing={comparison.isPending}
        error={comparison.error}
        result={comparison.data}
      />

      <FlightSearchCard versions={versions} />

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

type FlightSearchFilters = {
  search?: string;
  versionId?: string;
  status?: "active" | "draft" | "archived";
  direction?: "arrival" | "departure";
  date?: string;
  airline?: string;
  sortBy: "time" | "flightNumber" | "airline" | "date";
  sortDirection: "asc" | "desc";
  page: number;
  pageSize: number;
};

const initialFlightSearchFilters: FlightSearchFilters = {
  sortBy: "date",
  sortDirection: "asc",
  page: 0,
  pageSize: 50,
};

function FlightSearchCard({ versions }: { versions: FlightScheduleVersion[] }) {
  const searchFlightsFn = useServerFn(searchFlightScheduleRecords);
  const [filters, setFilters] = useState<FlightSearchFilters>(initialFlightSearchFilters);
  const [appliedFilters, setAppliedFilters] = useState<FlightSearchFilters>();
  const { data, error, isFetching } = useQuery({
    queryKey: ["flight-schedule-search", appliedFilters],
    queryFn: () => searchFlightsFn({ data: appliedFilters! }),
    enabled: Boolean(appliedFilters),
  });
  const update = <K extends keyof FlightSearchFilters>(key: K, value: FlightSearchFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const apply = () => setAppliedFilters({ ...filters, page: 0 });
  const reset = () => {
    setFilters(initialFlightSearchFilters);
    setAppliedFilters(undefined);
  };
  const changePage = (page: number) =>
    setAppliedFilters((current) => (current ? { ...current, page } : current));

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <Search className="h-5 w-5 text-primary mt-0.5" />
        <div>
          <CardTitle>Search Schedule Flights</CardTitle>
          <CardDescription>
            Read-only operational search across imported schedule versions.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <SearchField label="Search flight, airline, or airport">
            <Input
              value={filters.search ?? ""}
              placeholder="KM 515, Ryanair, MLA..."
              onChange={(event) => update("search", event.target.value || undefined)}
            />
          </SearchField>
          <SearchField label="Schedule version">
            <Select
              value={filters.versionId ?? "__all"}
              onValueChange={(value) => update("versionId", value === "__all" ? undefined : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All versions</SelectItem>
                {versions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    {version.name} ({version.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SearchField>
          <SearchField label="Status">
            <Select
              value={filters.status ?? "__all"}
              onValueChange={(value) =>
                update(
                  "status",
                  value === "__all" ? undefined : (value as FlightSearchFilters["status"]),
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </SearchField>
          <SearchField label="Direction">
            <Select
              value={filters.direction ?? "__all"}
              onValueChange={(value) =>
                update(
                  "direction",
                  value === "__all" ? undefined : (value as FlightSearchFilters["direction"]),
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Arrivals and departures</SelectItem>
                <SelectItem value="arrival">Arrival</SelectItem>
                <SelectItem value="departure">Departure</SelectItem>
              </SelectContent>
            </Select>
          </SearchField>
          <SearchField label="Date">
            <Input
              type="date"
              value={filters.date ?? ""}
              onChange={(event) => update("date", event.target.value || undefined)}
            />
          </SearchField>
          <SearchField label="Airline filter">
            <Input
              value={filters.airline ?? ""}
              placeholder="Airline name"
              onChange={(event) => update("airline", event.target.value || undefined)}
            />
          </SearchField>
          <SearchField label="Sort by">
            <Select
              value={filters.sortBy}
              onValueChange={(value) => update("sortBy", value as FlightSearchFilters["sortBy"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="time">Flight time</SelectItem>
                <SelectItem value="flightNumber">Flight number</SelectItem>
                <SelectItem value="airline">Airline</SelectItem>
              </SelectContent>
            </Select>
          </SearchField>
          <SearchField label="Order">
            <Select
              value={filters.sortDirection}
              onValueChange={(value) =>
                update("sortDirection", value as FlightSearchFilters["sortDirection"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">Ascending</SelectItem>
                <SelectItem value="desc">Descending</SelectItem>
              </SelectContent>
            </Select>
          </SearchField>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={apply} disabled={isFetching}>
            <Search /> {isFetching ? "Searching..." : "Search flights"}
          </Button>
          <Button type="button" variant="outline" onClick={reset} disabled={isFetching}>
            <RotateCcw /> Reset
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-destructive">
            {error.message || "Search could not be loaded."}
          </p>
        ) : null}
        {data ? <FlightSearchResults result={data} onPageChange={changePage} /> : null}
      </CardContent>
    </Card>
  );
}

function SearchField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function FlightSearchResults({
  result,
  onPageChange,
}: {
  result: { records: FlightScheduleSearchRecord[]; total: number; page: number; pageSize: number };
  onPageChange: (page: number) => void;
}) {
  const showingFrom = result.total ? result.page * result.pageSize + 1 : 0;
  const showingTo = Math.min((result.page + 1) * result.pageSize, result.total);
  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-sm text-muted-foreground">
        {result.total
          ? `Showing ${showingFrom}-${showingTo} of ${result.total} flights.`
          : "No flights match these filters."}
      </p>
      {result.records.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Flight Number</TableHead>
              <TableHead>Airline</TableHead>
              <TableHead>Origin</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Scheduled Time</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Schedule Version</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.records.map((record) => (
              <TableRow key={record.id}>
                <TableCell className="font-medium">{record.flightNumber}</TableCell>
                <TableCell>{record.airline}</TableCell>
                <TableCell>{record.origin}</TableCell>
                <TableCell>{record.destination}</TableCell>
                <TableCell>{record.scheduledTime}</TableCell>
                <TableCell className="capitalize">{record.direction}</TableCell>
                <TableCell>{record.scheduledDate}</TableCell>
                <TableCell>{record.scheduleVersion.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="capitalize">
                    {record.scheduleVersion.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {result.total > result.pageSize ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(result.page - 1)}
            disabled={result.page === 0}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {result.page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(result.page + 1)}
            disabled={showingTo >= result.total}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ScheduleComparisonCard({
  versions,
  leftVersionId,
  rightVersionId,
  onLeftVersionChange,
  onRightVersionChange,
  onCompare,
  isComparing,
  error,
  result,
}: {
  versions: FlightScheduleVersion[];
  leftVersionId: string;
  rightVersionId: string;
  onLeftVersionChange: (value: string) => void;
  onRightVersionChange: (value: string) => void;
  onCompare: () => void;
  isComparing: boolean;
  error: Error | null;
  result?: FlightScheduleComparisonResult;
}) {
  const canCompare = Boolean(leftVersionId && rightVersionId && leftVersionId !== rightVersionId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare Schedule Versions</CardTitle>
        <CardDescription>
          Read-only comparison of two immutable schedules before an operational decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <VersionSelect
            label="First version"
            value={leftVersionId}
            versions={versions}
            onChange={onLeftVersionChange}
          />
          <VersionSelect
            label="Second version"
            value={rightVersionId}
            versions={versions}
            onChange={onRightVersionChange}
          />
          <Button type="button" disabled={!canCompare || isComparing} onClick={onCompare}>
            {isComparing ? "Comparing..." : "Compare"}
          </Button>
        </div>
        {leftVersionId === rightVersionId && leftVersionId ? (
          <p className="text-sm text-destructive">Choose two different schedule versions.</p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive">
            {error.message || "Comparison could not be loaded."}
          </p>
        ) : null}
        {result ? <ComparisonResult result={result} /> : null}
      </CardContent>
    </Card>
  );
}

function VersionSelect({
  label,
  value,
  versions,
  onChange,
}: {
  label: string;
  value: string;
  versions: FlightScheduleVersion[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <Select
        value={value || "__none"}
        onValueChange={(next) => onChange(next === "__none" ? "" : next)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Choose a schedule" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Choose a schedule</SelectItem>
          {versions.map((version) => (
            <SelectItem key={version.id} value={version.id}>
              {version.name} ({version.status})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function ComparisonResult({ result }: { result: FlightScheduleComparisonResult }) {
  const { comparison } = result;
  return (
    <div className="space-y-4 border-t pt-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label="Flights Added" value={comparison.added.length} icon={FileText} />
        <SummaryCard label="Flights Removed" value={comparison.removed.length} icon={Archive} />
        <SummaryCard label="Time Changes" value={comparison.timeChanges.length} icon={History} />
        <SummaryCard
          label="Airline Changes"
          value={comparison.airlineChanges.length}
          icon={Layers3}
        />
        <SummaryCard
          label="Route Changes"
          value={comparison.routeChanges.length}
          icon={CalendarDays}
        />
      </div>
      <div className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
        <div>
          <p className="font-medium">First: {result.left.name}</p>
          <p className="text-muted-foreground">
            {result.left.flightCount} flights - {formatDate(result.leftImport?.created_at)} -{" "}
            {result.leftImport?.created_by ?? result.left.created_by ?? "Unknown"}
          </p>
        </div>
        <div>
          <p className="font-medium">Second: {result.right.name}</p>
          <p className="text-muted-foreground">
            {result.right.flightCount} flights - {formatDate(result.rightImport?.created_at)} -{" "}
            {result.rightImport?.created_by ?? result.right.created_by ?? "Unknown"}
          </p>
        </div>
      </div>
      <Accordion type="multiple" className="w-full">
        <ChangeList title="Flights Added" value="added" count={comparison.added.length}>
          {comparison.added.map((flight) => `+ ${flightLabel(flight)}`)}
        </ChangeList>
        <ChangeList title="Flights Removed" value="removed" count={comparison.removed.length}>
          {comparison.removed.map((flight) => `- ${flightLabel(flight)}`)}
        </ChangeList>
        <ChangeList title="Flight Time Changes" value="time" count={comparison.timeChanges.length}>
          {comparison.timeChanges.map(
            (change) => `${flightLabel(change.flight)}: ${change.before} to ${change.after}`,
          )}
        </ChangeList>
        <ChangeList
          title="Airline Changes"
          value="airline"
          count={comparison.airlineChanges.length}
        >
          {comparison.airlineChanges.map(
            (change) => `${flightLabel(change.flight)}: ${change.before} to ${change.after}`,
          )}
        </ChangeList>
        <ChangeList
          title="Origin/Destination Changes"
          value="route"
          count={comparison.routeChanges.length}
        >
          {comparison.routeChanges.map(
            (change) =>
              `${flightLabel(change.flight)}: ${change.before.origin}-${change.before.destination} to ${change.after.origin}-${change.after.destination}`,
          )}
        </ChangeList>
      </Accordion>
    </div>
  );
}

function ChangeList({
  title,
  value,
  count,
  children,
}: {
  title: string;
  value: string;
  count: number;
  children: string[];
}) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger>
        {title} ({count})
      </AccordionTrigger>
      <AccordionContent>
        {children.length ? (
          <ul className="space-y-1 font-mono text-xs">
            {children.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No changes in this category.</p>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function flightLabel(flight: { flightNumber: string; scheduledDate: string; direction: string }) {
  return `${flight.flightNumber} - ${flight.scheduledDate} ${flight.direction}`;
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
