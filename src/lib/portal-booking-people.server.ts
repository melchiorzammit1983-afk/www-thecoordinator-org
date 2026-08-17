type BookingPerson = {
  name?: string | null;
  surname?: string | null;
  pax_names?: string[] | null;
  passengers?: Array<{ name: string }>;
  person_type?: "crew" | "visitor";
  organisation?: string | null;
  movement_type?: "on_signing" | "off_signing" | "visitor" | "other";
  flight_information?: string | null;
  hotel_required?: boolean;
  transport_required?: boolean;
  visit_start_date?: string | null;
  visit_end_date?: string | null;
};

/** Add booking people to the existing Operation Workspace member model. */
export async function syncBookingPeopleToOperation(
  admin: any,
  input: BookingPerson,
  operationGroupId: string | null | undefined,
  companyId: string,
  portalCompanyId: string,
) {
  if (!operationGroupId) return;
  const names = (input.pax_names?.length ? input.pax_names : input.passengers?.length ? input.passengers.map((person) => person.name) : [`${input.name ?? ""} ${input.surname ?? ""}`.trim()]).map((name) => name.trim()).filter(Boolean);
  if (!names.length) return;
  const { data: group, error: groupError } = await admin.from("operation_groups").select("id, status")
    .eq("id", operationGroupId).eq("company_id", companyId).eq("portal_company_id", portalCompanyId).maybeSingle();
  if (groupError) throw new Error(groupError.message);
  if (!group) throw new Error("Operation Group not found.");
  if (!["draft", "active"].includes(group.status)) throw new Error("Completed or cancelled Operation Groups cannot accept new people.");
  for (const name of names) {
    const existing = await admin.from("operation_group_members").select("id")
      .eq("operation_group_id", operationGroupId).eq("company_id", companyId).eq("portal_company_id", portalCompanyId)
      .eq("side", "client").eq("name", name).eq("active", true).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) continue;
    const { error } = await admin.from("operation_group_members").insert({
      operation_group_id: operationGroupId, company_id: companyId, portal_company_id: portalCompanyId,
      side: "client", role: "client_viewer", name, email: null, is_primary_approver: false,
      person_type: input.person_type ?? "crew", organisation: input.organisation ?? null,
      movement_type: input.movement_type ?? "other", flight_information: input.flight_information ?? null,
      hotel_required: input.hotel_required ?? false, transport_required: input.transport_required ?? false, notes: null,
      visit_start_date: input.visit_start_date ?? null, visit_end_date: input.visit_end_date ?? null,
    });
    if (error) throw new Error(error.message);
  }
}
