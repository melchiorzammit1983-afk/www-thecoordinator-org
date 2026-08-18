import assert from "node:assert/strict";
import {
  approveService,
  canConfirmService,
  requestServiceChange,
  reviseService,
  submitService,
  validateEmergencyBooking,
  type ServiceApprovalSnapshot,
} from "../src/lib/portal-operation-model.ts";

const emptyService = (): ServiceApprovalSnapshot => ({
  revision: 1,
  coordinator_approved_revision: null,
  coordinator_approved_by: null,
  coordinator_approved_at: null,
  client_approved_revision: null,
  client_approved_by: null,
  client_approved_at: null,
  approval_status: "draft",
  change_requested_by_side: null,
  change_request_reason: null,
});

const clientAt = "2026-08-20T08:00:00.000Z";
const coordinatorAt = "2026-08-20T08:05:00.000Z";

// Saipem shares a flight for 14 crew and 3 visitors. Submitting the draft
// records Saipem's approval and leaves Baygor Cab as the second approver.
const clientFlight = submitService(emptyService(), "client", "Maria — Saipem", clientAt);
assert.equal(clientFlight.approval_status, "awaiting_coordinator");
assert.equal(clientFlight.client_approved_revision, 1);
const approvedFlight = approveService(
  clientFlight,
  "coordinator",
  "Joseph — Baygor Cab",
  coordinatorAt,
);
assert.equal(approvedFlight.approval_status, "approved_by_both");
assert.equal(canConfirmService(approvedFlight), true);

// The three visitors have a separate meet-and-greet/access arrangement so
// visitor services follow the same two-sided approval trail as crew travel.
const visitorArrangement = submitService(
  emptyService(),
  "coordinator",
  "Joseph — Baygor Cab",
  "2026-08-20T08:07:00.000Z",
);
const approvedVisitors = approveService(
  visitorArrangement,
  "client",
  "Maria — Saipem",
  "2026-08-20T08:09:00.000Z",
);
assert.equal(approvedVisitors.approval_status, "approved_by_both");

// Baygor Cab places a hotel on hold. Its submission counts as the coordinator
// approval; Saipem must approve before final supplier confirmation.
const hotelHold = submitService(
  emptyService(),
  "coordinator",
  "Joseph — Baygor Cab",
  coordinatorAt,
);
assert.equal(hotelHold.approval_status, "awaiting_client");
assert.equal(canConfirmService(hotelHold), false);
const approvedHotel = approveService(
  hotelHold,
  "client",
  "Maria — Saipem",
  "2026-08-20T08:10:00.000Z",
);
assert.equal(approvedHotel.approval_status, "approved_by_both");
assert.equal(canConfirmService(approvedHotel), true);

// Saipem requests a room change. Only the hotel service is revised; its old
// approvals are invalid and the new revision again needs Saipem's approval.
const changeRequested = requestServiceChange(approvedHotel, "client", "Add three visitor rooms.");
assert.equal(changeRequested.approval_status, "change_requested");
const revisedHotel = reviseService(
  changeRequested,
  "coordinator",
  "Joseph — Baygor Cab",
  "2026-08-20T08:15:00.000Z",
);
assert.equal(revisedHotel.revision, 2);
assert.equal(revisedHotel.approval_status, "awaiting_client");
assert.equal(revisedHotel.client_approved_revision, null);
const reapprovedHotel = approveService(
  revisedHotel,
  "client",
  "Maria — Saipem",
  "2026-08-20T08:17:00.000Z",
);
assert.equal(reapprovedHotel.approval_status, "approved_by_both");

const emergencyPolicy = {
  id: "00000000-0000-4000-8000-000000000001",
  enabled: true,
  currency: "EUR",
  per_booking_limit: 500,
  per_operation_limit: 1500,
  allowed_service_types: ["hotel", "transfer", "driver", "meet_greet"],
  starts_at: null,
  ends_at: null,
  supporting_document_required: true,
  revision: 3,
  client_approved_revision: 3,
};

const emergencyTransfer = validateEmergencyBooking({
  policy: emergencyPolicy,
  serviceType: "transfer",
  amount: 240,
  currency: "EUR",
  operationEmergencyTotal: 400,
  supportingDocumentReference: "TRANSFER-HOLD-2281",
  now: "2026-08-20T08:20:00.000Z",
});
assert.equal(emergencyTransfer.ok, true);

const missingEvidence = validateEmergencyBooking({
  policy: emergencyPolicy,
  serviceType: "hotel",
  amount: 300,
  currency: "EUR",
  operationEmergencyTotal: 400,
  supportingDocumentReference: null,
  now: "2026-08-20T08:20:00.000Z",
});
assert.equal(missingEvidence.ok, false);

const overOperationLimit = validateEmergencyBooking({
  policy: emergencyPolicy,
  serviceType: "driver",
  amount: 400,
  currency: "EUR",
  operationEmergencyTotal: 1200,
  supportingDocumentReference: "DRIVER-449",
  now: "2026-08-20T08:20:00.000Z",
});
assert.equal(overOperationLimit.ok, false);

console.log(
  JSON.stringify(
    {
      scenario: "Saipem crew change with visitors",
      people: { crew: 14, visitors: 3 },
      flight: approvedFlight.approval_status,
      visitor_arrangement: approvedVisitors.approval_status,
      hotel_revision: reapprovedHotel.revision,
      hotel: reapprovedHotel.approval_status,
      emergency_transfer: emergencyTransfer.ok,
      evidence_guard: !missingEvidence.ok,
      operation_limit_guard: !overOperationLimit.ok,
    },
    null,
    2,
  ),
);
