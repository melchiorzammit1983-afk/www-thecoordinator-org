import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock3, Pencil, Plus, Ship } from "lucide-react";
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
} from "@/lib/ship-events.functions";
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
  const [shipName, setShipName] = useState("");
  const [eta, setEta] = useState("");
  const [port, setPort] = useState("");
  const [editing, setEditing] = useState<ShipEvent | null>(null);
  const [editedEta, setEditedEta] = useState("");

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
    mutationFn: () => createFn({ data: { ship_name: shipName, eta, port } }),
    onSuccess: () => {
      setShipName("");
      setEta("");
      setPort("");
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
            className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-end"
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
              <Input
                id="ship-port"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                maxLength={160}
                required
                placeholder="e.g. Valletta"
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              <Plus className="mr-1.5 h-4 w-4" /> {create.isPending ? "Creating…" : "Create"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled ship events</CardTitle>
          <CardDescription>Only your company can see and update these events.</CardDescription>
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
                        {event.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{event.port}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" /> ETA{" "}
                        {formatMaltaDateTime(event.eta, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openEtaEditor(event)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit ETA
                  </Button>
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
