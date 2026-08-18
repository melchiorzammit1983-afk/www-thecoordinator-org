export type OperationActorSide = "coordinator" | "client";
export type OperationApprovalStatus =
  "draft" | "awaiting_client" | "awaiting_coordinator" | "approved_by_both" | "change_requested";

export type ServiceApprovalSnapshot = {
  revision: number;
  coordinator_approved_revision: number | null;
  coordinator_approved_by: string | null;
  coordinator_approved_at: string | null;
  client_approved_revision: number | null;
  client_approved_by: string | null;
  client_approved_at: string | null;
  approval_status: OperationApprovalStatus;
  change_requested_by_side: OperationActorSide | null;
  change_request_reason: string | null;
};

export type EmergencyPolicySnapshot = {
  id: string;
  enabled: boolean;
  currency: string;
  per_booking_limit: number;
  per_operation_limit: number;
  allowed_service_types: string[];
  starts_at: string | null;
  ends_at: string | null;
  supporting_document_required: boolean;
  revision: number;
  client_approved_revision: number | null;
};

export function approvalStatus(snapshot: ServiceApprovalSnapshot): OperationApprovalStatus {
  const coordinatorApproved = snapshot.coordinator_approved_revision === snapshot.revision;
  const clientApproved = snapshot.client_approved_revision === snapshot.revision;
  if (coordinatorApproved && clientApproved) return "approved_by_both";
  if (coordinatorApproved) return "awaiting_client";
  if (clientApproved) return "awaiting_coordinator";
  return snapshot.change_request_reason ? "change_requested" : "draft";
}

export function submitService(
  snapshot: ServiceApprovalSnapshot,
  side: OperationActorSide,
  actorName: string,
  at: string,
): ServiceApprovalSnapshot {
  const next = {
    ...snapshot,
    change_requested_by_side: null,
    change_request_reason: null,
  };
  if (side === "coordinator") {
    next.coordinator_approved_revision = snapshot.revision;
    next.coordinator_approved_by = actorName;
    next.coordinator_approved_at = at;
  } else {
    next.client_approved_revision = snapshot.revision;
    next.client_approved_by = actorName;
    next.client_approved_at = at;
  }
  next.approval_status = approvalStatus(next);
  return next;
}

export function approveService(
  snapshot: ServiceApprovalSnapshot,
  side: OperationActorSide,
  actorName: string,
  at: string,
): ServiceApprovalSnapshot {
  return submitService(snapshot, side, actorName, at);
}

export function reviseService(
  snapshot: ServiceApprovalSnapshot,
  side: OperationActorSide,
  actorName: string,
  at: string,
): ServiceApprovalSnapshot {
  const revision = snapshot.revision + 1;
  return submitService(
    {
      ...snapshot,
      revision,
      coordinator_approved_revision: null,
      coordinator_approved_by: null,
      coordinator_approved_at: null,
      client_approved_revision: null,
      client_approved_by: null,
      client_approved_at: null,
      approval_status: "draft",
      change_requested_by_side: null,
      change_request_reason: null,
    },
    side,
    actorName,
    at,
  );
}

export function requestServiceChange(
  snapshot: ServiceApprovalSnapshot,
  side: OperationActorSide,
  reason: string,
): ServiceApprovalSnapshot {
  return {
    ...snapshot,
    approval_status: "change_requested",
    change_requested_by_side: side,
    change_request_reason: reason,
  };
}

export function canConfirmService(snapshot: ServiceApprovalSnapshot) {
  return approvalStatus(snapshot) === "approved_by_both";
}

export function validateEmergencyBooking(input: {
  policy: EmergencyPolicySnapshot | null;
  serviceType: string;
  amount: number | null;
  currency: string;
  operationEmergencyTotal: number;
  supportingDocumentReference: string | null;
  now: string;
}) {
  const { policy } = input;
  if (!policy?.enabled || policy.client_approved_revision !== policy.revision) {
    return { ok: false as const, reason: "Emergency policy is not client-approved." };
  }
  const now = new Date(input.now).getTime();
  if (policy.starts_at && new Date(policy.starts_at).getTime() > now) {
    return { ok: false as const, reason: "Emergency policy is not active yet." };
  }
  if (policy.ends_at && new Date(policy.ends_at).getTime() <= now) {
    return { ok: false as const, reason: "Emergency policy has expired." };
  }
  if (!policy.allowed_service_types.includes(input.serviceType)) {
    return { ok: false as const, reason: "This service type is outside the emergency policy." };
  }
  if (input.currency !== policy.currency) {
    return {
      ok: false as const,
      reason: "The service currency does not match the emergency policy.",
    };
  }
  if (input.amount === null || input.amount > policy.per_booking_limit) {
    return { ok: false as const, reason: "The service exceeds the per-booking emergency limit." };
  }
  if (input.operationEmergencyTotal + input.amount > policy.per_operation_limit) {
    return { ok: false as const, reason: "The operation emergency limit would be exceeded." };
  }
  if (policy.supporting_document_required && !input.supportingDocumentReference?.trim()) {
    return {
      ok: false as const,
      reason: "A supporting document or confirmation reference is required.",
    };
  }
  return { ok: true as const };
}
