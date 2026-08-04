import { useMemo } from "react";

export type TokenPort = {
  id: string;
  name: string;
  code?: string | null;
  address: string;
  berths: Array<{ id: string; name: string; address_override?: string | null }>;
};

export function TokenPortPicker({
  ports,
  portId,
  berthId,
  onChange,
}: {
  ports?: TokenPort[];
  portId?: string | null;
  berthId?: string | null;
  onChange: (value: { portId: string | null; berthId: string | null; address?: string }) => void;
}) {
  const port = useMemo(() => (ports ?? []).find((item) => item.id === portId), [ports, portId]);
  const berth = port?.berths.find((item) => item.id === berthId);
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-2">
      <select className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={portId ?? ""} onChange={(event) => {
        const id = event.target.value || null;
        const next = (ports ?? []).find((item) => item.id === id);
        onChange({ portId: id, berthId: null, address: next?.address });
      }}>
        <option value="">Select a Port (optional)</option>
        {(ports ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.code ? ` (${item.code})` : ""}</option>)}
      </select>
      {port ? <select className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={berthId ?? ""} onChange={(event) => {
        const id = event.target.value || null;
        const next = port.berths.find((item) => item.id === id);
        onChange({ portId: portId ?? null, berthId: id, address: next?.address_override ?? port.address });
      }}>
        <option value="">No berth selected</option>
        {port.berths.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select> : null}
      {berth?.address_override || port?.address ? <p className="text-[11px] text-muted-foreground">{berth?.address_override ?? port?.address}</p> : null}
    </div>
  );
}
