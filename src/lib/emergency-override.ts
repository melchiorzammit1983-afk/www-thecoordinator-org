export const EMERGENCY_OVERRIDE_REASONS = [
  "gps_issue",
  "wrong_pickup_pin",
  "passenger_different_pickup",
  "auto_status_failed",
  "breakdown",
  "safety_concern",
  "other",
] as const;

export type EmergencyOverrideReason = (typeof EMERGENCY_OVERRIDE_REASONS)[number];

export const EMERGENCY_OVERRIDE_REASON_LABELS: Record<EmergencyOverrideReason, string> = {
  gps_issue: "GPS Issue",
  wrong_pickup_pin: "Wrong Pickup Pin",
  passenger_different_pickup: "Passenger Requested Different Pickup",
  auto_status_failed: "Auto Status Failed",
  breakdown: "Breakdown",
  safety_concern: "Safety Concern",
  other: "Other",
};

export const EMERGENCY_OVERRIDE_ACTIONS = [
  "force_arrived",
  "force_passenger_on_board",
  "force_en_route",
  "force_drop_off",
  "force_complete",
] as const;

export type EmergencyOverrideAction = (typeof EMERGENCY_OVERRIDE_ACTIONS)[number];

export const EMERGENCY_OVERRIDE_ACTION_LABELS: Record<EmergencyOverrideAction, string> = {
  force_arrived: "Force Arrived",
  force_passenger_on_board: "Force Passenger On Board",
  force_en_route: "Force En Route",
  force_drop_off: "Force Drop Off",
  force_complete: "Force Complete",
};

export const EMERGENCY_OVERRIDE_ACTION_DESCRIPTIONS: Record<EmergencyOverrideAction, string> = {
  force_arrived: "Bypass GPS arrival checks",
  force_passenger_on_board: "Bypass passenger boarding checks",
  force_en_route: "Move the trip back or forward to en route",
  force_drop_off: "Complete the drop-off leg immediately",
  force_complete: "Complete the trip immediately",
};

export const EMERGENCY_OVERRIDE_TO_STATUS: Record<
  EmergencyOverrideAction,
  "arrived" | "in_progress" | "en_route" | "completed"
> = {
  force_arrived: "arrived",
  force_passenger_on_board: "in_progress",
  force_en_route: "en_route",
  force_drop_off: "completed",
  force_complete: "completed",
};

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  en_route: 1,
  arrived: 2,
  in_progress: 3,
  completed: 4,
};

export function isBackwardStatusTransition(fromStatus: string | null | undefined, toStatus: string): boolean {
  const fromOrder = fromStatus ? STATUS_ORDER[fromStatus] : undefined;
  const toOrder = STATUS_ORDER[toStatus];
  if (fromOrder == null || toOrder == null) return false;
  return toOrder < fromOrder;
}

export function getEmergencyOverrideActionOptions(status: string | null | undefined): EmergencyOverrideAction[] {
  if (!status || status === "completed" || status === "cancelled") return [];

  const actions: EmergencyOverrideAction[] = [];
  if (status !== "arrived") actions.push("force_arrived");
  if (status !== "in_progress") actions.push("force_passenger_on_board");
  // Intentionally allow a backward move to `en_route` so the driver can recover
  // from an incorrect advance to `arrived`/`in_progress` without coordinator help.
  if (status !== "en_route") actions.push("force_en_route");
  if (status === "in_progress") actions.push("force_drop_off");
  if (status !== "completed") actions.push("force_complete");
  return actions;
}
