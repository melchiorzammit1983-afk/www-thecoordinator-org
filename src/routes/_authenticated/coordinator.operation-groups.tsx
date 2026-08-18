import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers3, Pencil, Plus, Search, Ship, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changeOperationGroupStatus,
  createOperationGroup,
  getOperationGroup,
  listOperationGroups,
  operationGroupStatuses,
  operationGroupTypes,
  updateOperationGroup,
  linkShipEventToOperationGroup,
  unlinkShipEventFromOperationGroup,
  listOperationLinks,
  createOperationLink,
  revokeOperationLink,
  operationLinkRecipientTypes,
  type OperationLink,
  type OperationGroup,
} from "@/lib/operation-groups.functions";
import { searchShipEvents, type ShipEvent } from "@/lib/ship-events.functions";
import { operationGroupColours, operationGroupColourDotClasses, operationGroupColourLabels, normaliseOperationGroupColour, type OperationGroupColour } from "@/lib/operation-group-colours";

export const Route = createFileRoute("/_authenticated/coordinator/operation-groups")({
  head: () => ({ meta: [{ title: "Operation Groups — Coordinator" }] }),
  component: OperationGroupsPage,
});

type GroupDetails = OperationGroup & {
  ship_events: Array<{
    ship_event_id: string;
    ship_events: { id: string; ship_name: string; eta: string; expected_departure?: string | null; actual_arrival?: string | null; actual_departure?: string | null; port: string; berth_id?: string | null; status?: string | null; berths?: { name: string } | null } | null;
  }>;
  flight_records: Array<{
    flight_schedule_record_id: string;
    flight_schedule_records: {
      id: string;
      flight_number: string;
      airline: string;
      origin: string;
      destination: string;
      scheduled_date: string;
      scheduled_time: string;
      direction: string;
    } | null;
  }>;
  jobs: Array<{
    id: string;
    date: string;
    time: string;
    from_location: string;
    to_location: string;
    status: string;
    operation_group_id: string;
    driver_id?: string | null;
    tracking_kind?: string | null;
    from_location_type?: string | null;
    to_location_type?: string | null;
    immigration_required?: string | null;
    pax?: Array<{ id: string; status?: string | null }>;
  }>;
  alert_counts: {
    eta_reviews: number;
    port_reviews: number;
    departure_warnings: number;
    immigration_reviews: number;
  };
  operation_links: OperationLink[];
  operation_link_activity: Array<{ id: string; operation_link_id: string; action_type: string; previous_values: Record<string, unknown>; new_values: Record<string, unknown>; created_at: string; operation_links?: { recipient_name: string; recipient_type: string } | null }>;
};

const emptyForm = {
  reference: "",
  name: "",
  type: "crew_change" as (typeof operationGroupTypes)[number],
  status: "draft" as (typeof operationGroupStatuses)[number],
  start_date: "",
  end_date: "",
  notes: "",
  colour: "slate" as OperationGroupColour,
};

function formatOperationGroupError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

function OperationGroupsPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listOperationGroups);
  const detailFn = useServerFn(getOperationGroup);
  const createFn = useServerFn(createOperationGroup);
  const updateFn = useServerFn(updateOperationGroup);
  const statusFn = useServerFn(changeOperationGroupStatus);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof operationGroupStatuses)[number] | "all" | "live">("live");
  const [typeFilter, setTypeFilter] = useState<(typeof operationGroupTypes)[number] | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newForm, setNewForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);

  const groupsQuery = useQuery({
    queryKey: ["operation-groups"],
    queryFn: () => listFn() as Promise<OperationGroup[]>,
  });
  const detailQuery = useQuery({
    queryKey: ["operation-group", selectedId],
    queryFn: () => detailFn({ data: { id: selectedId! } }) as Promise<GroupDetails>,
    enabled: Boolean(selectedId),
  });
  const groups = groupsQuery.data ?? [];
  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups.filter(
      (group) =>
        (filter === "all" || (filter === "live" ? ["draft", "active"].includes(group.status) : group.status === filter)) &&
        (typeFilter === "all" || group.type === typeFilter) &&
        (!term ||
          group.reference.toLowerCase().includes(term) ||
          group.name.toLowerCase().includes(term)),
    );
  }, [filter, groups, search, typeFilter]);

  useEffect(() => {
    const group = detailQuery.data;
    if (!group || editing) return;
    setEditForm({
      reference: group.reference,
      name: group.name,
      type: group.type,
      status: group.status,
      start_date: group.start_date ?? "",
      end_date: group.end_date ?? "",
      notes: group.notes ?? "",
      colour: normaliseOperationGroupColour(group.colour),
    });
  }, [detailQuery.data, editing]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["operation-groups"] });
    if (selectedId) queryClient.invalidateQueries({ queryKey: ["operation-group", selectedId] });
  };
  const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Something went wrong";
  const payload = (form: typeof emptyForm) => ({
    ...form,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    notes: form.notes || null,
  });

  const createMutation = useMutation({
    mutationFn: () => createFn({ data: payload(newForm) }),
    onSuccess: (group) => {
      setNewForm(emptyForm);
      setSelectedId(group.id);
      refresh();
      toast.success("Operation Group created");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: () => updateFn({ data: { id: selectedId!, ...payload(editForm) } }),
    onSuccess: () => {
      setEditing(false);
      refresh();
      toast.success("Operation Group updated");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const statusMutation = useMutation({
    mutationFn: (status: (typeof operationGroupStatuses)[number]) =>
      statusFn({ data: { id: selectedId!, status } }),
    onSuccess: () => {
      refresh();
      toast.success("Operation Group status updated");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const selected = detailQuery.data;
  const selectedJobs = selected?.jobs ?? [];
  const passengerCount = selectedJobs.reduce((total, job: any) => total + (job.pax?.length ?? 0), 0);
  const driverCount = new Set(selectedJobs.map((job: any) => job.driver_id).filter(Boolean)).size;
  const progress = {
    completed: selectedJobs.filter((job: any) => job.status === "completed").length,
    cancelled: selectedJobs.filter((job: any) => job.status === "cancelled").length,
    active: selectedJobs.filter((job: any) => !["completed", "cancelled", "pending"].includes(job.status)).length,
    pending: selectedJobs.filter((job: any) => job.status === "pending").length,
  };
  const journey = {
    flightArrivals: selectedJobs.filter((job: any) => job.tracking_kind === "flight" && job.from_location_type === "airport").length,
    flightDepartures: selectedJobs.filter((job: any) => job.tracking_kind === "flight" && job.to_location_type === "airport").length,
    shipArrivals: selectedJobs.filter((job: any) => job.tracking_kind === "vessel" && job.from_location_type === "port").length,
    shipDepartures: selectedJobs.filter((job: any) => job.tracking_kind === "vessel" && job.to_location_type === "port").length,
    roadTransfers: selectedJobs.filter((job: any) => !job.tracking_kind).length,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">
      <header className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Layers3 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Operation Groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organise related operational work without changing existing trips.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Operation Group</CardTitle>
          <CardDescription>
            Grouping is always explicit. Existing Jobs and Trips are not changed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GroupFields value={newForm} onChange={setNewForm} prefix="new-operation-group" />
          <div className="mt-4 flex justify-end">
            <Button
              className="min-h-11"
              onClick={() => createMutation.mutate()}
              disabled={
                createMutation.isPending || !newForm.reference.trim() || !newForm.name.trim()
              }
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {createMutation.isPending ? "Creating…" : "Create Operation"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Groups</CardTitle>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search reference or name"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["live", "all", ...operationGroupStatuses] as const).map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={filter === status ? "default" : "outline"}
                  onClick={() => setFilter(status)}
                >
                  {status === "all" ? "All" : status === "live" ? "Draft + Active" : labelStatus(status)}
                </Button>
              ))}
            </div>
            <select className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-sm" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} aria-label="Operation Group type filter"><option value="all">All group types</option>{operationGroupTypes.map((type) => <option key={type} value={type}>{labelType(type)}</option>)}</select>
          </CardHeader>
          <CardContent className="space-y-2">
            {groupsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading Operation Groups…</p>
            ) : groupsQuery.error ? (
              <p className="text-sm text-destructive">{errorMessage(groupsQuery.error)}</p>
            ) : filteredGroups.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No Operation Groups found.
              </p>
            ) : (
              filteredGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(group.id);
                    setEditing(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition hover:bg-accent ${selectedId === group.id ? "border-primary bg-primary/5" : ""}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${operationGroupColourDotClasses[normaliseOperationGroupColour(group.colour)]}`} aria-label={`${operationGroupColourLabels[normaliseOperationGroupColour(group.colour)]} group colour`} />
                    <span className="min-w-0">
                    <span className="block truncate font-medium">{group.reference}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {group.name}
                    </span>
                    </span>
                  </span>
                  <Badge variant={group.status === "active" ? "secondary" : "outline"}>
                    {labelStatus(group.status)}
                  </Badge>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          {!selectedId ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Select an Operation Group to view details.
            </div>
          ) : detailQuery.isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Loading Operation Group…
            </div>
          ) : detailQuery.error ? (
            <div className="p-6 text-sm text-destructive">{errorMessage(detailQuery.error)}</div>
          ) : detailQuery.data ? (
            <>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base"><span className={`h-3 w-3 rounded-full ${operationGroupColourDotClasses[normaliseOperationGroupColour(detailQuery.data.colour)]}`} />{detailQuery.data.reference}</CardTitle>
                    <CardDescription>{detailQuery.data.name}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={detailQuery.data.status === "active" ? "secondary" : "outline"}>
                      {labelStatus(detailQuery.data.status)}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing((value) => !value)}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      {editing ? "Cancel edit" : "Edit"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {editing ? (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <GroupFields
                      value={editForm}
                      onChange={setEditForm}
                      prefix="edit-operation-group"
                    />
                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        className="min-h-11"
                        onClick={() => updateMutation.mutate()}
                        disabled={updateMutation.isPending}
                      >
                        Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <Info label="Colour" value={operationGroupColourLabels[normaliseOperationGroupColour(detailQuery.data.colour)]} />
                      <Info label="Type" value={labelType(detailQuery.data.type)} />
                      <Info
                        label="Dates"
                        value={`${detailQuery.data.start_date ?? "No start"} → ${detailQuery.data.end_date ?? "No end"}`}
                      />
                      <Info label="Notes" value={detailQuery.data.notes ?? "No notes"} />
                    </div>
                    <div>
                      <Label>Status</Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {operationGroupStatuses.map((status) => (
                          <Button
                            key={status}
                            size="sm"
                            variant={detailQuery.data!.status === status ? "default" : "outline"}
                            onClick={() => statusMutation.mutate(status)}
                            disabled={statusMutation.isPending}
                          >
                            {labelStatus(status)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Summary label="Jobs" value={selectedJobs.length} />
                  <Summary label="Trips" value={selectedJobs.length} />
                  <Summary label="Passengers" value={passengerCount} />
                  <Summary label="Drivers assigned" value={driverCount} />
                </div>
                <div className="grid gap-3 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4">
                  <Summary label="Completed" value={progress.completed} />
                  <Summary label="Active" value={progress.active} />
                  <Summary label="Pending" value={progress.pending} />
                  <Summary label="Cancelled" value={progress.cancelled} />
                </div>
                <div className="grid gap-3 border-t pt-5 sm:grid-cols-2 lg:grid-cols-5">
                  <Summary label="Flight arrivals" value={journey.flightArrivals} />
                  <Summary label="Flight departures" value={journey.flightDepartures} />
                  <Summary label="Ship arrivals" value={journey.shipArrivals} />
                  <Summary label="Ship departures" value={journey.shipDepartures} />
                  <Summary label="Road transfers" value={journey.roadTransfers} />
                </div>
                <div className="grid gap-3 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4">
                  <Summary label="ETA reviews" value={detailQuery.data!.alert_counts?.eta_reviews ?? 0} />
                  <Summary label="Port reviews" value={detailQuery.data!.alert_counts?.port_reviews ?? 0} />
                  <Summary label="Departure warnings" value={detailQuery.data!.alert_counts?.departure_warnings ?? 0} />
                  <Summary label="Immigration reviews" value={detailQuery.data!.alert_counts?.immigration_reviews ?? 0} />
                </div>
                <ShipLinkSection
                  operationGroupId={detailQuery.data.id}
                  links={detailQuery.data.ship_events}
                  onChanged={refresh}
                />
                <OperationLinksSection operationGroupId={detailQuery.data.id} links={detailQuery.data.operation_links ?? []} onChanged={refresh} />
                <section className="space-y-3 border-t pt-5"><div><h3 className="text-sm font-semibold">Operation Link activity</h3><p className="text-xs text-muted-foreground">External actions and access remain available for audit.</p></div>{(detailQuery.data.operation_link_activity ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No external activity recorded.</p> : <div className="space-y-2">{detailQuery.data.operation_link_activity.map((item) => <div key={item.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{item.action_type.replaceAll("_", " ")}</span><span className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</span></div><p className="mt-1 text-xs text-muted-foreground">{item.operation_links?.recipient_name ?? "Operation Link"} · {item.operation_links?.recipient_type?.replaceAll("_", " ") ?? "external"}</p></div>)}</div>}</section>
                <div className="flex flex-wrap gap-2 border-t pt-5">
                  <Button asChild size="sm" variant="outline"><Link to="/coordinator/calendar">Jobs / Trips</Link></Button>
                  <Button asChild size="sm" variant="outline"><Link to="/coordinator/ship-operations">Ship Events</Link></Button>
                  <Button asChild size="sm" variant="outline"><Link to="/admin/flight-schedule">Flights</Link></Button>
                </div>
                <section className="space-y-3 border-t pt-5">
                  <h3 className="text-sm font-semibold">Trips</h3>
                  {selectedJobs.length === 0 ? <p className="text-sm text-muted-foreground">No Jobs or Trips assigned.</p> : <div className="space-y-2">{selectedJobs.map((job: any) => <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{job.date} {String(job.time ?? "").slice(0, 5)} · {job.from_location} → {job.to_location} · {job.status}</span><Button asChild size="sm" variant="outline"><Link to="/coordinator/calendar">Open Job / Trip</Link></Button></div>)}</div>}
                </section>
                <section className="space-y-3 border-t pt-5">
                  <h3 className="text-sm font-semibold">Ship</h3>
                  {detailQuery.data.ship_events.length === 0 ? <p className="text-sm text-muted-foreground">No Ship Event linked.</p> : detailQuery.data.ship_events.map((item) => item.ship_events ? <div key={item.ship_event_id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{item.ship_events.ship_name}</span><Button asChild size="sm" variant="outline"><Link to="/coordinator/ship-operations">Open Ship Operations</Link></Button></div><p className="mt-2 text-xs text-muted-foreground">ETA: {item.ship_events.eta} · Expected Departure: {item.ship_events.expected_departure ?? "—"} · Actual Arrival: {item.ship_events.actual_arrival ?? "—"} · Actual Departure: {item.ship_events.actual_departure ?? "—"}</p><p className="text-xs text-muted-foreground">Port: {item.ship_events.port} · Pickup point: {item.ship_events.berths?.name ?? "—"} · Status: {item.ship_events.status ?? "Scheduled"}</p></div> : null)}
                </section>
                <section className="space-y-3 border-t pt-5">
                  <h3 className="text-sm font-semibold">Flights</h3>
                  {detailQuery.data.flight_records.length === 0 ? <p className="text-sm text-muted-foreground">No Flight Records linked.</p> : detailQuery.data.flight_records.map((item) => item.flight_schedule_records ? <div key={item.flight_schedule_record_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{item.flight_schedule_records.flight_number} · {item.flight_schedule_records.airline} · {item.flight_schedule_records.origin} → {item.flight_schedule_records.destination} · {item.flight_schedule_records.direction}</span><Button asChild size="sm" variant="outline"><Link to="/admin/flight-schedule">Open Flight Operations</Link></Button></div> : null)}
                </section>
                <section className="space-y-3 border-t pt-5">
                  <h3 className="text-sm font-semibold">Reviews</h3>
                  <div className="flex flex-wrap gap-2">{[["ETA Reviews", detailQuery.data.alert_counts.eta_reviews], ["Port Reviews", detailQuery.data.alert_counts.port_reviews], ["Immigration Reviews", detailQuery.data.alert_counts.immigration_reviews], ["Departure Warnings", detailQuery.data.alert_counts.departure_warnings]].map(([label, count]) => <Button key={String(label)} asChild size="sm" variant="outline"><Link to="/coordinator/operations">{label}: {count}</Link></Button>)}</div>
                </section>
                <section className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">Timeline</h3><div className="space-y-1 text-sm">{timelineEvents(detailQuery.data).map((event) => <div key={`${event.label}-${event.at}`} className="flex gap-3"><span className="w-36 shrink-0 text-xs text-muted-foreground">{event.at}</span><span>{event.label}</span></div>)}</div></section>
                <div className="grid gap-6 border-t pt-5 md:grid-cols-2">
                  <LinkedList
                    title="Ship Events"
                    empty="No Ship Events linked"
                    items={detailQuery.data.ship_events.map((item) =>
                      item.ship_events
                        ? `${item.ship_events.ship_name} · ${item.ship_events.port}`
                        : item.ship_event_id,
                    )}
                  />
                  <LinkedList
                    title="Flight Records"
                    empty="No Flight Records linked"
              items={detailQuery.data.flight_records.map((item) =>
                item.flight_schedule_records
                  ? `${item.flight_schedule_records.flight_number} · ${item.flight_schedule_records.airline} · ${item.flight_schedule_records.origin} → ${item.flight_schedule_records.destination}`
                        : item.flight_schedule_record_id,
                      )}
                    />
                  <div className="md:col-span-2">
                    <LinkedList
                      title="Linked Ports"
                      empty="No linked Ports found"
                      items={Array.from(new Set([
                        ...detailQuery.data.ship_events.map((item) => item.ship_events?.port).filter(Boolean),
                        ...selectedJobs.filter((job: any) => job.from_location_type === "port").map((job: any) => job.from_location),
                        ...selectedJobs.filter((job: any) => job.to_location_type === "port").map((job: any) => job.to_location),
                      ])) as string[]}
                    />
                  </div>
                </div>
              </CardContent>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

type ShipLink = GroupDetails["ship_events"][number];

function OperationLinksSection({ operationGroupId, links, onChanged }: { operationGroupId: string; links: OperationLink[]; onChanged: () => void }) {
  const createFn = useServerFn(createOperationLink);
  const revokeFn = useServerFn(revokeOperationLink);
  const [name, setName] = useState("");
  const [recipientType, setRecipientType] = useState<(typeof operationLinkRecipientTypes)[number]>("other");
  const [expiresAt, setExpiresAt] = useState(() => new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 16));
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [canViewSummary, setCanViewSummary] = useState(true);
  const [canViewTransport, setCanViewTransport] = useState(false);
  const [canUpdateEta, setCanUpdateEta] = useState(false);
  const [canUpdateDeparture, setCanUpdateDeparture] = useState(false);
  const [canSubmitUpdate, setCanSubmitUpdate] = useState(false);
  const [canRequestPort, setCanRequestPort] = useState(false);
  const [canViewPassengers, setCanViewPassengers] = useState(false);
  const [canMarkOnboard, setCanMarkOnboard] = useState(false);
  const [accessPreset, setAccessPreset] = useState("custom");
  const applyPreset = (preset: string) => {
    setAccessPreset(preset);
    const grants = {
      view_operation_summary: true,
      view_transport: false,
      update_ship_eta: false,
      update_expected_departure: false,
      request_port_change: false,
      view_passengers: false,
      mark_passenger_onboard: false,
      submit_operational_update: false,
    };
    if (preset === "hr") Object.assign(grants, { view_transport: true, view_passengers: true, submit_operational_update: true });
    if (preset === "ship_agent") Object.assign(grants, { view_transport: true, update_ship_eta: true, update_expected_departure: true, request_port_change: true });
    if (preset === "read_only") Object.assign(grants, { view_transport: true });
    if (preset === "captain") Object.assign(grants, { view_transport: true, update_ship_eta: true, update_expected_departure: true, view_passengers: true, mark_passenger_onboard: true });
    setCanViewSummary(grants.view_operation_summary); setCanViewTransport(grants.view_transport); setCanUpdateEta(grants.update_ship_eta); setCanUpdateDeparture(grants.update_expected_departure); setCanRequestPort(grants.request_port_change); setCanViewPassengers(grants.view_passengers); setCanMarkOnboard(grants.mark_passenger_onboard); setCanSubmitUpdate(grants.submit_operational_update);
  };
  const createMutation = useMutation({
    mutationFn: () => createFn({ data: { operation_group_id: operationGroupId, recipient_name: name, recipient_type: recipientType, expires_at: new Date(expiresAt).toISOString(), permissions: { view_operation_summary: canViewSummary, view_transport: canViewTransport, update_ship_eta: canUpdateEta, update_expected_departure: canUpdateDeparture, request_port_change: canRequestPort, view_passengers: canViewPassengers, mark_passenger_onboard: canMarkOnboard, submit_operational_update: canSubmitUpdate } } }),
    onSuccess: ({ token }) => { setLastLink(`${window.location.origin}/operation-link/${token}`); setName(""); onChanged(); toast.success("Operation Link created"); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create Operation Link"),
  });
  const revokeMutation = useMutation({
    mutationFn: (linkId: string) => revokeFn({ data: { id: operationGroupId, operation_link_id: linkId } }),
    onSuccess: () => { onChanged(); toast.success("Operation Link revoked"); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not revoke Operation Link"),
  });
  return <section className="space-y-3 border-t pt-5">
    <div><h3 className="text-sm font-semibold">Manage Access</h3><p className="text-xs text-muted-foreground">Create time-limited, least-privilege access to this Operation Group. Access is company-scoped and can be revoked at any time.</p></div>
    <div className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
      <div><Label htmlFor="operation-link-name">Recipient name</Label><Input id="operation-link-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Captain Smith" /></div>
      <div><Label htmlFor="operation-link-type">Recipient type</Label><select id="operation-link-type" className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" value={recipientType} onChange={(e) => setRecipientType(e.target.value as typeof recipientType)}>{operationLinkRecipientTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div>
      <div><Label htmlFor="operation-link-expiry">Expires</Label><Input id="operation-link-expiry" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
      <div><Label htmlFor="operation-link-preset">Permission preset</Label><select id="operation-link-preset" className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" value={accessPreset} onChange={(e) => applyPreset(e.target.value)}><option value="custom">Custom</option><option value="captain">Captain</option><option value="hr">HR / crew coordinator</option><option value="ship_agent">Ship agent</option><option value="read_only">Read only</option></select></div>
      <div className="flex flex-wrap items-end gap-3 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={canViewSummary} onChange={(e) => setCanViewSummary(e.target.checked)} />View summary</label><label className="flex items-center gap-2"><input type="checkbox" checked={canViewTransport} onChange={(e) => setCanViewTransport(e.target.checked)} />View transport</label><label className="flex items-center gap-2"><input type="checkbox" checked={canUpdateEta} onChange={(e) => setCanUpdateEta(e.target.checked)} />Update ETA</label><label className="flex items-center gap-2"><input type="checkbox" checked={canUpdateDeparture} onChange={(e) => setCanUpdateDeparture(e.target.checked)} />Update departure</label><label className="flex items-center gap-2"><input type="checkbox" checked={canRequestPort} onChange={(e) => setCanRequestPort(e.target.checked)} />Request port change</label><label className="flex items-center gap-2"><input type="checkbox" checked={canViewPassengers} onChange={(e) => setCanViewPassengers(e.target.checked)} />View passengers/crew</label><label className="flex items-center gap-2"><input type="checkbox" checked={canMarkOnboard} onChange={(e) => setCanMarkOnboard(e.target.checked)} />Mark onboard</label><label className="flex items-center gap-2"><input type="checkbox" checked={canSubmitUpdate} onChange={(e) => setCanSubmitUpdate(e.target.checked)} />Submit update</label></div>
      <Button className="min-h-11 sm:col-span-2" disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}><Plus className="mr-1.5 h-4 w-4" />Create Operation Link</Button>
    </div>
    {lastLink && <div className="rounded-md border border-emerald-500/40 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30"><p className="font-medium">Copy this link now</p><div className="mt-2 flex gap-2"><Input readOnly value={lastLink} /><Button type="button" variant="outline" onClick={() => navigator.clipboard?.writeText(lastLink)}>Copy</Button></div></div>}
    <div className="space-y-2">{links.length === 0 ? <p className="text-sm text-muted-foreground">No Operation Links created.</p> : links.map((link) => <div key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><div><p className="font-medium">{link.recipient_name} <Badge variant="outline">{link.recipient_type.replaceAll("_", " ")}</Badge></p><p className="text-xs text-muted-foreground">Expires {new Date(link.expires_at).toLocaleString()} · {link.revoked_at ? "Revoked" : "Active"}</p></div>{!link.revoked_at && <Button size="sm" variant="outline" onClick={() => revokeMutation.mutate(link.id)} disabled={revokeMutation.isPending}>Revoke</Button>}</div>)}</div>
  </section>;
}

function ShipLinkSection({
  operationGroupId,
  links,
  onChanged,
}: {
  operationGroupId: string;
  links: ShipLink[];
  onChanged: () => void;
}) {
  const searchFn = useServerFn(searchShipEvents);
  const linkFn = useServerFn(linkShipEventToOperationGroup);
  const unlinkFn = useServerFn(unlinkShipEventFromOperationGroup);
  const [search, setSearch] = useState("");
  const linked = links[0]?.ship_events;
  const linkedId = links[0]?.ship_event_id ?? null;
  const searchQuery = useQuery({
    queryKey: ["operation-group-ship-search", search],
    queryFn: () => searchFn({ data: { search: search.trim() } }) as Promise<ShipEvent[]>,
    enabled: search.trim().length >= 2,
  });
  const mutation = useMutation({
    mutationFn: async (nextShipId: string | null) => {
      if (nextShipId === linkedId) return;
      if (linkedId) {
        await unlinkFn({ data: { operation_group_id: operationGroupId, ship_event_id: linkedId } });
      }
      if (nextShipId) {
        await linkFn({ data: { operation_group_id: operationGroupId, ship_event_id: nextShipId } });
      }
    },
    onSuccess: () => {
      setSearch("");
      onChanged();
      toast.success("Linked Ship updated");
    },
    onError: (error) => toast.error(formatOperationGroupError(error)),
  });
  return (
    <section className="space-y-3 border-t pt-5">
      <div className="flex items-center gap-2">
        <Ship className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Linked Ship (optional)</h3>
      </div>
      {linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <div>
            <p className="font-medium">{linked.ship_name}</p>
            <p className="text-xs text-muted-foreground">{linked.port} · ETA {linked.eta} · {linked.status ?? "Scheduled"}</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => mutation.mutate(null)} disabled={mutation.isPending}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Remove Ship
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No Ship linked</p>
      )}
      <div className="space-y-2">
        <Label htmlFor="operation-group-ship-search">{linked ? "Change Ship" : "Select Ship"}</Label>
        <Input
          id="operation-group-ship-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search active Ship Events"
        />
        {search.trim().length >= 2 ? (
          <div className="max-h-44 overflow-y-auto rounded-md border bg-background">
            {searchQuery.isFetching ? <p className="p-3 text-xs text-muted-foreground">Searching Ship Events…</p> : null}
            {!searchQuery.isFetching && (searchQuery.data ?? []).length === 0 ? <p className="p-3 text-xs text-muted-foreground">No active Ship Events found.</p> : null}
            {(searchQuery.data ?? []).map((ship) => (
              <button
                key={ship.id}
                type="button"
                className="flex w-full flex-col border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-accent"
                onClick={() => mutation.mutate(ship.id)}
                disabled={mutation.isPending}
              >
                <span className="font-medium">{ship.ship_name} · {ship.port}</span>
                <span className="text-muted-foreground">ETA {ship.eta} · {ship.status}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function GroupFields({
  value,
  onChange,
  prefix,
}: {
  value: typeof emptyForm;
  onChange: (value: typeof emptyForm) => void;
  prefix: string;
}) {
  const set = (key: keyof typeof emptyForm, next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Reference" htmlFor={`${prefix}-reference`}>
        <Input
          id={`${prefix}-reference`}
          value={value.reference}
          onChange={(event) => set("reference", event.target.value)}
          placeholder="e.g. CREW-2026-001"
        />
      </Field>
      <Field label="Name" htmlFor={`${prefix}-name`}>
        <Input
          id={`${prefix}-name`}
          value={value.name}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Operation name"
        />
      </Field>
      <Field label="Type" htmlFor={`${prefix}-type`}>
        <select
          id={`${prefix}-type`}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={value.type}
          onChange={(event) =>
            onChange({ ...value, type: event.target.value as typeof value.type })
          }
        >
          {operationGroupTypes.map((type) => (
            <option key={type} value={type}>
              {labelType(type)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status" htmlFor={`${prefix}-status`}>
        <select
          id={`${prefix}-status`}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={value.status}
          onChange={(event) =>
            onChange({ ...value, status: event.target.value as typeof value.status })
          }
        >
          {operationGroupStatuses.map((status) => (
            <option key={status} value={status}>
              {labelStatus(status)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Colour" htmlFor={`${prefix}-colour`}>
        <select
          id={`${prefix}-colour`}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={normaliseOperationGroupColour(value.colour)}
          onChange={(event) => onChange({ ...value, colour: event.target.value as OperationGroupColour })}
        >
          {operationGroupColours.map((colour) => <option key={colour} value={colour}>{operationGroupColourLabels[colour]}</option>)}
        </select>
      </Field>
      <Field label="Start date" htmlFor={`${prefix}-start`}>
        <Input
          id={`${prefix}-start`}
          type="date"
          value={value.start_date}
          onChange={(event) => set("start_date", event.target.value)}
        />
      </Field>
      <Field label="End date" htmlFor={`${prefix}-end`}>
        <Input
          id={`${prefix}-end`}
          type="date"
          value={value.end_date}
          onChange={(event) => set("end_date", event.target.value)}
        />
      </Field>
      <Field label="Notes" htmlFor={`${prefix}-notes`}>
        <textarea
          id={`${prefix}-notes`}
          className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm sm:col-span-2"
          value={value.notes}
          onChange={(event) => set("notes", event.target.value)}
        />
      </Field>
    </div>
  );
}

function labelType(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function timelineEvents(group: GroupDetails) {
  const events: Array<{ label: string; at: string }> = [];
  for (const ship of group.ship_events) {
    if (ship.ship_events?.eta) events.push({ label: `Ship ETA · ${ship.ship_events.ship_name}`, at: ship.ship_events.eta });
    if (ship.ship_events?.expected_departure) events.push({ label: `Expected Departure · ${ship.ship_events.ship_name}`, at: ship.ship_events.expected_departure });
  }
  for (const flight of group.flight_records) {
    const record = flight.flight_schedule_records;
    if (record?.direction === "arrival") events.push({ label: `Flight Arrival · ${record.flight_number}`, at: `${record.scheduled_date}T${record.scheduled_time}` });
  }
  for (const job of group.jobs) if (job.date && job.time) events.push({ label: `Trip · ${job.from_location} → ${job.to_location}`, at: `${job.date}T${job.time}` });
  return events.sort((a, b) => a.at.localeCompare(b.at));
}
function labelStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
function LinkedList({ title, empty, items }: { title: string; empty: string; items: string[] }) {
  return (
    <div>
      <h2 className="font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item} className="rounded-lg border p-3 text-sm">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
