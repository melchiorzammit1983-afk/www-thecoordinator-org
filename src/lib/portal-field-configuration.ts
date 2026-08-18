export const PORTAL_BOOKING_FIELDS = [
  { key: "pickup", label: "Pickup", locked: true, defaultMode: "required" },
  { key: "destination", label: "Destination", locked: true, defaultMode: "required" },
  { key: "pickup_date", label: "Pickup date", locked: true, defaultMode: "required" },
  { key: "pickup_time", label: "Pickup time", locked: true, defaultMode: "required" },
  { key: "passenger", label: "Passenger", capability: "add_passengers", defaultMode: "required" },
  { key: "contact_phone", label: "Contact phone", defaultMode: "optional" },
  { key: "operation_group", label: "Operation Group", capability: "select_operation_group", defaultMode: "optional" },
  { key: "notes", label: "Notes", capability: "add_notes", defaultMode: "optional" },
] as const;

export type PortalBookingFieldKey = (typeof PORTAL_BOOKING_FIELDS)[number]["key"];
export type PortalBookingFieldMode = "hidden" | "optional" | "required";
export type PortalBookingFieldSetting = { mode: PortalBookingFieldMode };
export type PortalBookingFieldConfiguration = Partial<Record<PortalBookingFieldKey, PortalBookingFieldSetting>>;
export type NormalizedPortalBookingFields = Record<PortalBookingFieldKey, PortalBookingFieldSetting>;

type CapabilityConfiguration = Record<string, boolean | undefined>;

const VALID_MODES = new Set<PortalBookingFieldMode>(["hidden", "optional", "required"]);

export function normalizePortalBookingFields(
  fields: PortalBookingFieldConfiguration | null | undefined,
  capabilities: CapabilityConfiguration = {},
): NormalizedPortalBookingFields {
  return Object.fromEntries(PORTAL_BOOKING_FIELDS.map((definition) => {
    const capability = "capability" in definition ? definition.capability : null;
    const requested = fields?.[definition.key]?.mode;
    let mode: PortalBookingFieldMode = requested && VALID_MODES.has(requested)
      ? requested
      : definition.defaultMode;

    if ("locked" in definition && definition.locked) mode = "required";
    if (capability && capabilities[capability] !== true) mode = "hidden";

    return [definition.key, { mode }];
  })) as NormalizedPortalBookingFields;
}

export function isPortalFieldVisible(fields: NormalizedPortalBookingFields, key: PortalBookingFieldKey) {
  return fields[key].mode !== "hidden";
}

export function isPortalFieldRequired(fields: NormalizedPortalBookingFields, key: PortalBookingFieldKey) {
  return fields[key].mode === "required";
}
