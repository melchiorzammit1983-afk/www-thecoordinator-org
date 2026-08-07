type ShipEventRow = { id: string; ship_name: string; port: string; eta: string; status: string };

/** Minimal, company-scoped ship-event access for token booking routes — no
 * search/create, just the active list to link against (mirrors
 * port-directory-token.server.ts). */
export async function listTokenScopedShips(admin: any, companyId: string) {
  const { data: ships, error } = await admin
    .from("ship_events")
    .select("id, ship_name, port, eta, status")
    .eq("company_id", companyId)
    .in("status", ["scheduled", "arrived", "departed"])
    .is("archived_at", null)
    .order("eta", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (ships ?? []) as ShipEventRow[];
}

/** Re-check ownership and active status on every token booking submission. */
export async function assertTokenShipSelection(
  admin: any,
  companyId: string,
  shipEventId: string | null | undefined,
) {
  if (!shipEventId) return null;
  const { data: ship, error } = await admin
    .from("ship_events")
    .select("id, ship_name")
    .eq("id", shipEventId)
    .eq("company_id", companyId)
    .is("archived_at", null)
    .neq("status", "cancelled")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ship) throw new Error("Choose an active ship event from this booking company.");
  return ship as { id: string; ship_name: string };
}
