import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CheckCircle2, Clock3, Copy, Download, Eye, LogIn, Pencil, Plus, Power, PowerOff, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createPortalDefinition,
  approvePortalSubmission,
  duplicatePortalDefinition,
  listPortalDefinitions,
  listPortalActivity,
  listPortalRecipients,
  listPortalSubmissions,
  issuePortalRecipient,
  rejectPortalSubmission,
  setPortalRecipientState,
  setPortalDefinitionStatus,
  updatePortalDefinition,
} from "@/lib/portal-definitions.functions";
import {
  normalizePortalBookingFields,
  PORTAL_BOOKING_FIELDS,
  type PortalBookingFieldConfiguration,
  type PortalBookingFieldMode,
} from "@/lib/portal-field-configuration";
import { downloadPortalBookingTemplate } from "@/lib/portal-booking-template";

const TYPES = ["corporate", "hr", "hotel", "crew_change", "conference", "event", "client", "custom"] as const;
const CAPABILITIES = [
  ["create_booking", "Create booking"], ["view_own_submissions", "View own submissions"],
  ["view_trips", "View trips and live status"], ["chat", "Client chat"],
  ["view_statements", "View statements"], ["manage_profile", "Manage portal profile"],
  ["manage_crew", "Manage hotel crew"],
  ["create_operation_group", "Create Operation Group"], ["select_operation_group", "Select Operation Group"],
  ["add_passengers", "Add passengers"], ["add_stops", "Add stops"],
  ["enter_flight_details", "Enter flight details"], ["enter_ship_details", "Enter Ship details"],
  ["add_notes", "Add notes"],
] as const;
type PortalRow = { id: string; name: string; description: string | null; portal_type: string; status: string; configuration: any };
const DEFAULT_CAPABILITIES: Record<string, boolean> = {
  create_booking: true, view_own_submissions: true, view_trips: true,
  chat: true, view_statements: true, manage_profile: true, manage_crew: false,
};

export function PortalCreatorWorkspace({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPortalDefinitions);
  const createFn = useServerFn(createPortalDefinition);
  const updateFn = useServerFn(updatePortalDefinition);
  const duplicateFn = useServerFn(duplicatePortalDefinition);
  const statusFn = useServerFn(setPortalDefinitionStatus);
  const { data: portals = [], isLoading } = useQuery({ queryKey: ["portal-definitions"], queryFn: () => listFn() as unknown as Promise<PortalRow[]> });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = portals.find((p) => p.id === selectedId) ?? null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [portalType, setPortalType] = useState<(typeof TYPES)[number]>("custom");
  const [submissionMode, setSubmissionMode] = useState<"direct" | "approval_required">("direct");
  const [accent, setAccent] = useState("slate");
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>(DEFAULT_CAPABILITIES);
  const [bookingFields, setBookingFields] = useState<PortalBookingFieldConfiguration>(() => normalizePortalBookingFields(undefined, DEFAULT_CAPABILITIES));
  const isEditing = !!selected;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["portal-definitions"] });
    qc.invalidateQueries({ queryKey: ["portal-company-setup"] });
  };

  function edit(portal: PortalRow) {
    const config = portal.configuration ?? {};
    setSelectedId(portal.id); setName(portal.name); setDescription(portal.description ?? "");
    setPortalType((TYPES.includes(portal.portal_type as any) ? portal.portal_type : "custom") as any);
    setSubmissionMode(config.submission_mode === "approval_required" ? "approval_required" : "direct");
    const nextCapabilities = { ...DEFAULT_CAPABILITIES, ...(config.capabilities ?? {}) };
    setAccent(config.branding?.accent ?? "slate"); setCapabilities(nextCapabilities);
    setBookingFields(normalizePortalBookingFields(config.booking_fields, nextCapabilities));
  }
  function reset() { setSelectedId(null); setName(""); setDescription(""); setPortalType("custom"); setSubmissionMode("direct"); setAccent("slate"); setCapabilities(DEFAULT_CAPABILITIES); setBookingFields(normalizePortalBookingFields(undefined, DEFAULT_CAPABILITIES)); }
  const normalizedFields = useMemo(() => normalizePortalBookingFields(bookingFields, capabilities), [bookingFields, capabilities]);
  const configuration = useMemo(() => ({ submission_mode: submissionMode, branding: { accent }, capabilities, booking_fields: normalizedFields }), [submissionMode, accent, capabilities, normalizedFields]);
  function changeCapability(key: string, enabled: boolean) {
    setCapabilities((current) => ({ ...current, [key]: enabled }));
    const field = PORTAL_BOOKING_FIELDS.find((definition) => "capability" in definition && definition.capability === key);
    if (field) setBookingFields((current) => ({ ...current, [field.key]: { mode: enabled ? field.defaultMode : "hidden" } }));
  }
  const save = useMutation({
    mutationFn: () => isEditing ? updateFn({ data: { id: selected!.id, patch: { name, description: description || null, portal_type: portalType, configuration } } }) : createFn({ data: { name, description: description || null, portal_type: portalType, configuration } }),
    onSuccess: (row: any) => { toast.success(isEditing ? "Portal updated" : "Portal created"); refresh(); edit(row); },
    onError: (error: any) => toast.error(error?.message ?? "Could not save portal"),
  });
  const duplicate = useMutation({ mutationFn: (id: string) => duplicateFn({ data: { id } }), onSuccess: (row: any) => { toast.success("Portal duplicated"); refresh(); edit(row); }, onError: (e: any) => toast.error(e?.message ?? "Could not duplicate portal") });
  const changeStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: "draft" | "active" | "disabled" }) => statusFn({ data: { id, status } }), onSuccess: refresh, onError: (e: any) => toast.error(e?.message ?? "Could not change status") });

  return <div className={embedded ? "space-y-6" : "mx-auto max-w-6xl space-y-6 p-4 md:p-8"}>
    {!embedded && <div><h1 className="text-2xl font-semibold">Portal Creator</h1><p className="mt-1 text-sm text-muted-foreground">Configure reusable external portals over the existing booking workflows.</p></div>}
    {embedded && <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Build and preview reusable portal templates here. Activate a template, then assign it to a company from the Companies tab.</div>}
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Portals</CardTitle><Button size="sm" variant="outline" onClick={reset}><Plus className="mr-1 h-4 w-4" />New</Button></CardHeader><CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && portals.length === 0 && <p className="text-sm text-muted-foreground">No Portal definitions yet.</p>}
        {portals.map((portal) => <div key={portal.id} className={`rounded-lg border p-3 ${selectedId === portal.id ? "border-primary" : ""}`}><div className="flex items-start justify-between gap-2"><button type="button" className="min-w-0 text-left" onClick={() => edit(portal)}><div className="font-medium">{portal.name}</div><div className="text-xs text-muted-foreground">{portal.portal_type.replaceAll("_", " ")}</div></button><Badge variant={portal.status === "active" ? "default" : portal.status === "disabled" ? "secondary" : "outline"}>{portal.status}</Badge></div><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => edit(portal)}><Pencil className="mr-1 h-3 w-3" />Edit</Button><Button size="sm" variant="ghost" onClick={() => duplicate.mutate(portal.id)}><Copy className="mr-1 h-3 w-3" />Duplicate</Button>{portal.status === "draft" && <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate({ id: portal.id, status: "active" })}><Power className="mr-1 h-3 w-3" />Activate</Button>}{portal.status === "active" && <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate({ id: portal.id, status: "disabled" })}><PowerOff className="mr-1 h-3 w-3" />Disable</Button>}{portal.status === "disabled" && <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate({ id: portal.id, status: "draft" })}><Power className="mr-1 h-3 w-3" />Reactivate</Button>}</div></div>)}
      </CardContent></Card>
      <div className="space-y-6">
        <Card><CardHeader><CardTitle className="text-base">{isEditing ? "Edit Portal" : "Create Portal"}</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div><Label>Portal name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard Hotel Portal" /></div><div><Label>Portal type</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={portalType} onChange={(e) => setPortalType(e.target.value as any)}>{TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div></div>
          <div><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this portal is used for" /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label>Submission mode</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={submissionMode} onChange={(e) => setSubmissionMode(e.target.value as any)}><option value="direct">Direct booking</option><option value="approval_required">Coordinator approval required</option></select></div><div><Label>Accent</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={accent} onChange={(e) => setAccent(e.target.value)}>{["slate", "blue", "teal", "amber", "rose", "violet"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div></div>
          <div><Label>Capabilities</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{CAPABILITIES.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!capabilities[key]} onChange={(e) => changeCapability(key, e.target.checked)} />{label}</label>)}</div></div>
          <div className="space-y-2"><div><Label>Booking fields</Label><p className="text-xs text-muted-foreground">Choose what recipients must complete. Core journey fields stay required.</p></div><div className="divide-y rounded-md border">{PORTAL_BOOKING_FIELDS.map((field) => {
            const capabilityDisabled = "capability" in field && capabilities[field.capability] !== true;
            const locked = "locked" in field && field.locked;
            return <div key={field.key} className="flex items-center justify-between gap-3 p-3"><div><div className="text-sm font-medium">{field.label}</div>{capabilityDisabled && <div className="text-xs text-muted-foreground">Enable its capability to use this field.</div>}</div><select aria-label={`${field.label} field mode`} className="h-9 rounded-md border bg-background px-2 text-sm" value={normalizedFields[field.key].mode} disabled={locked || capabilityDisabled} onChange={(event) => setBookingFields((current) => ({ ...current, [field.key]: { mode: event.target.value as PortalBookingFieldMode } }))}><option value="required">Required</option><option value="optional">Optional</option><option value="hidden">Hidden</option></select></div>;
          })}</div></div>
          <div className="flex flex-wrap gap-2"><Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>{isEditing ? "Save changes" : "Create Portal"}</Button>{isEditing && <Button variant="outline" onClick={reset}>Cancel</Button>}</div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base"><Eye className="mr-2 inline h-4 w-4" />Configuration preview</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="font-medium">{name || "Untitled Portal"}</div><div className="text-muted-foreground">{portalType.replaceAll("_", " ")} · {submissionMode === "direct" ? "Direct booking" : "Coordinator approval"}</div><div className="flex flex-wrap gap-1">{Object.entries(capabilities).filter(([, enabled]) => enabled).map(([key]) => <Badge key={key} variant="outline">{key.replaceAll("_", " ")}</Badge>)}</div><div><div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Booking fields</div><div className="flex flex-wrap gap-1">{PORTAL_BOOKING_FIELDS.filter((field) => normalizedFields[field.key].mode !== "hidden").map((field) => <Badge key={field.key} variant={normalizedFields[field.key].mode === "required" ? "default" : "secondary"}>{field.label} · {normalizedFields[field.key].mode}</Badge>)}</div></div>{capabilities.create_booking && <Button size="sm" variant="outline" onClick={() => void downloadPortalBookingTemplate(name || "Portal", normalizedFields)}><Download className="mr-1 h-4 w-4" />Download spreadsheet template</Button>}</CardContent></Card>
      </div>
    </div>
  </div>;
}
function ApprovalPanel({ portal }: { portal: PortalRow }) {
  const listFn = useServerFn(listPortalSubmissions);
  const approveFn = useServerFn(approvePortalSubmission);
  const rejectFn = useServerFn(rejectPortalSubmission);
  const qc = useQueryClient();
  const queryKey = ["portal-submissions", portal.id];
  const { data: submissions = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { portal_id: portal.id } }) as Promise<any[]>,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["portal-activity", portal.id] });
  };
  const approve = useMutation({
    mutationFn: (id: string) => approveFn({ data: { id } }),
    onSuccess: () => { toast.success("Submission approved and booking created"); refresh(); },
    onError: (error: any) => toast.error(error?.message ?? "Could not approve submission"),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { id } }),
    onSuccess: () => { toast.success("Submission rejected"); refresh(); },
    onError: (error: any) => toast.error(error?.message ?? "Could not reject submission"),
  });

  return <Card><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Coordinator approval</CardTitle><Badge variant={submissions.length ? "default" : "outline"}>{submissions.length} waiting</Badge></CardHeader><CardContent className="space-y-3">
    {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
    {!isLoading && submissions.length === 0 && <p className="text-sm text-muted-foreground">No submissions awaiting approval.</p>}
    {submissions.map((submission: any) => {
      const payload = submission.payload ?? {};
      const recipient = submission.portal_recipients ?? {};
      const passengers = Array.isArray(payload.passengers) ? payload.passengers.map((passenger: any) => passenger.name).filter(Boolean).join(", ") : "";
      const approving = submission.status === "approving";
      return <div key={submission.id} className="space-y-2 rounded-md border p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-medium">{passengers || payload.clientcompanyname || "Portal booking"}</div><div className="text-xs text-muted-foreground">{recipient.recipient_name || "Recipient"} · {recipient.recipient_company || ""}</div></div><Badge variant="outline">{approving ? "Approving" : "Pending"}</Badge></div>
        <div>{payload.from_location} → {payload.to_location}</div>
        <div className="text-xs text-muted-foreground">{payload.date} · {payload.time}</div>
        {payload.notes && <div className="text-xs text-muted-foreground">{payload.notes}</div>}
        <div className="flex gap-2"><Button size="sm" onClick={() => approve.mutate(submission.id)} disabled={approving || approve.isPending || reject.isPending}>Approve & create booking</Button><Button size="sm" variant="outline" onClick={() => reject.mutate(submission.id)} disabled={approving || approve.isPending || reject.isPending}>Reject</Button></div>
      </div>;
    })}
  </CardContent></Card>;
}

function RecipientsPanel({ portal }: { portal: PortalRow }) {
  const listFn = useServerFn(listPortalRecipients);
  const issueFn = useServerFn(issuePortalRecipient);
  const stateFn = useServerFn(setPortalRecipientState);
  const qc = useQueryClient();
  const { data: recipients = [] } = useQuery({ queryKey: ["portal-recipients", portal.id], queryFn: () => listFn({ data: { portal_id: portal.id } }) as Promise<any[]> });
  const [company, setCompany] = useState("");
  const [recipient, setRecipient] = useState("");
  const [expires, setExpires] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const issue = useMutation({
    mutationFn: () => issueFn({ data: { portal_id: portal.id, recipient_company: company, recipient_name: recipient, expires_at: expires ? new Date(expires).toISOString() : null } }),
    onSuccess: (result: any) => { setNewToken(result.token); setCompany(""); setRecipient(""); setExpires(""); qc.invalidateQueries({ queryKey: ["portal-recipients", portal.id] }); qc.invalidateQueries({ queryKey: ["portal-activity", portal.id] }); toast.success("Portal access issued"); },
    onError: (e: any) => toast.error(e?.message ?? "Could not issue access"),
  });
  const state = useMutation({ mutationFn: (input: { id: string; action: "revoke" | "disable" | "reactivate" }) => stateFn({ data: input }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["portal-recipients", portal.id] }); qc.invalidateQueries({ queryKey: ["portal-activity", portal.id] }); }, onError: (e: any) => toast.error(e?.message ?? "Could not update access") });
  return <Card><CardHeader><CardTitle className="text-base">Recipients & secure access</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid gap-2 sm:grid-cols-3"><Input placeholder="Recipient company" value={company} onChange={(e) => setCompany(e.target.value)} /><Input placeholder="Recipient name" value={recipient} onChange={(e) => setRecipient(e.target.value)} /><Input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} /></div><Button size="sm" onClick={() => issue.mutate()} disabled={!company.trim() || !recipient.trim() || issue.isPending}>Issue access</Button>{newToken && <div className="rounded-md border bg-muted p-2 text-xs"><div className="font-medium">Copy this secure link now; the token is not stored in plaintext.</div><code className="break-all">{`${typeof window !== "undefined" ? window.location.origin : ""}/portal/creator/${newToken}`}</code><Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/creator/${newToken}`)}><Copy className="mr-1 h-3 w-3" />Copy</Button></div>}<div className="space-y-2">{recipients.map((row: any) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"><div><div className="font-medium">{row.recipient_name} · {row.recipient_company}</div><div className="text-xs text-muted-foreground">{row.revoked_at ? "Revoked" : row.disabled_at ? "Disabled" : "Active"}{row.last_accessed_at ? ` · Last accessed ${new Date(row.last_accessed_at).toLocaleString()}` : ""}</div></div>{!row.revoked_at && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => state.mutate({ id: row.id, action: row.disabled_at ? "reactivate" : "disable" })}>{row.disabled_at ? "Reactivate" : "Disable"}</Button><Button size="sm" variant="ghost" onClick={() => state.mutate({ id: row.id, action: "revoke" })}>Revoke</Button></div>}</div>)}</div></CardContent></Card>;
}

const RECIPIENT_ACTIONS: Record<string, { label: string; icon: typeof Activity }> = {
  issued: { label: "Access issued", icon: Power },
  accessed: { label: "Portal accessed", icon: LogIn },
  revoked: { label: "Access revoked", icon: PowerOff },
  disabled: { label: "Access disabled", icon: PowerOff },
  reactivated: { label: "Access reactivated", icon: Power },
};

function recipientLabel(recipient: any) {
  return [recipient?.recipient_name, recipient?.recipient_company].filter(Boolean).join(" · ") || "Portal recipient";
}

function PortalActivityPanel({ portal }: { portal: PortalRow }) {
  const listFn = useServerFn(listPortalActivity);
  const recipientsFn = useServerFn(listPortalRecipients);
  const { data, isLoading, isFetching: isActivityFetching, error: activityError, refetch: refetchActivity } = useQuery({
    queryKey: ["portal-activity", portal.id],
    queryFn: () => listFn({ data: { portal_id: portal.id } }) as Promise<any>,
  });
  const { data: recipients = [], isFetching: areRecipientsFetching, error: recipientsError, refetch: refetchRecipients } = useQuery({
    queryKey: ["portal-recipients", portal.id],
    queryFn: () => recipientsFn({ data: { portal_id: portal.id } }) as Promise<any[]>,
  });
  const events = useMemo(() => {
    const rows: Array<{ id: string; at: string; title: string; detail: string; badge: string; icon: typeof Activity }> = [];
    const recipientById = new Map(recipients.map((recipient: any) => [recipient.id, recipient]));
    for (const row of data?.recipient_activity ?? []) {
      const action = RECIPIENT_ACTIONS[row.action] ?? { label: row.action, icon: Activity };
      rows.push({ id: `access-${row.id}`, at: row.created_at, title: action.label, detail: recipientLabel(recipientById.get(row.portal_recipient_id)), badge: "access", icon: action.icon });
    }
    for (const submission of data?.submissions ?? []) {
      const recipient = recipientLabel(recipientById.get(submission.portal_recipient_id));
      const payload = submission.payload ?? {};
      const journey = [payload.from_location, payload.to_location].filter(Boolean).join(" → ");
      rows.push({ id: `submitted-${submission.id}`, at: submission.created_at, title: "Booking submitted", detail: [recipient, journey].filter(Boolean).join(" · "), badge: "submission", icon: Clock3 });
      if (submission.status === "approved" && submission.decided_at) rows.push({ id: `approved-${submission.id}`, at: submission.decided_at, title: "Booking approved", detail: `${recipient}${submission.job_id ? ` · Job ${submission.job_id.slice(0, 8)}` : ""}`, badge: "approved", icon: CheckCircle2 });
      if (submission.status === "rejected" && submission.decided_at) rows.push({ id: `rejected-${submission.id}`, at: submission.decided_at, title: "Booking rejected", detail: [recipient, submission.rejection_reason].filter(Boolean).join(" · "), badge: "rejected", icon: XCircle });
    }
    for (const booking of data?.direct_bookings ?? []) {
      const recipientId = String(booking.source ?? "").split(":")[2];
      const recipient = recipientLabel(recipientById.get(recipientId));
      const journey = [booking.from_location, booking.to_location].filter(Boolean).join(" → ");
      rows.push({ id: `direct-${booking.id}`, at: booking.created_at, title: "Direct booking created", detail: [recipient, journey].filter(Boolean).join(" · "), badge: "direct", icon: CheckCircle2 });
    }
    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 50);
  }, [data, recipients]);
  const submissions = data?.submissions ?? [];
  const counts = {
    active: recipients.filter((row: any) => !row.revoked_at && !row.disabled_at && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now())).length,
    waiting: submissions.filter((row: any) => row.status === "pending" || row.status === "approving").length,
    approved: submissions.filter((row: any) => row.status === "approved").length,
    rejected: submissions.filter((row: any) => row.status === "rejected").length,
  };
  const issues = [...(data?.issues ?? []), ...(activityError ? ["management activity"] : []), ...(recipientsError ? ["recipient access"] : [])];
  const isFetching = isActivityFetching || areRecipientsFetching;
  return <Card><CardHeader className="flex-row items-center justify-between gap-3"><div><CardTitle className="text-base"><Activity className="mr-2 inline h-4 w-4" />Portal management & activity</CardTitle><p className="mt-1 text-xs text-muted-foreground">Recipient access and booking decisions for this Portal.</p></div><Button size="sm" variant="outline" onClick={() => void Promise.all([refetchActivity(), refetchRecipients()])} disabled={isFetching}><RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button></CardHeader><CardContent className="space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Active access", counts.active], ["Waiting", counts.waiting], ["Approved", counts.approved], ["Rejected", counts.rejected]].map(([label, value]) => <div key={String(label)} className="rounded-md border p-2"><div className="text-lg font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>)}</div>
    {isLoading && <p className="text-sm text-muted-foreground">Loading activity…</p>}
    {issues.length > 0 && <p className="text-sm text-destructive">Some activity could not be loaded: {issues.join(", ")}.</p>}
    {!isLoading && issues.length === 0 && events.length === 0 && <p className="text-sm text-muted-foreground">No Portal activity yet.</p>}
    <div className="space-y-2">{events.map((event) => { const Icon = event.icon; return <div key={event.id} className="flex items-start gap-3 rounded-md border p-3 text-sm"><div className="rounded-full bg-muted p-2"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{event.title}</span><Badge variant="outline">{event.badge}</Badge></div><div className="mt-1 break-words text-xs text-muted-foreground">{event.detail}</div><div className="mt-1 text-xs text-muted-foreground">{new Date(event.at).toLocaleString()}</div></div></div>; })}</div>
  </CardContent></Card>;
}
