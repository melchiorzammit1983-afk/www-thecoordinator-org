/**
 * Shared helper: past completed trips for a client-facing token.
 *
 * Matching heuristic: pax_tracking_tokens rows sharing the same phone_last4
 * within the same coordinator company_id, joined to jobs completed within
 * the last 12 months. Falls back to same clientcompanyname when phone
 * is not on file.
 */

type AnyAdmin = { from: (table: string) => any };

export type PastTripRow = {
  id: string;
  when: string | null;
  from: string | null;
  to: string | null;
  status: string;
  driver_name: string | null;
  vehicle: string | null;
  plate: string | null;
};

export async function loadPastTripsForJob(
  admin: AnyAdmin,
  currentJobId: string,
): Promise<PastTripRow[]> {
  // Look up current job's company + phone hints.
  const { data: curJob } = await admin.from("jobs")
    .select("id, company_id, contact_phone, clientcompanyname")
    .eq("id", currentJobId).maybeSingle();
  if (!curJob) return [];

  const companyId = (curJob as any).company_id;
  const rawPhone = String((curJob as any).contact_phone ?? "").replace(/\D/g, "");
  const last4 = rawPhone.slice(-4);
  const clientName = (curJob as any).clientcompanyname
    ? String((curJob as any).clientcompanyname).trim()
    : "";

  const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
  const orParts: string[] = [];
  if (last4 && last4.length === 4) {
    orParts.push(`contact_phone.like.%${last4}`);
  }
  if (clientName) {
    // escape commas/percent to keep the PostgREST OR safe
    const safe = clientName.replace(/[,%()]/g, " ").slice(0, 60);
    if (safe) orParts.push(`clientcompanyname.ilike.${safe}`);
  }
  if (orParts.length === 0) return [];

  const { data: rows } = await admin.from("jobs")
    .select("id, pickup_at, date, time, from_location, to_location, status, drivers(name, car_make_model, plate), completed_at")
    .eq("company_id", companyId)
    .neq("id", currentJobId)
    .in("status", ["completed", "in_progress"])
    .gte("pickup_at", twelveMonthsAgo)
    .or(orParts.join(","))
    .order("pickup_at", { ascending: false })
    .limit(10);

  return (rows ?? []).map((r: any) => ({
    id: r.id,
    when: r.completed_at ?? r.pickup_at ?? (r.date && r.time ? `${r.date}T${r.time}:00` : null),
    from: r.from_location ?? null,
    to: r.to_location ?? null,
    status: r.status ?? "completed",
    driver_name: r.drivers?.name ?? null,
    vehicle: r.drivers?.car_make_model ?? null,
    plate: r.drivers?.plate ?? null,
  }));
}
