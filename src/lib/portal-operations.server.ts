import {
  approveService,
  canConfirmService,
  requestServiceChange,
  reviseService,
  submitService,
  validateEmergencyBooking,
  type EmergencyPolicySnapshot,
  type OperationActorSide,
  type ServiceApprovalSnapshot,
} from "@/lib/portal-operation-model";
import type { PortalOperationAction } from "@/lib/portal-operation-schemas";

// The collaboration tables are introduced by the pending migration, so generated DB types cannot
// include them until that migration is applied to the correct Supabase project.
export type OperationsAdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  auth: {
    admin: {
      getUserById: (userId: string) => Promise<{
        data: {
          user?: {
            email?: string;
            user_metadata?: Record<string, unknown>;
          } | null;
        };
      }>;
    };
  };
};
type AdminClient = OperationsAdminClient;
type PortalScope = {
  id: string;
  coordinator_company_id: string;
  name: string;
};

type ServiceRow = ServiceApprovalSnapshot & {
  id: string;
  operation_group_id: string;
  service_type: string;
  amount: number | string | null;
  currency: string;
  booking_state: string;
  hold_expires_at: string | null;
  emergency_policy_id: string | null;
};

const GROUP_SELECT = [
  "id",
  "company_id",
  "portal_company_id",
  "reference",
  "name",
  "type",
  "status",
  "start_date",
  "end_date",
  "notes",
  "crew_count",
  "visitor_count",
  "created_by_side",
  "created_at",
  "updated_at",
].join(",");

const SERVICE_SELECT = [
  "id",
  "operation_group_id",
  "company_id",
  "portal_company_id",
  "service_type",
  "title",
  "provider",
  "location_name",
  "location_address",
  "location_place_id",
  "location_lat",
  "location_lng",
  "starts_at",
  "ends_at",
  "notes",
  "amount",
  "currency",
  "booking_state",
  "hold_expires_at",
  "approval_status",
  "revision",
  "created_by_side",
  "created_by_name",
  "coordinator_approved_revision",
  "coordinator_approved_by",
  "coordinator_approved_at",
  "client_approved_revision",
  "client_approved_by",
  "client_approved_at",
  "change_requested_by_side",
  "change_request_reason",
  "emergency_policy_id",
  "emergency_reason",
  "confirmation_reference",
  "supporting_document_reference",
  "client_acknowledged_by",
  "client_acknowledged_at",
  "created_at",
  "updated_at",
].join(",");

const POLICY_SELECT = [
  "id",
  "portal_company_id",
  "company_id",
  "enabled",
  "currency",
  "per_booking_limit",
  "per_operation_limit",
  "allowed_service_types",
  "starts_at",
  "ends_at",
  "supporting_document_required",
  "revision",
  "client_approved_revision",
  "client_approved_by",
  "client_approved_at",
  "created_at",
  "updated_at",
].join(",");

function serviceSnapshot(service: ServiceRow): ServiceApprovalSnapshot {
  return {
    revision: service.revision,
    coordinator_approved_revision: service.coordinator_approved_revision,
    coordinator_approved_by: service.coordinator_approved_by,
    coordinator_approved_at: service.coordinator_approved_at,
    client_approved_revision: service.client_approved_revision,
    client_approved_by: service.client_approved_by,
    client_approved_at: service.client_approved_at,
    approval_status: service.approval_status,
    change_requested_by_side: service.change_requested_by_side,
    change_request_reason: service.change_request_reason,
  };
}

function approvalPatch(snapshot: ServiceApprovalSnapshot) {
  return {
    revision: snapshot.revision,
    coordinator_approved_revision: snapshot.coordinator_approved_revision,
    coordinator_approved_by: snapshot.coordinator_approved_by,
    coordinator_approved_at: snapshot.coordinator_approved_at,
    client_approved_revision: snapshot.client_approved_revision,
    client_approved_by: snapshot.client_approved_by,
    client_approved_at: snapshot.client_approved_at,
    approval_status: snapshot.approval_status,
    change_requested_by_side: snapshot.change_requested_by_side,
    change_request_reason: snapshot.change_request_reason,
  };
}

async function requireGroup(admin: AdminClient, portal: PortalScope, id: string) {
  const { data, error } = await admin
    .from("operation_groups")
    .select(GROUP_SELECT)
    .eq("id", id)
    .eq("portal_company_id", portal.id)
    .eq("company_id", portal.coordinator_company_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Operation Group not found.");
  return data;
}

async function requireService(
  admin: AdminClient,
  portal: PortalScope,
  id: string,
  expectedRevision: number,
) {
  const { data, error } = await admin
    .from("operation_group_services")
    .select(SERVICE_SELECT)
    .eq("id", id)
    .eq("portal_company_id", portal.id)
    .eq("company_id", portal.coordinator_company_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Operation service not found.");
  if (data.revision !== expectedRevision) throw new Error("revision_conflict");
  return data;
}

async function insertEvent(
  admin: AdminClient,
  portal: PortalScope,
  input: {
    operationGroupId: string;
    serviceId?: string | null;
    actorSide: OperationActorSide | "system";
    actorName: string;
    eventType: string;
    revision?: number | null;
    details?: Record<string, unknown>;
  },
) {
  const { error } = await admin.from("operation_group_service_events").insert({
    operation_group_id: input.operationGroupId,
    service_id: input.serviceId ?? null,
    company_id: portal.coordinator_company_id,
    portal_company_id: portal.id,
    actor_side: input.actorSide,
    actor_name: input.actorName,
    event_type: input.eventType,
    service_revision: input.revision ?? null,
    details: input.details ?? {},
  });
  if (error) throw new Error(error.message);
}

async function setGroupActive(admin: AdminClient, groupId: string) {
  await admin
    .from("operation_groups")
    .update({ status: "active" })
    .eq("id", groupId)
    .eq("status", "draft");
}

export async function loadPortalOperations(admin: AdminClient, portal: PortalScope) {
  const groups = await admin
    .from("operation_groups")
    .select(GROUP_SELECT)
    .eq("portal_company_id", portal.id)
    .eq("company_id", portal.coordinator_company_id)
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (groups.error) throw new Error(groups.error.message);
  const ids = (groups.data ?? []).map((group: { id: string }) => group.id);
  const [members, services, events, policy] = await Promise.all([
    ids.length
      ? admin
          .from("operation_group_members")
          .select(
            "id,operation_group_id,side,role,name,email,is_primary_approver,active,person_type,organisation,movement_type,flight_information,hotel_required,transport_required,notes,created_at,updated_at",
          )
          .in("operation_group_id", ids)
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? admin
          .from("operation_group_services")
          .select(SERVICE_SELECT)
          .in("operation_group_id", ids)
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? admin
          .from("operation_group_service_events")
          .select(
            "id,operation_group_id,service_id,actor_side,actor_name,event_type,service_revision,details,created_at",
          )
          .in("operation_group_id", ids)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("operation_group_emergency_policies")
      .select(POLICY_SELECT)
      .eq("portal_company_id", portal.id)
      .eq("company_id", portal.coordinator_company_id)
      .maybeSingle(),
  ]);
  for (const result of [members, services, events, policy]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    portal: { id: portal.id, name: portal.name },
    groups: groups.data ?? [],
    members: members.data ?? [],
    services: services.data ?? [],
    events: events.data ?? [],
    emergency_policy: policy.data ?? null,
  };
}

export async function performPortalOperationAction(args: {
  admin: AdminClient;
  portal: PortalScope;
  side: OperationActorSide;
  actorUserId?: string | null;
  input: PortalOperationAction;
}) {
  const { admin, portal, side, actorUserId, input } = args;
  const at = new Date().toISOString();
  const actorName = input.actor_name.trim();

  if (input.action === "create_operation") {
    if (input.start_date && input.end_date && input.end_date < input.start_date) {
      throw new Error("End date must be on or after the start date.");
    }
    const reference =
      input.reference?.trim() ||
      `${
        portal.name
          .replace(/[^a-z0-9]/gi, "")
          .slice(0, 3)
          .toUpperCase() || "OPS"
      }-${at.slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    const { data: group, error } = await admin
      .from("operation_groups")
      .insert({
        company_id: portal.coordinator_company_id,
        portal_company_id: portal.id,
        reference,
        name: input.name,
        type: "crew_change",
        status: "draft",
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        notes: input.notes ?? null,
        crew_count: input.crew_count,
        visitor_count: input.visitor_count,
        created_by: side === "coordinator" ? (actorUserId ?? null) : null,
        created_by_side: side,
      })
      .select(GROUP_SELECT)
      .single();
    if (error)
      throw new Error(
        error.code === "23505" ? "This operation reference is already in use." : error.message,
      );
    await insertEvent(admin, portal, {
      operationGroupId: group.id,
      actorSide: side,
      actorName,
      eventType: "operation_created",
      details: { crew_count: input.crew_count, visitor_count: input.visitor_count },
    });
    return { ok: true, group };
  }

  if (input.action === "add_member") {
    if (side === "client" && input.side !== "client")
      throw new Error("Clients may only add client people.");
    const group = await requireGroup(admin, portal, input.operation_group_id);
    if (side === "client" && group.status !== "draft")
      throw new Error("People can only be added while the Operation is Draft.");
    const coordinatorRoles = new Set([
      "lead_coordinator",
      "operations_member",
      "coordinator_approver",
      "driver",
    ]);
    if ((input.side === "coordinator") !== coordinatorRoles.has(input.role)) {
      throw new Error("The selected role does not match the member side.");
    }
    if (input.is_primary_approver) {
      await admin
        .from("operation_group_members")
        .update({ is_primary_approver: false })
        .eq("operation_group_id", group.id)
        .eq("side", input.side)
        .eq("active", true);
    }
    const { data: member, error } = await admin
      .from("operation_group_members")
      .insert({
        operation_group_id: group.id,
        company_id: portal.coordinator_company_id,
        portal_company_id: portal.id,
        side: input.side,
        role: input.role,
        name: input.name,
        email: input.email ?? null,
        is_primary_approver: input.is_primary_approver,
        person_type: input.person_type,
        organisation: input.organisation ?? null,
        movement_type: input.movement_type,
        flight_information: input.flight_information ?? null,
        hotel_required: input.hotel_required,
        transport_required: input.transport_required,
        notes: input.notes ?? null,
      })
      .select(
        "id,operation_group_id,side,role,name,email,is_primary_approver,active,person_type,organisation,movement_type,flight_information,hotel_required,transport_required,notes,created_at,updated_at",
      )
      .single();
    if (error)
      throw new Error(
        error.code === "23505" ? "That member or primary approver already exists." : error.message,
      );
    await insertEvent(admin, portal, {
      operationGroupId: group.id,
      actorSide: side,
      actorName,
      eventType: "member_added",
      details: { member_name: member.name, role: member.role, side: member.side },
    });
    return { ok: true, member };
  }

  if (input.action === "update_member" || input.action === "remove_member") {
    const group = await requireGroup(admin, portal, input.operation_group_id);
    if (side === "client" && group.status !== "draft")
      throw new Error("People can only be changed while the Operation is Draft.");
    const existing = await admin
      .from("operation_group_members")
      .select(
        "id,operation_group_id,side,name,email,person_type,organisation,movement_type,flight_information,hotel_required,transport_required,notes,active",
      )
      .eq("id", input.member_id)
      .eq("operation_group_id", group.id)
      .eq("portal_company_id", portal.id)
      .eq("company_id", portal.coordinator_company_id)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data || !existing.data.active) throw new Error("Operation person not found.");
    if (side === "client" && existing.data.side !== "client")
      throw new Error("Clients may only manage client-added people.");

    const liveJobs = await admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("operation_group_id", group.id)
      .not("status", "in", "(completed,cancelled,archived)");
    if (liveJobs.error) throw new Error(liveJobs.error.message);
    const hasLiveTransport = (liveJobs.count ?? 0) > 0;

    if (input.action === "remove_member") {
      const { error } = await admin
        .from("operation_group_members")
        .update({ active: false })
        .eq("id", existing.data.id)
        .eq("operation_group_id", group.id)
        .eq("portal_company_id", portal.id)
        .eq("company_id", portal.coordinator_company_id);
      if (error) throw new Error(error.message);
      await insertEvent(admin, portal, {
        operationGroupId: group.id,
        actorSide: side,
        actorName,
        eventType: hasLiveTransport ? "change_requested" : "member_removed",
        details: { member_id: existing.data.id, member_name: existing.data.name, live_transport: hasLiveTransport },
      });
      return { ok: true, review_required: hasLiveTransport };
    }

    const { error } = await admin
      .from("operation_group_members")
      .update({
        name: input.name,
        email: input.email ?? null,
        person_type: input.person_type,
        organisation: input.organisation ?? null,
        movement_type: input.movement_type,
        flight_information: input.flight_information ?? null,
        hotel_required: input.hotel_required,
        transport_required: input.transport_required,
        notes: input.notes ?? null,
      })
      .eq("id", existing.data.id)
      .eq("operation_group_id", group.id)
      .eq("portal_company_id", portal.id)
      .eq("company_id", portal.coordinator_company_id);
    if (error) throw new Error(error.message);
    await insertEvent(admin, portal, {
      operationGroupId: group.id,
      actorSide: side,
      actorName,
      eventType: hasLiveTransport ? "change_requested" : "member_updated",
      details: { member_id: existing.data.id, member_name: input.name, live_transport: hasLiveTransport },
    });
    return { ok: true, review_required: hasLiveTransport };
  }

  if (input.action === "save_emergency_policy") {
    if (side !== "coordinator")
      throw new Error("Only the coordinator can propose emergency authority.");
    if (input.per_operation_limit < input.per_booking_limit) {
      throw new Error("The operation limit must be at least the per-booking limit.");
    }
    if (input.starts_at && input.ends_at && input.ends_at <= input.starts_at) {
      throw new Error("The policy end must be after its start.");
    }
    const existing = await admin
      .from("operation_group_emergency_policies")
      .select("id,revision")
      .eq("portal_company_id", portal.id)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const revision = (existing.data?.revision ?? 0) + 1;
    const patch = {
      portal_company_id: portal.id,
      company_id: portal.coordinator_company_id,
      enabled: input.enabled,
      currency: input.currency,
      per_booking_limit: input.per_booking_limit,
      per_operation_limit: input.per_operation_limit,
      allowed_service_types: input.allowed_service_types,
      starts_at: input.starts_at ?? null,
      ends_at: input.ends_at ?? null,
      supporting_document_required: input.supporting_document_required,
      revision,
      client_approved_revision: null,
      client_approved_by: null,
      client_approved_at: null,
      created_by: actorUserId ?? null,
    };
    const query = existing.data
      ? admin.from("operation_group_emergency_policies").update(patch).eq("id", existing.data.id)
      : admin.from("operation_group_emergency_policies").insert(patch);
    const { data: policy, error } = await query.select(POLICY_SELECT).single();
    if (error) throw new Error(error.message);
    await admin.from("portal_link_events").insert({
      portal_company_id: portal.id,
      actor_user_id: actorUserId ?? null,
      actor_kind: "coordinator",
      event: "emergency_policy_saved",
      detail: { revision, enabled: input.enabled, currency: input.currency },
    });
    return { ok: true, policy };
  }

  if (input.action === "approve_emergency_policy") {
    if (side !== "client") throw new Error("Only the client can approve emergency authority.");
    const { data: current, error: loadError } = await admin
      .from("operation_group_emergency_policies")
      .select(POLICY_SELECT)
      .eq("portal_company_id", portal.id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!current || !current.enabled)
      throw new Error("No enabled emergency policy is awaiting approval.");
    const { data: policy, error } = await admin
      .from("operation_group_emergency_policies")
      .update({
        client_approved_revision: current.revision,
        client_approved_by: actorName,
        client_approved_at: at,
      })
      .eq("id", current.id)
      .eq("revision", current.revision)
      .select(POLICY_SELECT)
      .single();
    if (error) throw new Error(error.message);
    await admin.from("portal_link_events").insert({
      portal_company_id: portal.id,
      actor_kind: "client",
      event: "emergency_policy_approved",
      detail: { revision: current.revision, approved_by: actorName },
    });
    return { ok: true, policy };
  }

  if (input.action === "add_service") {
    const group = await requireGroup(admin, portal, input.operation_group_id);
    if (input.starts_at && input.ends_at && input.ends_at < input.starts_at) {
      throw new Error("Service end must be after its start.");
    }
    if (input.booking_state === "on_hold" && !input.hold_expires_at) {
      throw new Error("A hold expiry is required.");
    }
    const { data: service, error } = await admin
      .from("operation_group_services")
      .insert({
        operation_group_id: group.id,
        company_id: portal.coordinator_company_id,
        portal_company_id: portal.id,
        service_type: input.service_type,
        title: input.title,
        provider: input.provider ?? null,
        location_name: input.location_name ?? null,
        location_address: input.location_address ?? null,
        location_place_id: input.location_place_id ?? null,
        location_lat: input.location_lat ?? null,
        location_lng: input.location_lng ?? null,
        starts_at: input.starts_at ?? null,
        ends_at: input.ends_at ?? null,
        notes: input.notes ?? null,
        amount: input.amount ?? null,
        currency: input.currency,
        booking_state: input.booking_state,
        hold_expires_at: input.hold_expires_at ?? null,
        created_by_side: side,
        created_by_name: actorName,
      })
      .select(SERVICE_SELECT)
      .single();
    if (error) throw new Error(error.message);
    await insertEvent(admin, portal, {
      operationGroupId: group.id,
      serviceId: service.id,
      actorSide: side,
      actorName,
      eventType: "service_created",
      revision: service.revision,
      details: { service_type: service.service_type, booking_state: service.booking_state },
    });
    return { ok: true, service };
  }

  const service = await requireService(admin, portal, input.service_id, input.expected_revision);
  await requireGroup(admin, portal, service.operation_group_id);

  if (input.action === "update_service") {
    if (
      input.patch.starts_at &&
      input.patch.ends_at &&
      input.patch.ends_at < input.patch.starts_at
    ) {
      throw new Error("Service end must be after its start.");
    }
    if (
      input.patch.booking_state === "on_hold" &&
      !input.patch.hold_expires_at &&
      !service.hold_expires_at
    ) {
      throw new Error("A hold expiry is required.");
    }
    const next = reviseService(serviceSnapshot(service), side, actorName, at);
    const patch = {
      ...input.patch,
      ...approvalPatch(next),
      booking_state:
        input.patch.booking_state ??
        (service.booking_state === "confirmed" ? "draft" : service.booking_state),
      confirmation_reference: null,
      emergency_policy_id: null,
      emergency_reason: null,
      supporting_document_reference: null,
      client_acknowledged_by: null,
      client_acknowledged_at: null,
    };
    const { data: updated, error } = await admin
      .from("operation_group_services")
      .update(patch)
      .eq("id", service.id)
      .eq("revision", service.revision)
      .select(SERVICE_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("revision_conflict");
    await insertEvent(admin, portal, {
      operationGroupId: service.operation_group_id,
      serviceId: service.id,
      actorSide: side,
      actorName,
      eventType: "service_updated",
      revision: updated.revision,
      details: { changed_fields: Object.keys(input.patch) },
    });
    await setGroupActive(admin, service.operation_group_id);
    return { ok: true, service: updated };
  }

  if (input.action === "submit_service" || input.action === "approve_service") {
    if (service.approval_status === "change_requested") {
      throw new Error("Revise the service before submitting it again.");
    }
    const next =
      input.action === "submit_service"
        ? submitService(serviceSnapshot(service), side, actorName, at)
        : approveService(serviceSnapshot(service), side, actorName, at);
    const { data: updated, error } = await admin
      .from("operation_group_services")
      .update(approvalPatch(next))
      .eq("id", service.id)
      .eq("revision", service.revision)
      .select(SERVICE_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("revision_conflict");
    await insertEvent(admin, portal, {
      operationGroupId: service.operation_group_id,
      serviceId: service.id,
      actorSide: side,
      actorName,
      eventType: input.action === "submit_service" ? "service_submitted" : "service_approved",
      revision: service.revision,
    });
    await setGroupActive(admin, service.operation_group_id);
    return { ok: true, service: updated };
  }

  if (input.action === "request_change") {
    const next = requestServiceChange(serviceSnapshot(service), side, input.reason);
    const { data: updated, error } = await admin
      .from("operation_group_services")
      .update(approvalPatch(next))
      .eq("id", service.id)
      .eq("revision", service.revision)
      .select(SERVICE_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("revision_conflict");
    await insertEvent(admin, portal, {
      operationGroupId: service.operation_group_id,
      serviceId: service.id,
      actorSide: side,
      actorName,
      eventType: "change_requested",
      revision: service.revision,
      details: { reason: input.reason },
    });
    return { ok: true, service: updated };
  }

  if (input.action === "confirm_service") {
    if (side !== "coordinator")
      throw new Error("Only the coordinator can confirm a supplier booking.");
    if (!canConfirmService(serviceSnapshot(service)))
      throw new Error("Both sides must approve before confirmation.");
    const { data: updated, error } = await admin
      .from("operation_group_services")
      .update({
        booking_state: "confirmed",
        confirmation_reference: input.confirmation_reference,
      })
      .eq("id", service.id)
      .eq("revision", service.revision)
      .select(SERVICE_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("revision_conflict");
    await insertEvent(admin, portal, {
      operationGroupId: service.operation_group_id,
      serviceId: service.id,
      actorSide: side,
      actorName,
      eventType: "service_confirmed",
      revision: service.revision,
      details: { confirmation_reference: input.confirmation_reference },
    });
    return { ok: true, service: updated };
  }

  if (input.action === "emergency_book") {
    if (side !== "coordinator")
      throw new Error("Only the coordinator can use emergency authority.");
    const { data: policy, error: policyError } = await admin
      .from("operation_group_emergency_policies")
      .select(POLICY_SELECT)
      .eq("portal_company_id", portal.id)
      .maybeSingle();
    if (policyError) throw new Error(policyError.message);
    const { data: booked, error: bookedError } = await admin
      .from("operation_group_services")
      .select("amount")
      .eq("operation_group_id", service.operation_group_id)
      .not("emergency_policy_id", "is", null)
      .neq("booking_state", "cancelled");
    if (bookedError) throw new Error(bookedError.message);
    const operationEmergencyTotal = (booked ?? []).reduce(
      (sum: number, row: { amount: number | string | null }) => sum + Number(row.amount ?? 0),
      0,
    );
    const validation = validateEmergencyBooking({
      policy: policy as EmergencyPolicySnapshot | null,
      serviceType: service.service_type,
      amount: service.amount === null ? null : Number(service.amount),
      currency: service.currency,
      operationEmergencyTotal,
      supportingDocumentReference:
        input.supporting_document_reference ?? input.confirmation_reference,
      now: at,
    });
    if (!validation.ok) throw new Error(validation.reason);
    const { data: updated, error } = await admin
      .from("operation_group_services")
      .update({
        booking_state: "confirmed",
        approval_status: "approved_by_both",
        coordinator_approved_revision: service.revision,
        coordinator_approved_by: actorName,
        coordinator_approved_at: at,
        client_approved_revision: service.revision,
        client_approved_by: `Emergency policy r${policy.revision}`,
        client_approved_at: policy.client_approved_at,
        emergency_policy_id: policy.id,
        emergency_reason: input.reason,
        confirmation_reference: input.confirmation_reference,
        supporting_document_reference: input.supporting_document_reference ?? null,
        client_acknowledged_by: null,
        client_acknowledged_at: null,
      })
      .eq("id", service.id)
      .eq("revision", service.revision)
      .select(SERVICE_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("revision_conflict");
    await insertEvent(admin, portal, {
      operationGroupId: service.operation_group_id,
      serviceId: service.id,
      actorSide: side,
      actorName,
      eventType: "emergency_booked",
      revision: service.revision,
      details: { amount: service.amount, currency: service.currency, reason: input.reason },
    });
    return { ok: true, service: updated };
  }

  if (input.action === "acknowledge_emergency") {
    if (side !== "client") throw new Error("Only the client can acknowledge an emergency booking.");
    if (!service.emergency_policy_id)
      throw new Error("This service was not booked under emergency authority.");
    const { data: updated, error } = await admin
      .from("operation_group_services")
      .update({
        client_acknowledged_by: actorName,
        client_acknowledged_at: at,
      })
      .eq("id", service.id)
      .eq("revision", service.revision)
      .select(SERVICE_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("revision_conflict");
    await insertEvent(admin, portal, {
      operationGroupId: service.operation_group_id,
      serviceId: service.id,
      actorSide: side,
      actorName,
      eventType: "emergency_acknowledged",
      revision: service.revision,
    });
    return { ok: true, service: updated };
  }

  throw new Error("Unsupported operation action.");
}
