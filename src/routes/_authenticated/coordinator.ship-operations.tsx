import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, Clock3, Pencil, Plus, Ship, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  createShipEvent,
  listShipEvents,
  type ShipEvent,
  updateShipEventEta,
  updateShipEventLifecycle,
  updateShipEventPort,
  cancelShipEvent,
  archiveShipEvent,
  unarchiveShipEvent,
} from "@/lib/ship-events.functions";
import { getPortWithActiveBerths, listPorts, type PortDirectoryBerth, type PortDirectoryPort } from "@/lib/port-directory.functions";
import { formatMaltaDateTime, isoToMaltaDateTime } from "@/lib/time";

type ShipStatusFilter = "active" | "arrived" | "departed" | "archived" | "all";

export const Route = createFileRoute("/_authenticated/coordinator/ship-operations")({
  head: () => ({ meta: [{ title: "Ship Operations — Coordinator" }] }),
  component: ShipOperationsPage,
});

function ShipOperationsPage() {
  const [filter, setFilter] = useState<ShipStatusFilter>(() => {
    if (typeof window === "undefined") return "active";
    const saved = window.localStorage.getItem("ship-operations-filter");
    return saved === "arrived" || saved === "departed" || saved === "archived" || saved === "all" ? saved : "active";
  });
  useEffect(() => { window.localStorage.setItem("ship-operations-filter", filter); }, [filter]);
  const queryClient = useQueryClient();
  const listFn = useServerFn(listShipEvents);
  const createFn = useServerFn(createShipEvent);
  const updateEtaFn = useServerFn(updateShipEventEta);
  const updateLifecycleFn = useServerFn(updateShipEventLifecycle);
  const updatePortFn = useServerFn(updateShipEventPort);
  const cancelFn = useServerFn(cancelShipEvent);
  const archiveFn = useServerFn(archiveShipEvent);
  const unarchiveFn = useServerFn(unarchiveShipEvent);
  const listPortsFn = useServerFn(listPorts);
  const portDetailFn = useServerFn(getPortWithActiveBerths);
  const [shipName, setShipName] = useState("");
  const [eta, setEta] = useState("");
  const [expectedDeparture, setExpectedDeparture] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [port, setPort] = useState("");
  const [portId, setPortId] = useState<string | null>(null);
  const [berthId, setBerthId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShipEvent | null>(null);
  const [editedEta, setEditedEta] = useState("");
  const [etaEditError, setEtaEditError] = useState<string | null>(null);
  const [lifecycleEditing, setLifecycleEditing] = useState<ShipEvent | null>(null);
  const [editedExpectedDeparture, setEditedExpectedDeparture] = useState("");
  const [editedActualArrival, setEditedActualArrival] = useState("");
  const [editedActualDeparture, setEditedActualDeparture] = useState("");
  const [portEditing, setPortEditing] = useState<ShipEvent | null>(null);
  const [editedPortId, setEditedPortId] = useState("");
  const [editedBerthId, setEditedBerthId] = useState("");
  const { data: ports = [] } = useQuery({
    queryKey: ["port-directory-active-for-ships"],
    queryFn: () => listPortsFn({ data: {} }) as Promise<Omit<PortDirectoryPort, "company_id">[]>,
  });
  const { data: selectedPort } = useQuery({
    queryKey: ["port-directory-ship-berths", portId],
    queryFn: () => portDetailFn({ data: { id: portId!, include_inactive: false } }),
    enabled: !!portId,
  });
  const { data: editingPort } = useQuery({
    queryKey: ["port-directory-edit-ship-berths", editedPortId],
    queryFn: () => portDetailFn({ data: { id: editedPortId, include_inactive: false } }),
    enabled: !!editedPortId,
  });

  const {
    data: events = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["ship-events", filter],
    queryFn: () => listFn({ data: { filter } }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ship-events"] });
  const create = useMutation({
    mutationFn: (payload: { ship_name: string; eta: string; expected_departure: string; port: string; port_id: string | null; berth_id: string | null }) => createFn({ data: payload }),
    onSuccess: () => {
      setCreateError(null);
      setShipName("");
      setEta("");
      setExpectedDeparture("");
      setPort("");
      setPortId(null);
      setBerthId(null);
      refresh();
      toast.success("Ship event created");
    },
    onError: (reason: Error) => {
      const message = reason?.message || "Ship event could not be created.";
      setCreateError(message);
      toast.error(message);
    },
  });
  const updateEta = useMutation({
    mutationFn: (payload: { id: string; eta: string }) => updateEtaFn({ data: payload }),
    onSuccess: () => {
      setEtaEditError(null);
      setEditing(null);
      refresh();
      toast.success("Ship ETA updated");
    },
    onError: (reason: Error) => {
      const message = reason?.message || "Ship ETA could not be updated.";
      setEtaEditError(message);
      toast.error(message);
    },
  });
  const updateLifecycle = useMutation({
    mutationFn: () => updateLifecycleFn({ data: {
      id: lifecycleEditing!.id,
      expected_departure: editedExpectedDeparture || null,
      actual_arrival: editedActualArrival || null,
      actual_departure: editedActualDeparture || null,
    } }),
    onSuccess: () => { setLifecycleEditing(null); refresh(); toast.success("Ship lifecycle updated"); },
    onError: (reason: Error) => toast.error(reason.message),
  });
  const updatePort = useMutation({
    mutationFn: () => updatePortFn({ data: { id: portEditing!.id, port_id: editedPortId, berth_id: editedBerthId || null } }),
    onSuccess: (result) => { setPortEditing(null); refresh(); toast.success(result.changed ? "Ship Port/Pickup point updated" : "No Port/Pickup point change detected"); },
    onError: (reason: Error) => toast.error(reason.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: () => { refresh(); toast.success("Ship event cancelled"); },
    onError: (reason: Error) => toast.error(reason.message),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => { refresh(); toast.success("Ship event archived"); },
    onError: (reason: Error) => toast.error(reason.message),
  });
  const unarchive = useMutation({
    mutationFn: (id: string) => unarchiveFn({ data: { id } }),
    onSuccess: () => { refresh(); toast.success("Ship event restored"); },
    onError: (reason: Error) => toast.error(reason.message),
  });

  function openEtaEditor(event: ShipEvent) {
    const { date, time } = isoToMaltaDateTime(event.eta);
    setEtaEditError(null);
    setEditing(event);
    setEditedEta(`${date}T${time}`);
  }

  function openLifecycleEditor(event: ShipEvent) {
    setLifecycleEditing(event);
    setEditedExpectedDeparture(event.expected_departure ? `${isoToMaltaDateTime(event.expected_departure).date}T${isoToMaltaDateTime(event.expected_departure).time}` : "");
    setEditedActualArrival(event.actual_arrival ? `${isoToMaltaDateTime(event.actual_arrival).date}T${isoToMaltaDateTime(event.actual_arrival).time}` : "");
    setEditedActualDeparture(event.actual_departure ? `${isoToMaltaDateTime(event.actual_departure).date}T${isoToMaltaDateTime(event.actual_departure).time}` : "");
  }

  function openPortEditor(event: ShipEvent) {
    setPortEditing(event);
    setEditedPortId(event.port_id ?? "");
    setEditedBerthId(event.berth_id ?? "");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">
      <header className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Ship className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Ship Operations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manual, company-private ship ETA management.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create ship event</CardTitle>
          <CardDescription>
            Events are scheduled manually and are not linked to trips in this milestone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-[1.2fr_1fr_1.2fr_1.2fr_auto] md:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              create.mutate({
                ship_name: String(formData.get("ship_name") ?? ""),
                eta: String(formData.get("eta") ?? ""),
                expected_departure: String(formData.get("expected_departure") ?? ""),
                port,
                port_id: String(formData.get("port_id") ?? "") || null,
                berth_id: String(formData.get("berth_id") ?? "") || null,
              });
            }}
          >
            <Field label="Ship name" htmlFor="ship-name">
              <Input
                id="ship-name"
                name="ship_name"
                value={shipName}
                onChange={(event) => setShipName(event.target.value)}
                maxLength={200}
                required
                placeholder="e.g. Ocean Voyager"
              />
            </Field>
            <Field label="ETA" htmlFor="ship-eta">
              <Input
                id="ship-eta"
                name="eta"
                type="datetime-local"
                value={eta}
                onChange={(event) => setEta(event.target.value)}
                required
              />
            </Field>
            <Field label="Expected departure" htmlFor="ship-expected-departure">
              <Input id="ship-expected-departure" name="expected_departure" type="datetime-local" value={expectedDeparture} onChange={(event) => setExpectedDeparture(event.target.value)} required />
            </Field>
            <Field label="Port" htmlFor="ship-port">
              <select id="ship-port" name="port_id" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={portId ?? ""} onChange={(event) => { const next = event.target.value || null; setPortId(next); setBerthId(null); setPort(ports.find((item) => item.id === next)?.name ?? ""); }} required>
                <option value="">Select a port</option>
                {ports.map((item) => <option key={item.id} value={item.id}>{item.name}{item.code ? ` (${item.code})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Pickup point (optional)" htmlFor="ship-berth">
              <select id="ship-berth" name="berth_id" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={berthId ?? ""} onChange={(event) => setBerthId(event.target.value || null)} disabled={!portId}>
                <option value="">No pickup point selected</option>
                {(selectedPort?.berths ?? []).map((item: PortDirectoryBerth) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {selectedPort ? <span className="text-xs text-muted-foreground">{selectedPort.address}</span> : null}
            </Field>
            <Button type="submit" disabled={create.isPending || !portId}>
              <Plus className="mr-1.5 h-4 w-4" /> {create.isPending ? "Creating…" : "Create"}
            </Button>
            {createError ? <p role="alert" className="text-sm text-destructive md:col-span-full">{createError}</p> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">Scheduled ship events</CardTitle>
            <CardDescription>Only your company can see and update these events. Archived events remain available for historical trips.</CardDescription>
          </div>
          <Field label="View" htmlFor="ship-status-filter">
            <select
              id="ship-status-filter"
              className="flex h-10 min-w-36 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={filter}
              onChange={(event) => setFilter(event.target.value as ShipStatusFilter)}
            >
              <option value="active">Active</option>
              <option value="arrived">Arrived</option>
              <option value="departed">Departed</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </Field>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
              <span>{error.message || "Ship events could not be loaded."}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">Loading ship events…</p>
          ) : events.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No ship events yet.
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Ship className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate font-medium">{event.ship_name}</span>
                      <Badge variant="secondary" className="capitalize">
                        {event.archived_at ? "Archived" : event.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{event.ports?.name ?? event.port}{event.berths?.name ? ` · ${event.berths.name}` : ""}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" /> ETA{" "}
                        {formatMaltaDateTime(event.eta, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                      <span>Stay {formatStayDuration(event)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEtaEditor(event)} disabled={!!event.archived_at}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit ETA
                    </Button>
                    {!event.archived_at && event.status !== "cancelled" ? <>
                      <Button type="button" variant="outline" size="sm" onClick={() => openPortEditor(event)}>Port / Pickup point</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => openLifecycleEditor(event)}>Lifecycle</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => cancel.mutate(event.id)} disabled={cancel.isPending}>Cancel</Button>
                    </> : null}
                    {event.archived_at ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => unarchive.mutate(event.id)} disabled={unarchive.isPending}>
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Restore
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => archive.mutate(event.id)} disabled={archive.isPending}>
                        <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(portEditing)} onOpenChange={(open) => !open && setPortEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit ship Port / Pickup point</DialogTitle>
            <DialogDescription>{portEditing?.ship_name ?? "Ship event"} — changes create a review item when linked trips exist.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); updatePort.mutate(); }} className="space-y-4">
            <Field label="Port" htmlFor="edit-ship-port">
              <select id="edit-ship-port" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editedPortId} onChange={(event) => { setEditedPortId(event.target.value); setEditedBerthId(""); }} required>
                <option value="">Select a port</option>
                {ports.map((item) => <option key={item.id} value={item.id}>{item.name}{item.code ? ` (${item.code})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Pickup point (optional)" htmlFor="edit-ship-berth">
              <select id="edit-ship-berth" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editedBerthId} onChange={(event) => setEditedBerthId(event.target.value)} disabled={!editedPortId}>
                <option value="">No pickup point selected</option>
                {(editingPort?.berths ?? []).map((item: PortDirectoryBerth) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPortEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={updatePort.isPending || !editedPortId}>{updatePort.isPending ? "Saving…" : "Save Port / Pickup point"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(lifecycleEditing)} onOpenChange={(open) => !open && setLifecycleEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit ship lifecycle</DialogTitle>
            <DialogDescription>{lifecycleEditing?.ship_name ?? "Ship event"} — mark arrival/departure without changing ETA history.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); updateLifecycle.mutate(); }} className="space-y-4">
            <Field label="Expected departure" htmlFor="edit-ship-expected-departure">
              <Input id="edit-ship-expected-departure" type="datetime-local" value={editedExpectedDeparture} onChange={(event) => setEditedExpectedDeparture(event.target.value)} required />
            </Field>
            <Field label="Actual arrival (optional)" htmlFor="edit-ship-actual-arrival">
              <Input id="edit-ship-actual-arrival" type="datetime-local" value={editedActualArrival} onChange={(event) => setEditedActualArrival(event.target.value)} />
            </Field>
            <Field label="Actual departure (optional)" htmlFor="edit-ship-actual-departure">
              <Input id="edit-ship-actual-departure" type="datetime-local" value={editedActualDeparture} onChange={(event) => setEditedActualDeparture(event.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLifecycleEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={updateLifecycle.isPending}>{updateLifecycle.isPending ? "Saving…" : "Save lifecycle"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit ship ETA</DialogTitle>
            <DialogDescription>
              {editing?.ship_name ?? "Ship event"} — {editing?.port ?? ""}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const eta = String(formData.get("eta") ?? "").trim();
              if (!eta || !editing) {
                const message = "Enter a valid ETA.";
                setEtaEditError(message);
                toast.error(message);
                return;
              }
              updateEta.mutate({ id: editing.id, eta });
            }}
            className="space-y-4"
          >
            {etaEditError ? <p role="alert" className="text-sm text-destructive">{etaEditError}</p> : null}
            <Field label="ETA" htmlFor="edit-ship-eta">
              <Input
                id="edit-ship-eta"
                name="eta"
                type="datetime-local"
                value={editedEta}
                onChange={(event) => setEditedEta(event.target.value)}
                required
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateEta.isPending}>
                {updateEta.isPending ? "Saving…" : "Save ETA"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
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

function formatStayDuration(event: ShipEvent) {
  const start = event.actual_arrival ?? event.eta;
  const end = event.actual_departure ?? event.expected_departure;
  if (!start || !end) return "—";
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}
