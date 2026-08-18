type PortRow = { id: string; name: string; code: string | null; address: string };
type BerthRow = { id: string; port_id: string; name: string; address_override: string | null };

/** Minimal, company-scoped Port Directory access for token booking routes. */
export async function listTokenScopedPorts(admin: any, companyId: string) {
  const { data: ports, error: portError } = await admin
    .from("ports")
    .select("id, name, code, address")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
  if (portError) throw new Error(portError.message);
  const ids = (ports ?? []).map((port: PortRow) => port.id);
  if (!ids.length) return [];
  const { data: berths, error: berthError } = await admin
    .from("berths")
    .select("id, port_id, name, address_override")
    .in("port_id", ids)
    .eq("active", true)
    .order("name", { ascending: true });
  if (berthError) throw new Error(berthError.message);
  const byPort = new Map<string, BerthRow[]>();
  for (const berth of (berths ?? []) as BerthRow[]) {
    const list = byPort.get(berth.port_id) ?? [];
    list.push(berth);
    byPort.set(berth.port_id, list);
  }
  return (ports ?? []).map((port: PortRow) => ({ ...port, berths: byPort.get(port.id) ?? [] }));
}

/** Re-check ownership and active status on every token booking submission. */
export async function assertTokenPortSelection(
  admin: any,
  companyId: string,
  portId: string | null | undefined,
  berthId: string | null | undefined,
) {
  if (berthId && !portId) throw new Error("A berth must belong to a selected Port.");
  if (!portId) return null;
  const { data: port, error: portError } = await admin
    .from("ports")
    .select("id, company_id, address, active")
    .eq("id", portId)
    .eq("company_id", companyId)
    .eq("active", true)
    .maybeSingle();
  if (portError) throw new Error(portError.message);
  if (!port) throw new Error("Choose an active Port from this booking company.");
  if (!berthId) return port;
  const { data: berth, error: berthError } = await admin
    .from("berths")
    .select("id, port_id, address_override, active")
    .eq("id", berthId)
    .eq("port_id", portId)
    .eq("active", true)
    .maybeSingle();
  if (berthError) throw new Error(berthError.message);
  if (!berth) throw new Error("Choose an active Berth belonging to this Port.");
  return { ...port, address: berth.address_override || port.address };
}
