import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Anchor, Pencil, Plus, Power, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createBerth,
  createPort,
  getPortWithActiveBerths,
  listPorts,
  setBerthActive,
  setPortActive,
  updateBerth,
  updatePort,
  type PortDirectoryBerth,
  type PortDirectoryPort,
} from "@/lib/port-directory.functions";

export const Route = createFileRoute("/_authenticated/coordinator/ports")({
  head: () => ({ meta: [{ title: "Port Directory — Coordinator" }] }),
  component: PortsPage,
});

type Port = Omit<PortDirectoryPort, "company_id">;
type Berth = PortDirectoryBerth;

const emptyPort = { name: "", code: "", country: "", address: "", latitude: "", longitude: "" };
const emptyBerth = { name: "", address_override: "", latitude_override: "", longitude_override: "" };

function PortsPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listPorts);
  const detailFn = useServerFn(getPortWithActiveBerths);
  const createPortFn = useServerFn(createPort);
  const updatePortFn = useServerFn(updatePort);
  const setPortActiveFn = useServerFn(setPortActive);
  const createBerthFn = useServerFn(createBerth);
  const updateBerthFn = useServerFn(updateBerth);
  const setBerthActiveFn = useServerFn(setBerthActive);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [portForm, setPortForm] = useState(emptyPort);
  const [editingPort, setEditingPort] = useState(false);
  const [newPort, setNewPort] = useState(emptyPort);
  const [berthForm, setBerthForm] = useState(emptyBerth);
  const [editingBerthId, setEditingBerthId] = useState<string | null>(null);

  const portsQuery = useQuery({
    queryKey: ["port-directory"],
    queryFn: () => listFn({ data: { include_inactive: true } }) as Promise<Port[]>,
  });
  const detailQuery = useQuery({
    queryKey: ["port-directory-detail", selectedId],
    queryFn: () => detailFn({ data: { id: selectedId!, include_inactive: true } }),
    enabled: !!selectedId,
  });
  const ports = portsQuery.data ?? [];
  const filteredPorts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? ports.filter((port) => port.name.toLowerCase().includes(term)) : ports;
  }, [ports, search]);

  useEffect(() => {
    const port = detailQuery.data;
    if (!port || editingPort) return;
    setPortForm({
      name: port.name,
      code: port.code ?? "",
      country: port.country,
      address: port.address,
      latitude: port.latitude == null ? "" : String(port.latitude),
      longitude: port.longitude == null ? "" : String(port.longitude),
    });
  }, [detailQuery.data, editingPort]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["port-directory"] });
    if (selectedId) queryClient.invalidateQueries({ queryKey: ["port-directory-detail", selectedId] });
  };
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong";
  const numberOrNull = (value: string) => value.trim() === "" ? null : Number(value);

  const createPortMut = useMutation({
    mutationFn: () => createPortFn({ data: {
      name: newPort.name,
      code: newPort.code || null,
      country: newPort.country,
      address: newPort.address,
      latitude: numberOrNull(newPort.latitude),
      longitude: numberOrNull(newPort.longitude),
    } }),
    onSuccess: (port) => {
      setNewPort(emptyPort);
      setSelectedId(port.id);
      refresh();
      toast.success("Port created");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const updatePortMut = useMutation({
    mutationFn: () => updatePortFn({ data: {
      id: selectedId!,
      name: portForm.name,
      code: portForm.code || null,
      country: portForm.country,
      address: portForm.address,
      latitude: numberOrNull(portForm.latitude),
      longitude: numberOrNull(portForm.longitude),
    } }),
    onSuccess: () => { setEditingPort(false); refresh(); toast.success("Port updated"); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const setPortActiveMut = useMutation({
    mutationFn: (active: boolean) => setPortActiveFn({ data: { id: selectedId!, active } }),
    onSuccess: () => { refresh(); toast.success("Port status updated"); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const createBerthMut = useMutation({
    mutationFn: () => createBerthFn({ data: {
      port_id: selectedId!,
      name: berthForm.name,
      address_override: berthForm.address_override || null,
      latitude_override: numberOrNull(berthForm.latitude_override),
      longitude_override: numberOrNull(berthForm.longitude_override),
    } }),
    onSuccess: () => { setBerthForm(emptyBerth); refresh(); toast.success("Berth created"); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const updateBerthMut = useMutation({
    mutationFn: () => updateBerthFn({ data: {
      id: editingBerthId!,
      name: berthForm.name,
      address_override: berthForm.address_override || null,
      latitude_override: numberOrNull(berthForm.latitude_override),
      longitude_override: numberOrNull(berthForm.longitude_override),
    } }),
    onSuccess: () => { setEditingBerthId(null); setBerthForm(emptyBerth); refresh(); toast.success("Berth updated"); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const setBerthActiveMut = useMutation({
    mutationFn: (input: { id: string; active: boolean }) => setBerthActiveFn({ data: input }),
    onSuccess: () => { refresh(); toast.success("Berth status updated"); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function selectPort(id: string) {
    setSelectedId(id);
    setEditingPort(false);
    setEditingBerthId(null);
    setBerthForm(emptyBerth);
  }
  function beginBerthEdit(berth: Berth) {
    setEditingBerthId(berth.id);
    setBerthForm({
      name: berth.name,
      address_override: berth.address_override ?? "",
      latitude_override: berth.latitude_override == null ? "" : String(berth.latitude_override),
      longitude_override: berth.longitude_override == null ? "" : String(berth.longitude_override),
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">
      <header className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Anchor className="h-5 w-5" /></div>
        <div><h1 className="text-xl font-semibold sm:text-2xl">Port Directory</h1><p className="mt-1 text-sm text-muted-foreground">Company-private ports and berths.</p></div>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Create port</CardTitle><CardDescription>Ports are kept private to your company. Records are deactivated instead of deleted.</CardDescription></CardHeader>
        <CardContent><PortFields value={newPort} onChange={setNewPort} prefix="new-port" /><div className="mt-4 flex justify-end"><Button className="min-h-11" onClick={() => createPortMut.mutate()} disabled={createPortMut.isPending || !newPort.name.trim() || !newPort.country.trim() || !newPort.address.trim()}><Plus className="mr-1.5 h-4 w-4" />{createPortMut.isPending ? "Creating…" : "Create Port"}</Button></div></CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">Ports</CardTitle><div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search port name" /></div></CardHeader>
          <CardContent className="space-y-2">
            {portsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading ports…</p> : portsQuery.error ? <div className="space-y-2 text-sm text-destructive"><p>{errorMessage(portsQuery.error)}</p><Button variant="outline" size="sm" onClick={() => portsQuery.refetch()}>Try again</Button></div> : filteredPorts.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No ports found.</p> : filteredPorts.map((port) => <button key={port.id} type="button" onClick={() => selectPort(port.id)} className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition hover:bg-accent ${selectedId === port.id ? "border-primary bg-primary/5" : ""}`}><span className="min-w-0"><span className="block truncate font-medium">{port.name}</span><span className="block truncate text-xs text-muted-foreground">{port.country}{port.code ? ` · ${port.code}` : ""}</span></span><Badge variant={port.active ? "secondary" : "outline"}>{port.active ? "Active" : "Inactive"}</Badge></button>)}
          </CardContent>
        </Card>

        <Card>
          {!selectedId ? <div className="p-10 text-center text-sm text-muted-foreground">Select a port to manage its details and berths.</div> : detailQuery.isLoading ? <div className="p-10 text-center text-sm text-muted-foreground">Loading port…</div> : detailQuery.error ? <div className="space-y-2 p-6 text-sm text-destructive"><p>{errorMessage(detailQuery.error)}</p><Button variant="outline" size="sm" onClick={() => detailQuery.refetch()}>Try again</Button></div> : detailQuery.data ? <>
            <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{detailQuery.data.name}</CardTitle><CardDescription>{detailQuery.data.country}{detailQuery.data.code ? ` · ${detailQuery.data.code}` : ""}</CardDescription></div><div className="flex flex-wrap gap-2"><Badge variant={detailQuery.data.active ? "secondary" : "outline"}>{detailQuery.data.active ? "Active" : "Inactive"}</Badge><Button size="sm" variant="outline" onClick={() => setEditingPort((value) => !value)}><Pencil className="mr-1.5 h-3.5 w-3.5" />{editingPort ? "Cancel edit" : "Edit Port"}</Button><Button size="sm" variant="outline" onClick={() => setPortActiveMut.mutate(!detailQuery.data!.active)} disabled={setPortActiveMut.isPending}><Power className="mr-1.5 h-3.5 w-3.5" />{detailQuery.data.active ? "Deactivate" : "Activate"}</Button></div></div></CardHeader>
            <CardContent className="space-y-6">
              {editingPort ? <div className="rounded-lg border bg-muted/20 p-4"><PortFields value={portForm} onChange={setPortForm} prefix="edit-port" /><div className="mt-4 flex justify-end gap-2"><Button variant="outline" className="min-h-11" onClick={() => setEditingPort(false)}>Cancel</Button><Button className="min-h-11" onClick={() => updatePortMut.mutate()} disabled={updatePortMut.isPending}><Pencil className="mr-1.5 h-4 w-4" />Save Port</Button></div></div> : <div className="grid gap-3 text-sm sm:grid-cols-2"><Info label="Address" value={detailQuery.data.address} /><Info label="Coordinates" value={detailQuery.data.latitude == null ? "Not set" : `${detailQuery.data.latitude}, ${detailQuery.data.longitude}`} /></div>}
              <div className="border-t pt-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-medium">Berths</h2><p className="text-xs text-muted-foreground">Active and inactive berths for this port.</p></div></div><div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2"><Field label="Berth name" htmlFor="new-berth-name"><Input id="new-berth-name" value={berthForm.name} onChange={(event) => setBerthForm({ ...berthForm, name: event.target.value })} placeholder="e.g. Pinto Wharf" /></Field><Field label="Address override (optional)" htmlFor="new-berth-address"><Input id="new-berth-address" value={berthForm.address_override} onChange={(event) => setBerthForm({ ...berthForm, address_override: event.target.value })} /></Field><Field label="Latitude override" htmlFor="new-berth-lat"><Input id="new-berth-lat" value={berthForm.latitude_override} onChange={(event) => setBerthForm({ ...berthForm, latitude_override: event.target.value })} inputMode="decimal" /></Field><Field label="Longitude override" htmlFor="new-berth-lng"><Input id="new-berth-lng" value={berthForm.longitude_override} onChange={(event) => setBerthForm({ ...berthForm, longitude_override: event.target.value })} inputMode="decimal" /></Field><div className="sm:col-span-2 flex justify-end gap-2">{editingBerthId ? <Button type="button" variant="outline" className="min-h-11" onClick={() => { setEditingBerthId(null); setBerthForm(emptyBerth); }}>Cancel</Button> : null}<Button className="min-h-11" onClick={() => editingBerthId ? updateBerthMut.mutate() : createBerthMut.mutate()} disabled={(editingBerthId ? updateBerthMut.isPending : createBerthMut.isPending) || !berthForm.name.trim()}>{editingBerthId ? "Save Berth" : <><Plus className="mr-1.5 h-4 w-4" />Create Berth</>}</Button></div></div>
                <div className="mt-4 space-y-2">{detailQuery.data.berths.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No berths yet.</p> : detailQuery.data.berths.map((berth) => <div key={berth.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><div className="flex items-center gap-2"><span className="font-medium">{berth.name}</span><Badge variant={berth.active ? "secondary" : "outline"}>{berth.active ? "Active" : "Inactive"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{berth.address_override || "Uses port address"}</p></div><div className="flex flex-wrap gap-2">{editingBerthId === berth.id ? <><Button size="sm" variant="outline" onClick={() => { setEditingBerthId(null); setBerthForm(emptyBerth); }}>Cancel</Button><Button size="sm" onClick={() => updateBerthMut.mutate()} disabled={updateBerthMut.isPending}>Save</Button></> : <><Button size="sm" variant="outline" onClick={() => beginBerthEdit(berth)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button><Button size="sm" variant="outline" onClick={() => setBerthActiveMut.mutate({ id: berth.id, active: !berth.active })} disabled={setBerthActiveMut.isPending}><Power className="mr-1.5 h-3.5 w-3.5" />{berth.active ? "Deactivate" : "Activate"}</Button></>}</div></div>)}</div>
              </div>
            </CardContent>
          </> : null}
        </Card>
      </div>
    </div>
  );
}

function PortFields({ value, onChange, prefix }: { value: typeof emptyPort; onChange: (value: typeof emptyPort) => void; prefix: string }) {
  const set = (key: keyof typeof emptyPort, next: string) => onChange({ ...value, [key]: next });
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Port name" htmlFor={`${prefix}-name`}><Input id={`${prefix}-name`} value={value.name} onChange={(event) => set("name", event.target.value)} maxLength={200} placeholder="e.g. Valletta Freeport" /></Field><Field label="Port code (optional)" htmlFor={`${prefix}-code`}><Input id={`${prefix}-code`} value={value.code} onChange={(event) => set("code", event.target.value)} maxLength={32} placeholder="e.g. MLT" /></Field><Field label="Country" htmlFor={`${prefix}-country`}><Input id={`${prefix}-country`} value={value.country} onChange={(event) => set("country", event.target.value)} maxLength={120} placeholder="e.g. Malta" /></Field><Field label="Address" htmlFor={`${prefix}-address`}><Input id={`${prefix}-address`} value={value.address} onChange={(event) => set("address", event.target.value)} maxLength={300} className="sm:col-span-2 lg:col-span-3" /></Field><Field label="Latitude (optional)" htmlFor={`${prefix}-lat`}><Input id={`${prefix}-lat`} value={value.latitude} onChange={(event) => set("latitude", event.target.value)} inputMode="decimal" /></Field><Field label="Longitude (optional)" htmlFor={`${prefix}-lng`}><Input id={`${prefix}-lng`} value={value.longitude} onChange={(event) => set("longitude", event.target.value)} inputMode="decimal" /></Field></div>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>; }
function Info({ label, value }: { label: string; value: string }) { return <div><div className="text-xs text-muted-foreground">{label}</div><div>{value}</div></div>; }
