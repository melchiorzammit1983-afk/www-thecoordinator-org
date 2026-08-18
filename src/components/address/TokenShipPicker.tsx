import { useMemo } from "react";
import { formatMaltaDateTime } from "@/lib/time";

export type TokenShip = {
  id: string;
  ship_name: string;
  port: string;
  eta: string;
  status: string;
};

/** Link to one of the company's scheduled ship events — no search or
 * creation, just the active list (mirrors TokenPortPicker). Used on the
 * portal and public client booking forms, which can't reach the
 * coordinator's authenticated live-search/create ship-event tools. */
export function TokenShipPicker({
  ships,
  shipEventId,
  onChange,
}: {
  ships?: TokenShip[];
  shipEventId?: string | null;
  onChange: (shipEventId: string | null) => void;
}) {
  const ship = useMemo(() => (ships ?? []).find((item) => item.id === shipEventId), [ships, shipEventId]);
  if (!ships?.length) return null;
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-2">
      <select
        className="h-8 w-full rounded-md border bg-background px-2 text-xs"
        value={shipEventId ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Link a scheduled ship (optional)</option>
        {(ships ?? []).map((item) => (
          <option key={item.id} value={item.id}>
            {item.ship_name} · {item.port} · ETA {formatMaltaDateTime(item.eta, { dateStyle: "medium", timeStyle: "short" })}
          </option>
        ))}
      </select>
      {ship ? <p className="text-[11px] text-muted-foreground">{ship.status}</p> : null}
    </div>
  );
}
