import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, AlertTriangle, Download, Upload, ClipboardPaste } from "lucide-react";
import { cn } from "@/lib/utils";
import { AddressAutocomplete } from "@/components/address/AddressAutocomplete";
import { flightFormatWarning } from "@/lib/flight-code";
import {
  fileToSheetTsv,
  downloadExcelTemplate,
  downloadGoogleSheetsTemplate,
  parseSheetPaste,
  looksLikeSheetPaste,
} from "@/lib/sheet-template";
import { splitPaxNames } from "@/lib/split-pax-names";
import { classifyProviderEndpoint, classifyBulkImportLocationText, type JourneyEndpoint } from "@/lib/journey-resolver";
import { looksLikeLabeledMessage, parseLabeledMessages } from "@/lib/labeled-message-parser";
import type { ParsedTrip } from "@/lib/parse-trips";
import { useServerFn } from "@tanstack/react-start";
import { resolveAddresses } from "@/lib/places.functions";
import { TokenPortPicker, type TokenPort } from "@/components/address/TokenPortPicker";

type GridRow = {
  name: string;
  phone: string;
  email: string;
  from: string;
  fromLocationType: JourneyEndpoint;
  fromPlaceId: string | null;
  fromLat: number | null;
  fromLng: number | null;
  fromPortId: string | null;
  fromBerthId: string | null;
  to: string;
  toLocationType: JourneyEndpoint;
  toPlaceId: string | null;
  toLat: number | null;
  toLng: number | null;
  toPortId: string | null;
  toBerthId: string | null;
  pickupAt: string; // datetime-local value
  room: string;
  flight: string;
  vehicle: string;
  pax: string;
  notes: string;
  personType: "crew" | "visitor";
  hotelRequired: boolean;
  transportRequired: boolean;
  visitStartDate: string;
  visitEndDate: string;
  // Checked rows are merged into a single trip on submit (one shared job,
  // every checked row's passenger names combined) instead of each becoming
  // its own booking — see submitAll().
  selected: boolean;
  // Set when bulk intake auto-fixed a loose address ("airport") into a real
  // Places match — keeps the typed original around so the Undo link can put
  // it straight back.
  fromOriginal?: string | null;
  toOriginal?: string | null;
};

function emptyRow(): GridRow {
  return {
    name: "", phone: "", email: "",
    from: "", fromLocationType: "local", fromPlaceId: null, fromLat: null, fromLng: null, fromPortId: null, fromBerthId: null,
    to: "", toLocationType: "local", toPlaceId: null, toLat: null, toLng: null, toPortId: null, toBerthId: null,
    pickupAt: "", room: "", flight: "", vehicle: "", pax: "1", notes: "", personType: "crew", hotelRequired: false, transportRequired: false, visitStartDate: "", visitEndDate: "", selected: false,
  };
}

// Small tolerance for treating checked rows' pickup times as "the same
// pickup" — a minute or two of typo/rounding difference shouldn't block an
// otherwise-obvious group.
const GROUP_PICKUP_TOLERANCE_MS = 5 * 60_000;

// Order matters — this is the column order a paste from Excel/Sheets is
// assumed to follow, and what tab-separated/comma-separated clipboard text
// gets mapped onto.
const COLUMN_KEYS = [
  "name", "phone", "email", "from", "to", "pickupAt", "room", "flight", "vehicle", "pax", "notes",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: "Passenger(s)", phone: "Phone", email: "Email", from: "From", to: "To",
  pickupAt: "Pickup date & time", room: "Room", flight: "Flight", vehicle: "Vehicle", pax: "Pax", notes: "Notes",
};

// Free-text columns where a comma is ordinary punctuation (an address, a
// list of passenger names, a notes sentence) rather than a spreadsheet
// column separator — a single-cell paste into these must never get
// shredded across cells just because it contains a comma.
const FREE_TEXT_COLS = new Set<ColumnKey>(["from", "to", "name", "notes"]);

function rowHasAnyData(r: GridRow): boolean {
  return !!(r.name || r.phone || r.email || r.from || r.to || r.pickupAt || r.room || r.flight || r.vehicle || r.notes.trim());
}

// Surfaces the detected/selected endpoint type so a pasted/uploaded row's
// guess is visible, not silent — picking a real address or port above
// always overrides it. Nothing shown for "local": the common case.
function EndpointTypeBadge({ type }: { type: JourneyEndpoint }) {
  if (type === "airport") return <span className="block text-[10px] text-blue-700 dark:text-blue-300">✈ Airport</span>;
  if (type === "port") return <span className="block text-[10px] text-cyan-700 dark:text-cyan-300">⚓ Port</span>;
  return null;
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

// Pasted/uploaded text never touches Places, so classify it from the plain
// text (and the company's own Port Directory) instead of defaulting to
// "local" — otherwise every imported flight/ship trip silently loses its
// journey type, tracking, and pickup offset. Picking a real suggestion in
// the address field afterwards always overrides this guess.
function applyCellValue(row: GridRow, key: ColumnKey, raw: string, ports: TokenPort[]): GridRow {
  const v = raw.trim();
  switch (key) {
    case "from": return { ...row, from: v, fromLocationType: classifyBulkImportLocationText(v, ports), fromPlaceId: null, fromLat: null, fromLng: null, fromPortId: null, fromBerthId: null };
    case "to": return { ...row, to: v, toLocationType: classifyBulkImportLocationText(v, ports), toPlaceId: null, toLat: null, toLng: null, toPortId: null, toBerthId: null };
    case "pickupAt": return { ...row, pickupAt: parsePastedDateTime(v) };
    case "pax": return { ...row, pax: v.replace(/[^0-9]/g, "") || "1" };
    default: return { ...row, [key]: v };
  }
}

export function BulkBookingGrid({ token, operationGroups, onCreated }: { token: string; operationGroups: Array<{ id: string; reference: string; name: string; status: string }>; onCreated: () => void }) {
  const [rows, setRows] = useState<GridRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // A batch groups everything submitted together (for display on the
  // Bookings tab below) — kept in state so submitting the grid again before
  // any of these rows are reviewed appends to the same batch instead of
  // starting a new one. The server has the final say (it silently starts a
  // fresh batch if this one's already been touched by the coordinator).
  const [batchId, setBatchId] = useState<string | null>(null);
  const [operationGroupId, setOperationGroupId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ports, setPorts] = useState<TokenPort[]>([]);
  useEffect(() => { fetch(`/api/public/portal/${token}/`).then((r) => r.json()).then((data) => setPorts(data.ports ?? [])).catch(() => undefined); }, [token]);
  const resolveFn = useServerFn(resolveAddresses);
  const [messageText, setMessageText] = useState("");
  const [showMessageBox, setShowMessageBox] = useState(false);

  // Every intake path (message paste, sheet paste, file upload) funnels
  // through the same parsed-trip shape as the coordinator's bulk box, so a
  // trip filed from a portal is built exactly like one filed in-house.
  function tripToRow(t: ParsedTrip): GridRow {
    return {
      name: t.pax.join(", "),
      phone: t.contact_phone,
      email: t.email,
      from: t.from_location,
      fromLocationType: classifyBulkImportLocationText(t.from_location, ports),
      fromPlaceId: t.from_place_id ?? null, fromLat: t.from_lat ?? null, fromLng: t.from_lng ?? null,
      fromPortId: null, fromBerthId: null,
      to: t.to_location,
      toLocationType: classifyBulkImportLocationText(t.to_location, ports),
      toPlaceId: t.to_place_id ?? null, toLat: t.to_lat ?? null, toLng: t.to_lng ?? null,
      toPortId: null, toBerthId: null,
      pickupAt: t.date && t.time ? `${t.date}T${t.time}` : "",
      room: "",
      flight: t.from_flight || t.to_flight || t.flightorship,
      vehicle: t.vehicle,
      pax: String(t.pax.length || 1),
      notes: t.notes,
      selected: false,
    };
  }

  // Bulk intake gives loose text ("airport", "telford 28 4"). Resolve it to a
  // real place the same way the coordinator's bulk paste auto-fix does, so a
  // portal-filed trip carries geodata from the start. Each fixed cell keeps
  // its original text for the Undo link.
  async function enrichRows(list: GridRow[]): Promise<GridRow[]> {
    const items: { key: string; text: string }[] = [];
    list.forEach((r, i) => {
      if (r.from.trim() && !r.fromPlaceId) items.push({ key: `${i}:from`, text: r.from.trim().slice(0, 200) });
      if (r.to.trim() && !r.toPlaceId) items.push({ key: `${i}:to`, text: r.to.trim().slice(0, 200) });
    });
    if (!items.length) return list;
    try {
      const res = await resolveFn({ data: { items: items.slice(0, 200), public_token: token } });
      const results = res.results;
      return list.map((r, i) => {
        const f = results[`${i}:from`];
        const t = results[`${i}:to`];
        let next = r;
        if (f?.address) next = { ...next, fromOriginal: r.from, from: f.address, fromPlaceId: f.place_id, fromLat: f.lat, fromLng: f.lng, fromLocationType: classifyBulkImportLocationText(f.address, ports) };
        if (t?.address) next = { ...next, toOriginal: r.to, to: t.address, toPlaceId: t.place_id, toLat: t.lat, toLng: t.lng, toLocationType: classifyBulkImportLocationText(t.address, ports) };
        return next;
      });
    } catch {
      return list;
    }
  }

  // Accepts either the app's "Label - value" message (see
  // labeled-message-parser.ts — the same text column S of the trips template
  // builds) or rows copied straight out of that template.
  function addFromMessage() {
    const text = messageText.trim();
    const trips = looksLikeLabeledMessage(text)
      ? parseLabeledMessages(text)
      : looksLikeSheetPaste(text)
        ? parseSheetPaste(text)
        : [];
    if (!trips.length) {
      toast.error("Didn't recognise that — paste the \"Message to Copy\" text, or rows copied from the trips template");
      return;
    }
    const newRows = trips.map(tripToRow);
    setRows((prev) => [...prev.filter(rowHasAnyData), ...newRows]);
    toast.success(`Added ${newRows.length} booking${newRows.length === 1 ? "" : "s"}`);
    setMessageText("");
    setShowMessageBox(false);
    void enrichRows(newRows).then((fixed) =>
      setRows((prev) => prev.map((r) => { const i = newRows.indexOf(r); return i === -1 ? r : fixed[i]!; })),
    );
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const tsv = await fileToSheetTsv(file);
      const parsed = parseSheetPaste(tsv);
      if (!parsed.length) { toast.error("Couldn't find any rows in that file"); return; }
      const newRows = parsed.map(tripToRow);
      setRows((prev) => [...prev.filter(rowHasAnyData), ...newRows]);
      toast.success(`Added ${newRows.length} row${newRows.length === 1 ? "" : "s"} from ${file.name}`);
      const fixed = await enrichRows(newRows);
      setRows((prev) => prev.map((r) => { const i = newRows.indexOf(r); return i === -1 ? r : fixed[i]!; }));
    } catch {
      toast.error("Couldn't read that file — check it's a .xlsx, .xls, or .csv");
    } finally {
      setUploading(false);
    }
  }

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
    // A comma alone doesn't imply a multi-cell paste when the target is a
    // free-text column — an address ("123 Main St, Valletta, Malta"), a
    // passenger list ("John Smith, Maria Rossi"), or a notes sentence
    // routinely contains commas and must paste as one value, not get
    // shredded across cells. Tab and newline are unambiguous (Excel/Sheets
    // always uses them for column/row breaks), so those always win.
    const startCol = COLUMN_KEYS[colIndex];
    const isFreeTextCol = FREE_TEXT_COLS.has(startCol);
    const looksMultiCell = hasTab || hasNewline || (text.includes(",") && !isFreeTextCol);
    if (!looksMultiCell) return; // let the browser handle a plain single-cell paste
    e.preventDefault();
    e.stopPropagation();
    const lines = text.split(/\r\n|\r|\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
    setRows((prev) => {
      const next = [...prev];
      lines.forEach((line, li) => {
        // Same free-text-column guard as above, applied per line: a
        // multi-row paste of one address/passenger-list per line must not
        // get comma-shredded either.
        const cells = line.includes("\t") ? line.split("\t") : isFreeTextCol ? [line] : line.split(",");
        const targetRow = rowIndex + li;
        while (next.length <= targetRow) next.push(emptyRow());
        let row = { ...next[targetRow] };
        cells.forEach((cellRaw, ci) => {
          const key = COLUMN_KEYS[colIndex + ci];
          if (!key) return;
          row = applyCellValue(row, key, cellRaw, ports);
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
    const checkedRows = fillable.filter((r) => r.selected);
    if (checkedRows.length >= 2) {
      const first = checkedRows[0];
      const mismatched = checkedRows.slice(1).filter((r) =>
        r.from.trim() !== first.from.trim()
        || r.to.trim() !== first.to.trim()
        || Math.abs(
          (r.pickupAt ? new Date(r.pickupAt).getTime() : 0) - (first.pickupAt ? new Date(first.pickupAt).getTime() : 0),
        ) > GROUP_PICKUP_TOLERANCE_MS,
      );
      if (mismatched.length > 0) {
        toast.error("Checked rows must share the same From, To, and pickup time to be combined into one trip — fix the mismatched row(s) or uncheck them.");
        return;
      }
    }

    setBusy(true);
    try {
      function toPayload(r: GridRow, paxNamesOverride?: string[]) {
        // "Passenger(s)" accepts one name or several (comma/semicolon/"&"/
        // "and"-separated) — the first is used for name/surname display
        // fields, the full list is carried separately so every guest gets a
        // real name instead of "Guest 2"/"Guest 3" placeholders.
        const paxNames = paxNamesOverride ?? splitPaxNames(r.name);
        const [first, ...rest] = (paxNames[0] ?? "").split(/\s+/).filter(Boolean);
        return {
          name: first || null,
          surname: rest.join(" ") || null,
          pax_names: paxNames.length ? paxNames : null,
          client_phone: r.phone.trim() || null,
          client_email: r.email.trim() || null,
          from_location: r.from.trim(),
          from_location_type: r.fromLocationType,
          from_port_id: r.fromPortId,
          from_berth_id: r.fromBerthId,
          from_place_id: r.fromPlaceId,
          from_lat: r.fromLat,
          from_lng: r.fromLng,
          to_location: r.to.trim(),
          to_location_type: r.toLocationType,
          to_port_id: r.toPortId,
          to_berth_id: r.toBerthId,
          to_place_id: r.toPlaceId,
          to_lat: r.toLat,
          to_lng: r.toLng,
          pickup_at: r.pickupAt ? new Date(r.pickupAt).toISOString() : null,
          room_number: r.room.trim() || null,
          flight_number: r.flight.trim() || null,
          vehicle: r.vehicle.trim() || null,
          pax_count: Math.max(Number(r.pax) || 1, paxNames.length || 1),
          notes: r.notes.trim() || null,
          operation_group_id: operationGroupId,
          person_type: r.personType,
          hotel_required: r.hotelRequired,
          transport_required: r.transportRequired,
          visit_start_date: r.personType === "visitor" ? (r.visitStartDate || null) : null,
          visit_end_date: r.personType === "visitor" ? (r.visitEndDate || null) : null,
        };
      }

      const merging = checkedRows.length >= 2;
      const soloRows = merging ? fillable.filter((r) => !r.selected) : fillable;
      const bookings = soloRows.map((r) => toPayload(r));

      if (merging) {
        const combinedNames = checkedRows.flatMap((r) => splitPaxNames(r.name));
        const combinedPaxCount = Math.max(
          combinedNames.length,
          checkedRows.reduce((sum, r) => sum + (Number(r.pax) || 1), 0),
        );
        const withPhone = checkedRows.find((r) => r.phone.trim());
        const withEmail = checkedRows.find((r) => r.email.trim());
        const withVehicle = checkedRows.find((r) => r.vehicle.trim());
        const combined = toPayload(checkedRows[0], combinedNames);
        combined.pax_count = combinedPaxCount;
        combined.client_phone = withPhone?.phone.trim() || null;
        combined.client_email = withEmail?.email.trim() || null;
        combined.vehicle = withVehicle?.vehicle.trim() || null;
        bookings.push(combined);
      }

      const res = await fetch(`/api/public/portal/${token}/bookings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookings, batch_id: batchId ?? undefined }),
      });
      if (!res.ok) { toast.error("Failed to submit"); return; }
      const result = await res.json();
      setBatchId(result.batch_id ?? null);
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
          Fill in rows below, paste tab/comma-separated data copied straight from Excel or Google Sheets, or
          download a template, fill it offline, and upload it back
          (columns: {COLUMN_KEYS.map((k) => COLUMN_LABELS[k]).join(", ")}).
          For a group on one booking, list everyone in Passenger(s), e.g. "John Smith, Maria Rossi" — Pax
          auto-adjusts to match, or bump it higher to add unnamed extra seats. To combine separate rows
          (e.g. entered one guest per row) into a single shared trip instead, check the box on each of those
          rows before submitting — their From/To/pickup time must match.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={downloadExcelTemplate}>
            <Download className="h-3.5 w-3.5 mr-1" /> Template (.xlsx)
          </Button>
          <Button variant="outline" size="sm" onClick={downloadGoogleSheetsTemplate}>
            <Download className="h-3.5 w-3.5 mr-1" /> Template (.csv)
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload className="h-3.5 w-3.5 mr-1" /> {uploading ? "Reading…" : "Upload filled sheet"}
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleUpload} />
          <Button variant="outline" size="sm" onClick={() => setShowMessageBox((v) => !v)}>
            <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Paste a message
          </Button>
          {batchId && (
            <Button variant="ghost" size="sm" onClick={() => setBatchId(null)} title="Next submit will start a fresh batch instead of adding to the last one">
              Start new batch
            </Button>
          )}
        </div>
        {showMessageBox && (
          <div className="space-y-2 rounded-md border bg-muted/20 p-2">
            <p className="text-xs text-muted-foreground">
              Paste a booking message (the same "Operation Name - …" format the template's last column generates —
              copied straight out of WhatsApp/email works too). Pasting more than one message at once adds a
              booking for each.
            </p>
            <Textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={"Operation Name - ...\ndate - ...\ntime - ...\n..."}
              className="min-h-[120px] text-xs font-mono"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={addFromMessage} disabled={!messageText.trim()}>Add to grid</Button>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 rounded-md border bg-muted/20 p-2 md:grid-cols-4"><div className="space-y-1"><Label className="text-xs">Operation (this batch)</Label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={operationGroupId ?? ""} onChange={(e) => setOperationGroupId(e.target.value || null)}><option value="">No Operation</option>{operationGroups.map((group) => <option key={group.id} value={group.id}>{group.reference} · {group.name} ({group.status})</option>)}</select></div><div className="space-y-1"><Label className="text-xs">Person type</Label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={rows[0]?.personType ?? "crew"} onChange={(e) => setRows((current) => current.map((row) => ({ ...row, personType: e.target.value as "crew" | "visitor" })))}><option value="crew">Crew</option><option value="visitor">Visitor</option></select></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rows[0]?.hotelRequired ?? false} onChange={(e) => setRows((current) => current.map((row) => ({ ...row, hotelRequired: e.target.checked })))} /> Hotel required</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rows[0]?.transportRequired ?? false} onChange={(e) => setRows((current) => current.map((row) => ({ ...row, transportRequired: e.target.checked })))} /> Transport required</label></div>
        <div className="overflow-x-auto rounded-md border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" title="Check 2+ rows to combine them into one shared trip">Grp</TableHead>
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
                    <TableCell className="p-1 align-top">
                      <Checkbox
                        checked={row.selected}
                        onCheckedChange={(v) => updateRow(ri, { selected: !!v })}
                        aria-label="Group this row into one trip with other checked rows"
                      />
                    </TableCell>
                    {COLUMN_KEYS.map((key, ci) => (
                      <TableCell key={key} className="p-1 align-top" onPaste={(e) => handlePaste(e, ri, ci)}>
                        {key === "from" && (<>
                          <AddressAutocomplete publicToken={token}
                            value={row.from}
                            placeId={row.fromPlaceId}
                            onChange={(v) => updateRow(ri, { from: v.address, fromLocationType: classifyProviderEndpoint(v.place_types), fromPlaceId: v.place_id, fromLat: v.lat, fromLng: v.lng })}
                            inputClassName="h-8 text-xs"
                            hideBadge
                          />
                          <EndpointTypeBadge type={row.fromLocationType} />
                          {row.fromOriginal && row.fromOriginal !== row.from && (
                            <button type="button" className="block text-[10px] text-muted-foreground underline"
                              onClick={() => updateRow(ri, { from: row.fromOriginal!, fromOriginal: null, fromPlaceId: null, fromLat: null, fromLng: null, fromLocationType: classifyBulkImportLocationText(row.fromOriginal!, ports) })}>
                              Undo auto-fix ("{row.fromOriginal}")
                            </button>
                          )}
                          <TokenPortPicker ports={ports} portId={row.fromPortId} berthId={row.fromBerthId} onChange={({ portId, berthId, address }) => updateRow(ri, { fromPortId: portId, fromBerthId: berthId, fromLocationType: portId ? "port" : "local", ...(address ? { from: address, fromPlaceId: null, fromLat: null, fromLng: null } : {}) })} />
                        </>)}
                        {key === "to" && (<>
                          <AddressAutocomplete publicToken={token}
                            value={row.to}
                            placeId={row.toPlaceId}
                            onChange={(v) => updateRow(ri, { to: v.address, toLocationType: classifyProviderEndpoint(v.place_types), toPlaceId: v.place_id, toLat: v.lat, toLng: v.lng })}
                            inputClassName="h-8 text-xs"
                            hideBadge
                          />
                          <EndpointTypeBadge type={row.toLocationType} />
                          {row.toOriginal && row.toOriginal !== row.to && (
                            <button type="button" className="block text-[10px] text-muted-foreground underline"
                              onClick={() => updateRow(ri, { to: row.toOriginal!, toOriginal: null, toPlaceId: null, toLat: null, toLng: null, toLocationType: classifyBulkImportLocationText(row.toOriginal!, ports) })}>
                              Undo auto-fix ("{row.toOriginal}")
                            </button>
                          )}
                          <TokenPortPicker ports={ports} portId={row.toPortId} berthId={row.toBerthId} onChange={({ portId, berthId, address }) => updateRow(ri, { toPortId: portId, toBerthId: berthId, toLocationType: portId ? "port" : "local", ...(address ? { to: address, toPlaceId: null, toLat: null, toLng: null } : {}) })} />
                        </>)}
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
                        {(key === "name" || key === "phone" || key === "email" || key === "room" || key === "vehicle" || key === "notes") && (
                          <Input className="h-8 text-xs" value={row[key]}
                            placeholder={key === "name" ? "John Smith, Maria Rossi" : key === "vehicle" ? "e.g. Minivan, Sedan" : undefined}
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
