import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Eye, Pencil, Plus, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createPortalDefinition,
  duplicatePortalDefinition,
  listPortalDefinitions,
  setPortalDefinitionStatus,
  updatePortalDefinition,
} from "@/lib/portal-definitions.functions";

export const Route = createFileRoute("/_authenticated/coordinator/portal-creator")({
  head: () => ({ meta: [{ title: "Portal Creator — Coordinator" }] }),
  component: PortalCreatorPage,
});

const TYPES = ["corporate", "hr", "hotel", "crew_change", "conference", "event", "client", "custom"] as const;
const CAPABILITIES = [
  ["create_booking", "Create booking"], ["view_own_submissions", "View own submissions"],
  ["create_operation_group", "Create Operation Group"], ["select_operation_group", "Select Operation Group"],
  ["add_passengers", "Add passengers"], ["add_stops", "Add stops"],
  ["enter_flight_details", "Enter flight details"], ["enter_ship_details", "Enter Ship details"],
  ["add_notes", "Add notes"],
] as const;
type PortalRow = { id: string; name: string; description: string | null; portal_type: string; status: string; configuration: any };

function PortalCreatorPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPortalDefinitions);
  const createFn = useServerFn(createPortalDefinition);
  const updateFn = useServerFn(updatePortalDefinition);
  const duplicateFn = useServerFn(duplicatePortalDefinition);
  const statusFn = useServerFn(setPortalDefinitionStatus);
  const { data: portals = [], isLoading } = useQuery({ queryKey: ["portal-definitions"], queryFn: () => listFn() as Promise<PortalRow[]> });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = portals.find((p) => p.id === selectedId) ?? null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [portalType, setPortalType] = useState<(typeof TYPES)[number]>("custom");
  const [submissionMode, setSubmissionMode] = useState<"direct" | "approval_required">("direct");
  const [accent, setAccent] = useState("slate");
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({ create_booking: true, view_own_submissions: true });
  const isEditing = !!selected;
  const refresh = () => qc.invalidateQueries({ queryKey: ["portal-definitions"] });

  function edit(portal: PortalRow) {
    const config = portal.configuration ?? {};
    setSelectedId(portal.id); setName(portal.name); setDescription(portal.description ?? "");
    setPortalType((TYPES.includes(portal.portal_type as any) ? portal.portal_type : "custom") as any);
    setSubmissionMode(config.submission_mode === "approval_required" ? "approval_required" : "direct");
    setAccent(config.branding?.accent ?? "slate"); setCapabilities(config.capabilities ?? {});
  }
  function reset() { setSelectedId(null); setName(""); setDescription(""); setPortalType("custom"); setSubmissionMode("direct"); setAccent("slate"); setCapabilities({ create_booking: true, view_own_submissions: true }); }
  const configuration = useMemo(() => ({ submission_mode: submissionMode, branding: { accent }, capabilities }), [submissionMode, accent, capabilities]);
  const save = useMutation({
    mutationFn: () => isEditing ? updateFn({ data: { id: selected!.id, patch: { name, description: description || null, portal_type: portalType, configuration } } }) : createFn({ data: { name, description: description || null, portal_type: portalType, configuration } }),
    onSuccess: (row: any) => { toast.success(isEditing ? "Portal updated" : "Portal created"); refresh(); edit(row); },
    onError: (error: any) => toast.error(error?.message ?? "Could not save portal"),
  });
  const duplicate = useMutation({ mutationFn: (id: string) => duplicateFn({ data: { id } }), onSuccess: (row: any) => { toast.success("Portal duplicated"); refresh(); edit(row); }, onError: (e: any) => toast.error(e?.message ?? "Could not duplicate portal") });
  const changeStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: "draft" | "active" | "disabled" }) => statusFn({ data: { id, status } }), onSuccess: refresh, onError: (e: any) => toast.error(e?.message ?? "Could not change status") });

  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <div><h1 className="text-2xl font-semibold">Portal Creator</h1><p className="mt-1 text-sm text-muted-foreground">Configure reusable external portals over the existing booking workflows.</p></div>
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Portals</CardTitle><Button size="sm" variant="outline" onClick={reset}><Plus className="mr-1 h-4 w-4" />New</Button></CardHeader><CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && portals.length === 0 && <p className="text-sm text-muted-foreground">No Portal definitions yet.</p>}
        {portals.map((portal) => <div key={portal.id} className={`rounded-lg border p-3 ${selectedId === portal.id ? "border-primary" : ""}`}><div className="flex items-start justify-between gap-2"><button type="button" className="min-w-0 text-left" onClick={() => edit(portal)}><div className="font-medium">{portal.name}</div><div className="text-xs text-muted-foreground">{portal.portal_type.replaceAll("_", " ")}</div></button><Badge variant={portal.status === "active" ? "default" : portal.status === "disabled" ? "secondary" : "outline"}>{portal.status}</Badge></div><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => edit(portal)}><Pencil className="mr-1 h-3 w-3" />Edit</Button><Button size="sm" variant="ghost" onClick={() => duplicate.mutate(portal.id)}><Copy className="mr-1 h-3 w-3" />Duplicate</Button>{portal.status === "disabled" ? <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate({ id: portal.id, status: "draft" })}><Power className="mr-1 h-3 w-3" />Reactivate</Button> : <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate({ id: portal.id, status: "disabled" })}><PowerOff className="mr-1 h-3 w-3" />Disable</Button>}</div></div>)}
      </CardContent></Card>
      <div className="space-y-6">
        <Card><CardHeader><CardTitle className="text-base">{isEditing ? "Edit Portal" : "Create Portal"}</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div><Label>Portal name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard Hotel Portal" /></div><div><Label>Portal type</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={portalType} onChange={(e) => setPortalType(e.target.value as any)}>{TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div></div>
          <div><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this portal is used for" /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label>Submission mode</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={submissionMode} onChange={(e) => setSubmissionMode(e.target.value as any)}><option value="direct">Direct booking</option><option value="approval_required">Coordinator approval required</option></select></div><div><Label>Accent</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={accent} onChange={(e) => setAccent(e.target.value)}>{["slate", "blue", "teal", "amber", "rose", "violet"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div></div>
          <div><Label>Capabilities</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{CAPABILITIES.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!capabilities[key]} onChange={(e) => setCapabilities((current) => ({ ...current, [key]: e.target.checked }))} />{label}</label>)}</div></div>
          <div className="flex flex-wrap gap-2"><Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>{isEditing ? "Save changes" : "Create Portal"}</Button>{isEditing && <Button variant="outline" onClick={reset}>Cancel</Button>}</div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base"><Eye className="mr-2 inline h-4 w-4" />Configuration preview</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="font-medium">{name || "Untitled Portal"}</div><div className="text-muted-foreground">{portalType.replaceAll("_", " ")} · {submissionMode === "direct" ? "Direct booking" : "Coordinator approval"}</div><div className="flex flex-wrap gap-1">{Object.entries(capabilities).filter(([, enabled]) => enabled).map(([key]) => <Badge key={key} variant="outline">{key.replaceAll("_", " ")}</Badge>)}</div></CardContent></Card>
      </div>
    </div>
  </div>;
}
