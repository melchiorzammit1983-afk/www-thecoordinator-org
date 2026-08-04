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
  archiveShipEvent,
  unarchiveShipEvent,
} from "@/lib/ship-events.functions";
import { getPortWithActiveBerths, listPorts, type PortDirectoryBerth, type PortDirectoryPort } from "@/lib/port-directory.functions";
import { formatMaltaDateTime, isoToMaltaDateTime } from "@/lib/time";

export const Route = createFileRoute("/_authenticated/coordinator/ship-operations")({
  head: () => ({ meta: [{ title: "Ship Operations — Coordinator" }] }),
  component: ShipOperationsPage,
});

function ShipOperationsPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listShipEvents);
  const createFn = useServerFn(createShipEvent);
  const updateEtaFn = useServerFn(updateShipEventEta);
  const archiveFn = useServerFn(archiveShipEvent);
  const unarchiveFn = useServerFn(unarchiveShipEvent);
  const listPortsFn = useServerFn(listPorts);
  const portDetailFn = useServerFn(getPortWithActiveBerths);
  const [shipName, setShipName] = useState("");
  const [eta, setEta] = useState("");
  const [port, setPort] = useState("");
  const [portId, setPortId] = useState<string | null>(null);
  const [berthId, setBerthId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShipEvent | null>(null);
  const [editedEta, setEditedEta] = useState("");
  const { data: ports = [] } = useQuery({
    queryKey: ["port-directory-active-for-ships"],
    queryFn: () => listPortsFn({ data: {} }) as Promise<Omit<PortDirectoryPort, "company_id">[]>,
  });
  const { data: selectedPort } = useQuery({
    queryKey: ["port-directory-ship-berths", portId],
    queryFn: () => portDetailFn({ data: { id: portId!, include_inactive: false } }),
    enabled: !!portId,
  });

  const {
    data: events = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["ship-events"],
    queryFn: () => listFn(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ship-events"] });
  const create = useMutation({
    mutationFn: () => createFn({ data: { ship_name: shipName, eta, port, port_id: portId, berth_id: berthId } }),
    onSuccess: () => {
      setShipName("");
      setEta("");
      setPort("");
      setPortId(null);
      setBerthId(null);
      refresh();
      toast.success("Ship event created");
    },
    onError: (reason: Error) => toast.error(reason.message),
  });
  const updateEta = useMutation({
    mutationFn: () => updateEtaFn({ data: { id: editing!.id, eta: editedEta } }),
    onSuccess: () => {
      setEditing(null);
      refresh();
      toast.success("Ship ETA updated");
    },
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
    setEditing(event);
    setEditedEta(`${date}T${time}`);
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
              create.mutate();
            }}
          >
            <Field label="Ship name" htmlFor="ship-name">
              <Input
                id="ship-name"
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
                type="datetime-local"
                value={eta}
                onChange={(event) => setEta(event.target.value)}
                required
              />
            </Field>
            <Field label="Port" htmlFor="ship-port">
              <select id="ship-port" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={portId ?? ""} onChange={(event) => { const next = event.target.value || null; setPortId(next); setBerthId(null); setPort(ports.find((item) => item.id === next)?.name ?? ""); }} required>
                <option value="">Select a port</option>
                {ports.map((item) => <option key={item.id} value={item.id}>{item.name}{item.code ? ` (${item.code})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Berth (optional)" htmlFor="ship-berth">
              <select id="ship-berth" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={berthId ?? ""} onChange={(event) => setBerthId(event.target.value || null)} disabled={!portId}>
                <option value="">No berth selected</option>
                {(selectedPort?.berths ?? []).map((item: PortDirectoryBerth) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {selectedPort ? <span className="text-xs text-muted-foreground">{selectedPort.address}</span> : null}
            </Field>
            <Button type="submit" disabled={create.isPending || !portId}>
              <Plus className="mr-1.5 h-4 w-4" /> {create.isPending ? "Creating…" : "Create"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled ship events</CardTitle>
          <CardDescription>Only your company can see and update these events. Archived events remain available for historical trips.</CardDescription>
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
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEtaEditor(event)} disabled={!!event.archived_at}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit ETA
                    </Button>
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
              updateEta.mutate();
            }}
            className="space-y-4"
          >
            <Field label="ETA" htmlFor="edit-ship-eta">
              <Input
                id="edit-ship-eta"
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
