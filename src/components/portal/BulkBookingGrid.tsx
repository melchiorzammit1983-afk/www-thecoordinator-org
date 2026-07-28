import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AddressAutocomplete } from "@/components/address/AddressAutocomplete";
import { flightFormatWarning } from "@/lib/flight-code";

type GridRow = {
  name: string;
  phone: string;
  email: string;
  from: string;
  fromPlaceId: string | null;
  fromLat: number | null;
  fromLng: number | null;
  to: string;
  toPlaceId: string | null;
  toLat: number | null;
  toLng: number | null;
  pickupAt: string; // datetime-local value
  room: string;
  flight: string;
  pax: string;
  notes: string;
};

function emptyRow(): GridRow {
  return {
    name: "", phone: "", email: "",
    from: "", fromPlaceId: null, fromLat: null, fromLng: null,
    to: "", toPlaceId: null, toLat: null, toLng: null,
    pickupAt: "", room: "", flight: "", pax: "1", notes: "",
  };
}

// Order matters — this is the column order a paste from Excel/Sheets is
// assumed to follow, and what tab-separated/comma-separated clipboard text
// gets mapped onto.
const COLUMN_KEYS = [
  "name", "phone", "email", "from", "to", "pickupAt", "room", "flight", "pax", "notes",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: "Name", phone: "Phone", email: "Email", from: "From", to: "To",
  pickupAt: "Pickup date & time", room: "Room", flight: "Flight", pax: "Pax", notes: "Notes",
};

function rowHasAnyData(r: GridRow): boolean {
  return !!(r.name || r.phone || r.email || r.from || r.to || r.pickupAt || r.room || r.flight || r.notes.trim());
}

// Best-effort parse of a pasted date/time cell into the value a
// datetime-local input accepts (YYYY-MM-DDTHH:mm). Silently leaves the cell
// blank if we can't confidently parse it — the coordinator/company can fill
// it in by hand, same as any other cell we couldn't parse.
function parsePastedDateTime(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function applyCellValue(row: GridRow, key: ColumnKey, raw: string): GridRow {
  const v = raw.trim();
  switch (key) {
    case "from": return { ...row, from: v, fromPlaceId: null, fromLat: null, fromLng: null };
    case "to": return { ...row, to: v, toPlaceId: null, toLat: null, toLng: null };
    case "pickupAt": return { ...row, pickupAt: parsePastedDateTime(v) };
    case "pax": return { ...row, pax: v.replace(/[^0-9]/g, "") || "1" };
    default: return { ...row, [key]: v };
  }
}

export function BulkBookingGrid({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [rows, setRows] = useState<GridRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);

  function updateRow(index: number, patch: Partial<GridRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLElement>, rowIndex: number, colIndex: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const hasTab = text.includes("\t");
    const hasNewline = /\r\n|\r|\n/.test(text.trim());
    // A comma alone doesn't imply a multi-cell paste when the target is an
    // address column — a single street address routinely contains commas
    // ("123 Main St, Valletta, Malta") and must paste as one value, not get
    // shredded across cells. Tab and newline are unambiguous (Excel/Sheets
    // always uses them for column/row breaks), so those always win.
    const startCol = COLUMN_KEYS[colIndex];
    const isAddressCol = startCol === "from" || startCol === "to";
    const looksMultiCell = hasTab || hasNewline || (text.includes(",") && !isAddressCol);
    if (!looksMultiCell) return; // let the browser handle a plain single-cell paste
    e.preventDefault();
    e.stopPropagation();
    const lines = text.split(/\r\n|\r|\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
    setRows((prev) => {
      const next = [...prev];
      lines.forEach((line, li) => {
        // Same address-column guard as above, applied per line: a multi-row
        // paste of one address per line must not get comma-shredded either.
        const cells = line.includes("\t") ? line.split("\t") : isAddressCol ? [line] : line.split(",");
        const targetRow = rowIndex + li;
        while (next.length <= targetRow) next.push(emptyRow());
        let row = { ...next[targetRow] };
        cells.forEach((cellRaw, ci) => {
          const key = COLUMN_KEYS[colIndex + ci];
          if (!key) return;
          row = applyCellValue(row, key, cellRaw);
        });
        next[targetRow] = row;
      });
      return next;
    });
  }

  async function submitAll() {
    const fillable = rows.filter(rowHasAnyData);
    if (fillable.length === 0) {
      toast.error("Add at least one row before submitting");
      return;
    }
    const missing = fillable.filter((r) => !r.from.trim() || !r.to.trim());
    if (missing.length > 0) {
      toast.error(`${missing.length} row${missing.length === 1 ? "" : "s"} missing From/To — fill those in before submitting`);
      return;
    }
    setBusy(true);
    try {
      const bookings = fillable.map((r) => {
        const [first, ...rest] = r.name.trim().split(/\s+/).filter(Boolean);
        return {
          name: first || null,
          surname: rest.join(" ") || null,
          client_phone: r.phone.trim() || null,
          client_email: r.email.trim() || null,
          from_location: r.from.trim(),
          from_place_id: r.fromPlaceId,
          from_lat: r.fromLat,
          from_lng: r.fromLng,
          to_location: r.to.trim(),
          to_place_id: r.toPlaceId,
          to_lat: r.toLat,
          to_lng: r.toLng,
          pickup_at: r.pickupAt ? new Date(r.pickupAt).toISOString() : null,
          room_number: r.room.trim() || null,
          flight_number: r.flight.trim() || null,
          pax_count: Number(r.pax) || 1,
          notes: r.notes.trim() || null,
        };
      });
      const res = await fetch(`/api/public/portal/${token}/bookings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookings }),
      });
      if (!res.ok) { toast.error("Failed to submit"); return; }
      toast.success(`${bookings.length} booking${bookings.length === 1 ? "" : "s"} submitted — awaiting coordinator approval`);
      setRows([emptyRow(), emptyRow(), emptyRow()]);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bulk booking entry</CardTitle>
        <p className="text-xs text-muted-foreground">
          Fill in rows below, or paste tab/comma-separated data copied straight from Excel or Google Sheets
          (columns: {COLUMN_KEYS.map((k) => COLUMN_LABELS[k]).join(", ")}).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-md border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                {COLUMN_KEYS.map((key) => (
                  <TableHead key={key} className="whitespace-nowrap px-2 py-2 min-w-[120px]">{COLUMN_LABELS[key]}</TableHead>
                ))}
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, ri) => {
                const flightWarning = flightFormatWarning(row.flight);
                return (
                  <TableRow key={ri}>
                    {COLUMN_KEYS.map((key, ci) => (
                      <TableCell key={key} className="p-1 align-top" onPaste={(e) => handlePaste(e, ri, ci)}>
                        {key === "from" && (
                          <AddressAutocomplete
                            value={row.from}
                            placeId={row.fromPlaceId}
                            onChange={(v) => updateRow(ri, { from: v.address, fromPlaceId: v.place_id, fromLat: v.lat, fromLng: v.lng })}
                            inputClassName="h-8 text-xs"
                            hideBadge
                          />
                        )}
                        {key === "to" && (
                          <AddressAutocomplete
                            value={row.to}
                            placeId={row.toPlaceId}
                            onChange={(v) => updateRow(ri, { to: v.address, toPlaceId: v.place_id, toLat: v.lat, toLng: v.lng })}
                            inputClassName="h-8 text-xs"
                            hideBadge
                          />
                        )}
                        {key === "pickupAt" && (
                          <Input type="datetime-local" className="h-8 text-xs" value={row.pickupAt}
                            onChange={(e) => updateRow(ri, { pickupAt: e.target.value })} />
                        )}
                        {key === "pax" && (
                          <Input type="number" min={1} className="h-8 w-16 text-xs" value={row.pax}
                            onChange={(e) => updateRow(ri, { pax: e.target.value })} />
                        )}
                        {key === "flight" && (
                          <div className="relative">
                            <Input className={cn("h-8 text-xs", flightWarning && "border-red-500 focus-visible:ring-red-500 pr-6")}
                              value={row.flight} onChange={(e) => updateRow(ri, { flight: e.target.value })}
                              placeholder="e.g. FR1234" />
                            {flightWarning && (
                              <AlertTriangle
                                className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-red-500"
                                aria-label={flightWarning}
                              />
                            )}
                          </div>
                        )}
                        {(key === "name" || key === "phone" || key === "email" || key === "room" || key === "notes") && (
                          <Input className="h-8 text-xs" value={row[key]}
                            onChange={(e) => updateRow(ri, { [key]: e.target.value } as Partial<GridRow>)} />
                        )}
                        {key === "flight" && flightWarning && (
                          <div className="mt-1 text-[10px] text-red-600 leading-tight">{flightWarning}</div>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="p-1 align-top">
                      <Button size="icon" variant="ghost" onClick={() => removeRow(ri)} title="Remove row">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add row
          </Button>
          <Button onClick={submitAll} disabled={busy}>Submit for approval</Button>
        </div>
      </CardContent>
    </Card>
  );
}
