import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Clock3, Plus, ShieldCheck, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { AddressAutocomplete, type AddressPick } from "@/components/address/AddressAutocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  coordinatorPortalOperationAction,
  listCoordinatorPortalOperations,
} from "@/lib/portal-operations.functions";
import type { PortalOperationAction } from "@/lib/portal-operation-schemas";

type Mode = "coordinator" | "client";
type WorkspaceProps = {
  mode: Mode;
  portalName: string;
  portalCompanyId?: string;
  token?: string;
};

const SERVICE_TYPES = [
  "flight",
  "hotel",
  "transfer",
  "driver",
  "meet_greet",
  "visitor",
  "document",
  "other",
] as const;

type ServiceType = (typeof SERVICE_TYPES)[number];
type WithoutActor<T> = T extends { actor_name: string } ? Omit<T, "actor_name"> : never;
type WorkspaceAction = WithoutActor<PortalOperationAction>;
type GroupRow = {
  id: string;
  reference: string;
  name: string;
  status: string;
  notes: string | null;
  crew_count: number;
  visitor_count: number;
};
type MemberRow = {
  id: string;
  operation_group_id: string;
  side: Mode;
  role: string;
  name: string;
  email: string | null;
  is_primary_approver: boolean;
  active: boolean;
  person_type: "crew" | "visitor";
  organisation: string | null;
  movement_type: "on_signing" | "off_signing" | "visitor" | "other";
  flight_information: string | null;
  hotel_required: boolean;
  transport_required: boolean;
  visit_start_date?: string | null;
  visit_end_date?: string | null;
  notes: string | null;
};
type ServiceRow = {
  id: string;
  operation_group_id: string;
  service_type: ServiceType;
  title: string;
  provider: string | null;
  location_name: string | null;
  location_address: string | null;
  location_place_id: string | null;
  location_lat: number | null;
  location_lng: number | null;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
  amount: number | string | null;
  currency: string;
  booking_state: "draft" | "on_hold" | "confirmed" | "cancelled";
  hold_expires_at: string | null;
  approval_status: string;
  revision: number;
  created_by_side: Mode;
  created_by_name: string;
  coordinator_approved_revision: number | null;
  client_approved_revision: number | null;
  change_request_reason: string | null;
  emergency_policy_id: string | null;
  client_acknowledged_at: string | null;
};
type EventRow = {
  id: string;
  operation_group_id: string;
  actor_name: string;
  event_type: string;
  service_revision: number | null;
  created_at: string;
};
type EmergencyPolicyRow = {
  id: string;
  enabled: boolean;
  currency: string;
  per_booking_limit: number | string;
  per_operation_limit: number | string;
  allowed_service_types: string[];
  supporting_document_required: boolean;
  revision: number;
  client_approved_revision: number | null;
};
type WorkspaceData = {
  groups: GroupRow[];
  members: MemberRow[];
  services: ServiceRow[];
  events: EventRow[];
  emergency_policy: EmergencyPolicyRow | null;
};

function hasCreatedGroup(value: unknown): value is { group: { id: string } } {
  if (!value || typeof value !== "object" || !("group" in value)) return false;
  const group = value.group;
  return !!group && typeof group === "object" && "id" in group && typeof group.id === "string";
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  awaiting_client: "Awaiting client",
  awaiting_coordinator: "Awaiting coordinator",
  approved_by_both: "Approved by both",
  change_requested: "Change requested",
};

function displayDate(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

function isoFromLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function localFromIso(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function CoordinatorOperationsButton({
  portalCompanyId,
  portalName,
}: {
  portalCompanyId: string;
  portalName: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Operations workspace">
          <UsersRound className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Operations — {portalName}</DialogTitle>
        </DialogHeader>
        <OperationsWorkspace
          mode="coordinator"
          portalCompanyId={portalCompanyId}
          portalName={portalName}
        />
      </DialogContent>
    </Dialog>
  );
}

export function OperationsWorkspace({ mode, portalName, portalCompanyId, token }: WorkspaceProps) {
  const listCoordinator = useServerFn(listCoordinatorPortalOperations);
  const coordinatorAction = useServerFn(coordinatorPortalOperationAction);
  const queryKey = ["portal-operations", mode, portalCompanyId ?? token];
  const [actorName, setActorName] = useState(mode === "coordinator" ? "Coordinator" : "");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "client") return;
    setActorName(localStorage.getItem(`portal-operations-name-${token}`) ?? "");
  }, [mode, token]);

  const query = useQuery<WorkspaceData>({
    queryKey,
    queryFn: async () => {
      if (mode === "coordinator") {
        return listCoordinator({
          data: { portal_company_id: portalCompanyId! },
        }) as unknown as Promise<WorkspaceData>;
      }
      const response = await fetch(`/api/public/portal/${token}/operations`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load operations.");
      return payload as WorkspaceData;
    },
    refetchInterval: 20_000,
  });

  const action = useMutation<unknown, Error, WorkspaceAction>({
    mutationFn: async (operationAction) => {
      const withActor = {
        ...operationAction,
        actor_name: actorName.trim() || "Client",
      } as PortalOperationAction;
      if (mode === "coordinator") {
        return coordinatorAction({
          data: {
            portal_company_id: portalCompanyId!,
            operation_action: withActor,
          },
        });
      }
      const response = await fetch(`/api/public/portal/${token}/operations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withActor),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Operation could not be updated.");
      return payload;
    },
    onSuccess: async () => {
      await query.refetch();
    },
    onError: (error: Error) =>
      toast.error(
        error.message === "revision_conflict"
          ? "This item changed in another window. It has been refreshed."
          : error.message,
      ),
  });

  const groups = query.data?.groups ?? [];
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const services = (query.data?.services ?? []).filter(
    (service) => service.operation_group_id === selectedGroup?.id,
  );
  const members = (query.data?.members ?? []).filter(
    (member) => member.operation_group_id === selectedGroup?.id,
  );
  const events = (query.data?.events ?? []).filter(
    (event) => event.operation_group_id === selectedGroup?.id,
  );

  if (query.isLoading)
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Loading Operations Workspace…
      </div>
    );
  if (query.error)
    return (
      <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
        {query.error.message}
      </div>
    );

  return (
    <div className="space-y-5">
      {mode === "client" && (
        <Card>
          <CardContent className="pt-5">
            <div className="max-w-sm space-y-1.5">
              <Label>Your name</Label>
              <Input
                value={actorName}
                placeholder="Name used in approvals"
                onChange={(event) => setActorName(event.target.value)}
                onBlur={() =>
                  localStorage.setItem(`portal-operations-name-${token}`, actorName.trim())
                }
              />
              <p className="text-xs text-muted-foreground">
                Your name is recorded beside every draft, approval and change request.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <EmergencyPolicyCard
        mode={mode}
        policy={query.data?.emergency_policy}
        actorReady={!!actorName.trim()}
        busy={action.isPending}
        onAction={(value) => action.mutateAsync(value)}
      />

      <CreateOperationCard
        mode={mode}
        portalName={portalName}
        actorReady={!!actorName.trim()}
        busy={action.isPending}
        onCreated={async (value) => {
          const result = await action.mutateAsync(value);
          if (hasCreatedGroup(result)) setSelectedGroupId(result.group.id);
          toast.success("Crew-change draft created");
        }}
      />

      {groups.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Operations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`w-full rounded-lg border p-3 text-left ${selectedGroup?.id === group.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{group.reference}</span>
                    <Badge variant="outline">{group.status}</Badge>
                  </div>
                  <div className="mt-1 text-sm">{group.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {group.crew_count} crew · {group.visitor_count} visitors
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {selectedGroup && (
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{selectedGroup.name}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedGroup.reference} · {selectedGroup.crew_count} crew ·{" "}
                        {selectedGroup.visitor_count} visitors
                      </p>
                    </div>
                    <Badge>{selectedGroup.status}</Badge>
                  </div>
                </CardHeader>
                {selectedGroup.notes && (
                  <CardContent className="pt-0 text-sm text-muted-foreground">
                    {selectedGroup.notes}
                  </CardContent>
                )}
              </Card>

              {mode === "coordinator" ? (
                <MembersCard
                  groupId={selectedGroup.id}
                  members={members}
                  busy={action.isPending}
                  onAction={(value) => action.mutateAsync(value)}
                />
              ) : (
                <ClientPeopleCard
                  groupId={selectedGroup.id}
                  members={members}
                  busy={action.isPending}
                  onAction={(value) => action.mutateAsync(value)}
                />
              )}

              <ServiceEditor
                mode={mode}
                token={token}
                operationGroupId={selectedGroup.id}
                actorReady={!!actorName.trim()}
                busy={action.isPending}
                onAction={async (value) => {
                  await action.mutateAsync(value);
                  toast.success("Service draft added");
                }}
              />

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Services and approvals</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {services.length === 0 && (
                    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No services yet. Add the client’s flight first, then hotel, transfers and
                      visitor arrangements.
                    </p>
                  )}
                  {services.map((service) => (
                    <ServiceCard
                      key={service.id}
                      mode={mode}
                      token={token}
                      service={service}
                      policy={query.data?.emergency_policy}
                      actorReady={!!actorName.trim()}
                      busy={action.isPending}
                      onAction={async (value, message) => {
                        await action.mutateAsync(value);
                        toast.success(message);
                      }}
                    />
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Audit history</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {events.slice(0, 20).map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start justify-between gap-3 border-b py-2 text-xs last:border-0"
                    >
                      <div>
                        <span className="font-medium">{event.actor_name}</span> ·{" "}
                        {event.event_type.replaceAll("_", " ")}{" "}
                        {event.service_revision ? `· revision ${event.service_revision}` : ""}
                      </div>
                      <span className="shrink-0 text-muted-foreground">
                        {displayDate(event.created_at)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateOperationCard({
  mode,
  portalName,
  actorReady,
  busy,
  onCreated,
}: {
  mode: Mode;
  portalName: string;
  actorReady: boolean;
  busy: boolean;
  onCreated: (value: WorkspaceAction) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: `${portalName} crew change`,
    start_date: "",
    end_date: "",
    crew_count: "0",
    visitor_count: "0",
    notes: "",
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Create a crew-change draft</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Both sides can add services. Nothing is confirmed until the approval rules are
            satisfied.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen((value) => !value)}>
          <Plus className="mr-1 h-4 w-4" />
          New draft
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Field label="Operation name">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start">
              <Input
                type="date"
                value={form.start_date}
                onChange={(event) => setForm({ ...form, start_date: event.target.value })}
              />
            </Field>
            <Field label="End">
              <Input
                type="date"
                value={form.end_date}
                onChange={(event) => setForm({ ...form, end_date: event.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Crew">
              <Input
                type="number"
                min={0}
                value={form.crew_count}
                onChange={(event) => setForm({ ...form, crew_count: event.target.value })}
              />
            </Field>
            <Field label="Visitors">
              <Input
                type="number"
                min={0}
                value={form.visitor_count}
                onChange={(event) => setForm({ ...form, visitor_count: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
          <div className="md:col-span-2 flex justify-end">
            <Button
              disabled={!actorReady || !form.name.trim() || busy}
              onClick={async () => {
                await onCreated({
                  action: "create_operation",
                  name: form.name,
                  start_date: form.start_date || null,
                  end_date: form.end_date || null,
                  crew_count: Number(form.crew_count) || 0,
                  visitor_count: Number(form.visitor_count) || 0,
                  notes: form.notes || null,
                });
                setOpen(false);
              }}
            >
              {mode === "client" ? "Save client draft" : "Save coordinator draft"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function MembersCard({
  groupId,
  members,
  busy,
  onAction,
}: {
  groupId: string;
  members: MemberRow[];
  busy: boolean;
  onAction: (value: WorkspaceAction) => Promise<unknown>;
}) {
  const [form, setForm] = useState<{
    name: string;
    email: string;
    side: Mode;
    role: string;
    primary: boolean;
  }>({
    name: "",
    email: "",
    side: "client",
    role: "client_approver",
    primary: true,
  });
  const roles = useMemo(
    () =>
      form.side === "client"
        ? ["client_approver", "client_editor", "client_viewer"]
        : ["lead_coordinator", "coordinator_approver", "operations_member", "driver"],
    [form.side],
  );
  useEffect(() => {
    if (!roles.includes(form.role)) setForm((current) => ({ ...current, role: roles[0] }));
  }, [form.role, roles]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Operations Group</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {members.map((member) => (
            <Badge key={member.id} variant={member.is_primary_approver ? "default" : "outline"}>
              {member.name} · {member.role.replaceAll("_", " ")}
              {member.is_primary_approver ? " · primary" : ""}
            </Badge>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <Input
            placeholder="Member name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <Input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
          <select
            className="h-10 rounded-md border bg-background px-2 text-sm"
            value={form.side}
            onChange={(event) =>
              setForm({
                ...form,
                side: event.target.value as Mode,
                role: event.target.value === "client" ? "client_approver" : "lead_coordinator",
              })
            }
          >
            <option value="client">Client</option>
            <option value="coordinator">Coordinator</option>
          </select>
          <select
            className="h-10 rounded-md border bg-background px-2 text-sm"
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={!form.name.trim() || busy}
            onClick={async () => {
              await onAction({
                action: "add_member",
                operation_group_id: groupId,
                side: form.side,
                role: form.role as
                  | "lead_coordinator"
                  | "operations_member"
                  | "coordinator_approver"
                  | "client_editor"
                  | "client_approver"
                  | "client_viewer"
                  | "driver",
                name: form.name,
                email: form.email || null,
                is_primary_approver: form.primary,
              });
              setForm({ ...form, name: "", email: "", primary: false });
              toast.success("Operations Group member added");
            }}
          >
            Add member
          </Button>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.primary}
            onChange={(event) => setForm({ ...form, primary: event.target.checked })}
          />
          Make this person the primary approver for their side
        </label>
      </CardContent>
    </Card>
  );
}

function ClientPeopleCard({
  groupId,
  members,
  busy,
  onAction,
}: {
  groupId: string;
  members: MemberRow[];
  busy: boolean;
  onAction: (value: WorkspaceAction) => Promise<unknown>;
}) {
  const blank = {
    name: "",
    email: "",
    person_type: "crew" as const,
    organisation: "",
    movement_type: "other" as const,
    flight_information: "",
    hotel_required: false,
    transport_required: false,
    notes: "",
  };
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [multiple, setMultiple] = useState("");
  const activePeople = members.filter((member) => member.side === "client" && member.active);
  const suggestions = activePeople.reduce((counts, person) => {
    if (!person.transport_required) return counts;
    const label = person.person_type === "visitor"
      ? (person.hotel_required ? "Hotel ↔ Ship" : "Airport → Ship")
      : (person.movement_type === "off_signing" ? "Ship → Airport" : "Airport → Ship");
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const save = async () => {
    const base = {
      operation_group_id: groupId,
      name: form.name,
      email: form.email || null,
      person_type: form.person_type,
      organisation: form.organisation || null,
      movement_type: form.movement_type,
      flight_information: form.flight_information || null,
      hotel_required: form.hotel_required,
      transport_required: form.transport_required,
      notes: form.notes || null,
    };
    const result = await onAction(
      editingId
        ? { action: "update_member", member_id: editingId, ...base }
        : {
            action: "add_member",
            side: "client",
            role: "client_viewer",
            is_primary_approver: false,
            ...base,
          },
    );
    const review = !!(result && typeof result === "object" && "review_required" in result && result.review_required);
    toast.success(review ? "Saved; coordinator review is required" : editingId ? "Person updated" : "Person added");
    setForm(blank);
    setEditingId(null);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">People in this operation</CardTitle>
        <p className="text-xs text-muted-foreground">
          Add crew and visitors here. This does not create transport automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.keys(suggestions).length > 0 && <div className="rounded-lg border border-dashed bg-muted/20 p-3"><div className="text-xs font-semibold">Suggested transport (review only)</div><div className="mt-1 space-y-0.5 text-xs text-muted-foreground">{Object.entries(suggestions).map(([label, count]) => <div key={label}>{count} {label}</div>)}</div><p className="mt-1 text-[11px] text-muted-foreground">Suggestions do not create or change Trips.</p></div>}
        <div className="space-y-2">
          {activePeople.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No people added yet.
            </p>
          )}
          {activePeople.map((person) => (
            <div key={person.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="font-medium">{person.name}</div>
                <div className="text-xs text-muted-foreground">
                  {person.person_type} · {person.movement_type.replaceAll("_", " ")}
                  {person.organisation ? ` · ${person.organisation}` : ""}
                  {person.transport_required ? " · transport" : ""}
                  {person.hotel_required ? " · hotel" : ""}
                  {person.visit_start_date ? ` · visit ${person.visit_start_date}${person.visit_end_date ? ` → ${person.visit_end_date}` : ""}` : ""}
                </div>
                {person.flight_information && (
                  <div className="text-xs text-muted-foreground">Flight: {person.flight_information}</div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingId(person.id);
                    setForm({
                      name: person.name,
                      email: person.email ?? "",
                      person_type: person.person_type,
                      organisation: person.organisation ?? "",
                      movement_type: person.movement_type,
                      flight_information: person.flight_information ?? "",
                      hotel_required: person.hotel_required,
                      transport_required: person.transport_required,
                      notes: person.notes ?? "",
                    });
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    onAction({ action: "remove_member", operation_group_id: groupId, member_id: person.id }).then(() =>
                      toast.success("Person removed"),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={editingId ? "Edit person" : "Add person — full name"}>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Email (optional)">
            <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Field>
          <Field label="Person type">
            <select className="h-10 rounded-md border bg-background px-2 text-sm" value={form.person_type} onChange={(event) => setForm({ ...form, person_type: event.target.value as "crew" | "visitor" })}>
              <option value="crew">Crew</option>
              <option value="visitor">Visitor</option>
            </select>
          </Field>
          <Field label="Movement type">
            <select className="h-10 rounded-md border bg-background px-2 text-sm" value={form.movement_type} onChange={(event) => setForm({ ...form, movement_type: event.target.value as typeof form.movement_type })}>
              <option value="on_signing">On-signing</option>
              <option value="off_signing">Off-signing</option>
              <option value="visitor">Visitor</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Company / organisation (optional)">
            <Input value={form.organisation} onChange={(event) => setForm({ ...form, organisation: event.target.value })} />
          </Field>
          <Field label="Flight information (optional)">
            <Input value={form.flight_information} onChange={(event) => setForm({ ...form, flight_information: event.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-4 text-sm md:col-span-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.hotel_required} onChange={(event) => setForm({ ...form, hotel_required: event.target.checked })} /> Hotel required</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.transport_required} onChange={(event) => setForm({ ...form, transport_required: event.target.checked })} /> Transport required</label>
          </div>
          <Field label="Notes for the coordinator">
            <Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !form.name.trim()} onClick={() => void save()}>
            {editingId ? "Save changes" : "Add person"}
          </Button>
          {editingId && <Button type="button" variant="ghost" onClick={() => { setEditingId(null); setForm(blank); }}>Cancel</Button>}
        </div>
        <div className="rounded-lg border border-dashed p-3">
          <Label>Add multiple (one full name per line)</Label>
          <Textarea value={multiple} onChange={(event) => setMultiple(event.target.value)} placeholder="Crew member 1\nCrew member 2" />
          <Button
            type="button"
            className="mt-2"
            variant="outline"
            disabled={busy || !multiple.trim()}
            onClick={async () => {
              for (const name of multiple.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
                await onAction({ action: "add_member", operation_group_id: groupId, side: "client", role: "client_viewer", is_primary_approver: false, name, email: null, person_type: "crew", organisation: null, movement_type: "other", flight_information: null, hotel_required: false, transport_required: false, notes: null });
              }
              setMultiple("");
              toast.success("People added");
            }}
          >
            Add multiple
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmergencyPolicyCard({
  mode,
  policy,
  actorReady,
  busy,
  onAction,
}: {
  mode: Mode;
  policy: EmergencyPolicyRow | null | undefined;
  actorReady: boolean;
  busy: boolean;
  onAction: (value: WorkspaceAction) => Promise<unknown>;
}) {
  const [form, setForm] = useState({
    enabled: false,
    currency: "EUR",
    per_booking_limit: "500",
    per_operation_limit: "1500",
    document: true,
  });
  useEffect(() => {
    if (!policy) return;
    setForm({
      enabled: policy.enabled,
      currency: policy.currency,
      per_booking_limit: String(policy.per_booking_limit),
      per_operation_limit: String(policy.per_operation_limit),
      document: policy.supporting_document_required,
    });
  }, [policy]);
  const approved = policy?.client_approved_revision === policy?.revision;
  return (
    <Card className={approved ? "border-emerald-500/40" : ""}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              Emergency spending authority
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Normal hotel bookings stay on hold until both sides approve. This policy is only for
              urgent services within fixed limits.
            </p>
          </div>
          {policy && (
            <Badge variant={approved ? "default" : "outline"}>
              {approved ? "Client approved" : `Revision ${policy.revision} awaiting client`}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {mode === "coordinator" ? (
          <div className="grid gap-3 md:grid-cols-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              Enabled
            </label>
            <Field label="Per booking">
              <Input
                type="number"
                min={0}
                value={form.per_booking_limit}
                onChange={(event) => setForm({ ...form, per_booking_limit: event.target.value })}
              />
            </Field>
            <Field label="Per operation">
              <Input
                type="number"
                min={0}
                value={form.per_operation_limit}
                onChange={(event) => setForm({ ...form, per_operation_limit: event.target.value })}
              />
            </Field>
            <Field label="Currency">
              <Input
                maxLength={3}
                value={form.currency}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value.toUpperCase() })
                }
              />
            </Field>
            <Button
              className="self-end"
              disabled={busy}
              onClick={async () => {
                await onAction({
                  action: "save_emergency_policy",
                  enabled: form.enabled,
                  currency: form.currency,
                  per_booking_limit: Number(form.per_booking_limit),
                  per_operation_limit: Number(form.per_operation_limit),
                  allowed_service_types: ["hotel", "transfer", "driver", "meet_greet"],
                  supporting_document_required: form.document,
                  starts_at: null,
                  ends_at: null,
                });
                toast.success("Emergency policy saved for client approval");
              }}
            >
              Save policy revision
            </Button>
            <label className="md:col-span-5 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={form.document}
                onChange={(event) => setForm({ ...form, document: event.target.checked })}
              />
              Require booking confirmation or supporting-document reference
            </label>
          </div>
        ) : policy ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <strong>
                {policy.currency} {Number(policy.per_booking_limit).toFixed(2)}
              </strong>{" "}
              per booking ·{" "}
              <strong>
                {policy.currency} {Number(policy.per_operation_limit).toFixed(2)}
              </strong>{" "}
              per operation
              <div className="mt-1 text-xs text-muted-foreground">
                Allowed: {(policy.allowed_service_types ?? []).join(", ")}
              </div>
            </div>
            {!approved && (
              <Button
                disabled={!actorReady || busy || !policy.enabled}
                onClick={async () => {
                  await onAction({ action: "approve_emergency_policy" });
                  toast.success("Emergency authority approved");
                }}
              >
                Approve policy
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The coordinator has not proposed emergency spending authority.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceEditor({
  mode,
  token,
  operationGroupId,
  service,
  actorReady,
  busy,
  onAction,
  onClose,
}: {
  mode: Mode;
  token?: string;
  operationGroupId: string;
  service?: ServiceRow;
  actorReady: boolean;
  busy: boolean;
  onAction: (value: WorkspaceAction) => Promise<unknown>;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(!!service);
  const [location, setLocation] = useState<AddressPick>({
    address: service?.location_address ?? "",
    place_id: service?.location_place_id ?? null,
    lat: service?.location_lat ?? null,
    lng: service?.location_lng ?? null,
    display_name: service?.location_name ?? null,
  });
  const [form, setForm] = useState<{
    service_type: ServiceType;
    title: string;
    provider: string;
    starts_at: string;
    ends_at: string;
    amount: string;
    currency: string;
    booking_state: "draft" | "on_hold";
    hold_expires_at: string;
    notes: string;
  }>({
    service_type: service?.service_type ?? "flight",
    title: service?.title ?? "",
    provider: service?.provider ?? "",
    starts_at: localFromIso(service?.starts_at),
    ends_at: localFromIso(service?.ends_at),
    amount: service?.amount == null ? "" : String(service.amount),
    currency: service?.currency ?? "EUR",
    booking_state: service?.booking_state === "on_hold" ? "on_hold" : "draft",
    hold_expires_at: localFromIso(service?.hold_expires_at),
    notes: service?.notes ?? "",
  });
  const payload = useMemo(
    () => ({
      service_type: form.service_type,
      title: form.title,
      provider: form.provider || null,
      location_name: location.display_name ?? null,
      location_address: location.address || null,
      location_place_id: location.place_id,
      location_lat: location.lat,
      location_lng: location.lng,
      starts_at: isoFromLocal(form.starts_at),
      ends_at: isoFromLocal(form.ends_at),
      notes: form.notes || null,
      amount: form.amount === "" ? null : Number(form.amount),
      currency: form.currency.toUpperCase(),
      booking_state: form.booking_state,
      hold_expires_at: isoFromLocal(form.hold_expires_at),
    }),
    [form, location],
  );
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">
            {service ? `Revise ${service.title}` : "Add a service draft"}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            The author’s submission counts as their side’s approval.
          </p>
        </div>
        {!service && (
          <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
            <Plus className="mr-1 h-4 w-4" />
            Add service
          </Button>
        )}
      </CardHeader>
      {open && (
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Field label="Service type">
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.service_type}
              onChange={(event) =>
                setForm({ ...form, service_type: event.target.value as ServiceType })
              }
            >
              {SERVICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title / flight number">
            <Input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="KM102 arrival or Grand Hotel hold"
            />
          </Field>
          <Field label="Provider">
            <Input
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
            />
          </Field>
          <Field label="Hotel, airport or service location">
            <AddressAutocomplete
              publicToken={mode === "client" ? token : undefined}
              value={location.address}
              placeId={location.place_id}
              onChange={setLocation}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts">
              <Input
                type="datetime-local"
                value={form.starts_at}
                onChange={(event) => setForm({ ...form, starts_at: event.target.value })}
              />
            </Field>
            <Field label="Ends">
              <Input
                type="datetime-local"
                value={form.ends_at}
                onChange={(event) => setForm({ ...form, ends_at: event.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <Field label="Amount">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
              />
            </Field>
            <Field label="Currency">
              <Input
                maxLength={3}
                value={form.currency}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value.toUpperCase() })
                }
              />
            </Field>
          </div>
          <Field label="Booking state">
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.booking_state}
              onChange={(event) =>
                setForm({
                  ...form,
                  booking_state: event.target.value as "draft" | "on_hold",
                })
              }
            >
              <option value="draft">Draft / quote</option>
              <option value="on_hold">Temporary hold</option>
            </select>
          </Field>
          {form.booking_state === "on_hold" && (
            <Field label="Hold expires">
              <Input
                type="datetime-local"
                value={form.hold_expires_at}
                onChange={(event) => setForm({ ...form, hold_expires_at: event.target.value })}
              />
            </Field>
          )}
          <Field label="Flight, guest or service notes">
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Route, passenger names, room type, visitor requirements…"
            />
          </Field>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                onClose?.();
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={
                !actorReady ||
                !form.title.trim() ||
                busy ||
                (form.booking_state === "on_hold" && !form.hold_expires_at)
              }
              onClick={async () => {
                if (service)
                  await onAction({
                    action: "update_service",
                    service_id: service.id,
                    expected_revision: service.revision,
                    patch: payload,
                  });
                else
                  await onAction({
                    action: "add_service",
                    operation_group_id: operationGroupId,
                    ...payload,
                  });
                setOpen(false);
                onClose?.();
              }}
            >
              {service ? "Save revision & submit my approval" : "Save draft"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ServiceCard({
  mode,
  token,
  service,
  policy,
  actorReady,
  busy,
  onAction,
}: {
  mode: Mode;
  token?: string;
  service: ServiceRow;
  policy: EmergencyPolicyRow | null | undefined;
  actorReady: boolean;
  busy: boolean;
  onAction: (value: WorkspaceAction, message: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const currentSideApproved =
    mode === "client"
      ? service.client_approved_revision === service.revision
      : service.coordinator_approved_revision === service.revision;
  const awaitingCurrentSide =
    (mode === "client" && service.approval_status === "awaiting_client") ||
    (mode === "coordinator" && service.approval_status === "awaiting_coordinator");
  const emergencyApproved =
    policy?.enabled && policy?.client_approved_revision === policy?.revision;
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{service.title}</span>
            <Badge variant="outline">{service.service_type.replaceAll("_", " ")}</Badge>
            <Badge
              variant={service.approval_status === "approved_by_both" ? "default" : "secondary"}
            >
              {STATUS_LABELS[service.approval_status] ?? service.approval_status}
            </Badge>
            {service.booking_state === "on_hold" && (
              <Badge variant="outline">
                <Clock3 className="mr-1 h-3 w-3" />
                Hold until {displayDate(service.hold_expires_at)}
              </Badge>
            )}
            {service.booking_state === "confirmed" && (
              <Badge>
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Confirmed
              </Badge>
            )}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Revision {service.revision} · created by {service.created_by_name} (
            {service.created_by_side})
          </div>
        </div>
        {service.amount != null && (
          <div className="font-semibold">
            {service.currency} {Number(service.amount).toFixed(2)}
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          {service.provider || "No provider yet"}
          <div className="text-xs text-muted-foreground">
            {service.location_name || service.location_address || "No location"}
          </div>
        </div>
        <div>
          {displayDate(service.starts_at)}
          {service.ends_at ? ` → ${displayDate(service.ends_at)}` : ""}
        </div>
      </div>
      {service.notes && <p className="mt-2 text-sm text-muted-foreground">{service.notes}</p>}
      {service.change_request_reason && (
        <div className="mt-3 rounded-md border border-amber-400/50 bg-amber-50 p-2 text-xs text-amber-900">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          {service.change_request_reason}
        </div>
      )}
      {service.emergency_policy_id && !service.client_acknowledged_at && (
        <div className="mt-3 rounded-md border border-orange-400/50 bg-orange-50 p-2 text-xs text-orange-900">
          Booked under emergency authority — client acknowledgement pending.
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {service.approval_status === "draft" && (
          <Button
            size="sm"
            disabled={!actorReady || busy}
            onClick={() =>
              onAction(
                {
                  action: "submit_service",
                  service_id: service.id,
                  expected_revision: service.revision,
                },
                "Service submitted for the other side’s approval",
              )
            }
          >
            Submit for approval
          </Button>
        )}
        {awaitingCurrentSide && !currentSideApproved && (
          <>
            <Button
              size="sm"
              disabled={!actorReady || busy}
              onClick={() =>
                onAction(
                  {
                    action: "approve_service",
                    service_id: service.id,
                    expected_revision: service.revision,
                  },
                  "Service approved",
                )
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!actorReady || busy}
              onClick={() => {
                const reason = prompt("What must be changed?");
                if (reason?.trim())
                  void onAction(
                    {
                      action: "request_change",
                      service_id: service.id,
                      expected_revision: service.revision,
                      reason,
                    },
                    "Change requested",
                  );
              }}
            >
              Request change
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!actorReady || busy || service.booking_state === "cancelled"}
          onClick={() => setEditing((value) => !value)}
        >
          Revise
        </Button>
        {mode === "coordinator" &&
          service.approval_status === "approved_by_both" &&
          service.booking_state !== "confirmed" && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                const reference = prompt("Supplier confirmation reference");
                if (reference?.trim())
                  void onAction(
                    {
                      action: "confirm_service",
                      service_id: service.id,
                      expected_revision: service.revision,
                      confirmation_reference: reference,
                    },
                    "Supplier booking confirmed",
                  );
              }}
            >
              Confirm booking
            </Button>
          )}
        {mode === "coordinator" &&
          emergencyApproved &&
          service.booking_state !== "confirmed" &&
          ["hotel", "transfer", "driver", "meet_greet"].includes(service.service_type) && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const reason = prompt("Emergency booking reason");
                if (!reason?.trim()) return;
                const reference = prompt("Supplier confirmation reference");
                if (!reference?.trim()) return;
                const document = prompt("Supporting document/reference", reference);
                void onAction(
                  {
                    action: "emergency_book",
                    service_id: service.id,
                    expected_revision: service.revision,
                    reason,
                    confirmation_reference: reference,
                    supporting_document_reference: document || null,
                  },
                  "Emergency booking recorded",
                );
              }}
            >
              Emergency book
            </Button>
          )}
        {mode === "client" && service.emergency_policy_id && !service.client_acknowledged_at && (
          <Button
            size="sm"
            disabled={!actorReady || busy}
            onClick={() =>
              onAction(
                {
                  action: "acknowledge_emergency",
                  service_id: service.id,
                  expected_revision: service.revision,
                },
                "Emergency booking acknowledged",
              )
            }
          >
            Acknowledge emergency booking
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-4">
          <ServiceEditor
            mode={mode}
            token={token}
            operationGroupId={service.operation_group_id}
            service={service}
            actorReady={actorReady}
            busy={busy}
            onAction={(value) =>
              onAction(value, "Service revision saved; the other side must approve again")
            }
            onClose={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
