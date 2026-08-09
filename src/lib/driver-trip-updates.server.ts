export type DriverTripUpdate = {
  id: string;
  job_id: string;
  changed_fields: Record<string, string>;
  previous_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  created_at: string;
  acknowledged_at: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  from_location: "Pickup location", to_location: "Destination", date: "Date", time: "Pickup time",
  pickup_at: "Pickup time", pickup_display_name: "Pickup location", dropoff_display_name: "Destination", vehicle: "Vehicle",
};

export async function recordDriverTripUpdate(sb: any, existing: Record<string, any>, patch: Record<string, any>, jobId: string, companyId: string) {
  if (!existing.driver_id || !existing.driver_accepted_at || ["completed", "cancelled"].includes(String(existing.status))) return;
  const changed: Record<string, string> = {}, previous: Record<string, unknown> = {}, next: Record<string, unknown> = {};
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    if (!(key in patch) || Object.is(existing[key] ?? null, patch[key] ?? null)) continue;
    changed[key] = label; previous[key] = existing[key] ?? null; next[key] = patch[key] ?? null;
  }
  if (!Object.keys(changed).length) return;
  const { data: current, error: readError } = await sb.from("driver_trip_updates").select("id")
    .eq("job_id", jobId).eq("driver_id", existing.driver_id).is("acknowledged_at", null).maybeSingle();
  if (readError) throw new Error(readError.message);
  const payload = { changed_fields: changed, previous_values: previous, new_values: next };
  if (current) {
    const { error } = await sb.from("driver_trip_updates").update(payload as never).eq("id", current.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from("driver_trip_updates").insert({ job_id: jobId, company_id: companyId, driver_id: existing.driver_id, ...payload } as never);
    if (error) throw new Error(error.message);
  }
}
