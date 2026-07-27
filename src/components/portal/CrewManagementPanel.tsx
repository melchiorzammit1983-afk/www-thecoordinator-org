import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Plus, Trash2 } from "lucide-react";
import { parseBulkCrewPaste, type ParsedCrewRow, type ParseCrewError } from "@/lib/parse-crew";

type CrewMember = {
  id: string;
  name: string;
  surname: string;
  phone: string | null;
  email: string;
  nationality: string | null;
  ship_name: string | null;
  link_token: string;
  legs: { leg_number: number; from_location: string; to_location: string; flight_number: string | null; departure_date: string | null }[];
};

const EMPTY_ROW: ParsedCrewRow = {
  date: "", name: "", surname: "", phone: "", email: "", from: "",
  flight1: "", flight2: "", flight3: "", to: "",
  flight_from1: "", flight_from2: "", flight_from3: "", nationality: "", ship: "",
};

function crewPortalUrl(token: string) {
  if (typeof window === "undefined") return `/crew-portal?token=${token}`;
  return `${window.location.origin}/crew-portal?token=${token}`;
}

export function CrewManagementPanel({ token }: { token: string }) {
  const [savedCrew, setSavedCrew] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRows, setPendingRows] = useState<ParsedCrewRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ParsedCrewRow>(EMPTY_ROW);
  const [bulkText, setBulkText] = useState("");
  const [bulkErrors, setBulkErrors] = useState<ParseCrewError[]>([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/public/portal/${token}/crew`);
      const j = await r.json();
      if (r.ok) setSavedCrew(j.crew ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [token]);

  function addFormRow() {
    if (!form.name.trim() || !form.surname.trim() || !form.email.trim()) {
      toast.error("Name, surname, and email are required");
      return;
    }
    setPendingRows((rows) => [...rows, form]);
    setForm(EMPTY_ROW);
    setFormOpen(false);
  }

  function parseBulk() {
    if (!bulkText.trim()) return;
    const { rows, errors } = parseBulkCrewPaste(bulkText);
    setPendingRows((prev) => [...prev, ...rows]);
    setBulkErrors(errors);
    if (rows.length) setBulkText("");
    if (rows.length && !errors.length) toast.success(`Parsed ${rows.length} crew row${rows.length === 1 ? "" : "s"}`);
  }

  function removePending(index: number) {
    setPendingRows((rows) => rows.filter((_, i) => i !== index));
  }

  async function saveAll() {
    if (!pendingRows.length) return;
    setSaving(true);
    toast.message(`Saving ${pendingRows.length} crew…`);
    try {
      const r = await fetch(`/api/public/portal/${token}/crew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: pendingRows }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error ?? "Save failed");
        return;
      }
      const failedRows = (j.results ?? []).filter((res: any) => res && !res.ok);
      if (j.saved > 0) toast.success(`Saved ${j.saved} crew`);
      if (failedRows.length) {
        failedRows.forEach((res: any) => toast.error(res.error ?? "Row failed"));
        // Keep only the rows that failed so HR can fix and retry.
        setPendingRows(failedRows.map((res: any) => pendingRows[res.index]).filter(Boolean));
      } else {
        setPendingRows([]);
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteCrew(id: string) {
    if (!confirm("Remove this crew member?")) return;
    const r = await fetch(`/api/public/portal/${token}/crew/${id}`, { method: "DELETE" });
    if (!r.ok) { toast.error("Delete failed"); return; }
    toast.success("Crew removed");
    setSavedCrew((rows) => rows.filter((c) => c.id !== id));
  }

  async function copyLink(row: CrewMember) {
    const url = crewPortalUrl(row.link_token);
    await navigator.clipboard.writeText(url).catch(() => {});
    toast.success("Crew link copied");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        Add crew one at a time or paste a list (tab- or comma-separated). Nothing is saved until you click "Save all".
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-base">Add crew</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant={formOpen ? "secondary" : "outline"} onClick={() => setFormOpen((v) => !v)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add one
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {formOpen && (
            <div className="space-y-3 border rounded-md p-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="First name*"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Surname*"><Input value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} /></Field>
                <Field label="Email*"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                <Field label="Nationality"><Input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} /></Field>
                <Field label="Ship"><Input value={form.ship} onChange={(e) => setForm({ ...form, ship: e.target.value })} /></Field>
              </div>
              <div className="text-xs font-medium text-muted-foreground pt-1">Itinerary</div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
                <Field label="From"><Input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
                <Field label="To"><Input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
                <Field label="Flight 1"><Input value={form.flight1} onChange={(e) => setForm({ ...form, flight1: e.target.value })} /></Field>
                <Field label="Leg 2 from"><Input value={form.flight_from2} onChange={(e) => setForm({ ...form, flight_from2: e.target.value })} /></Field>
                <Field label="Flight 2"><Input value={form.flight2} onChange={(e) => setForm({ ...form, flight2: e.target.value })} /></Field>
                <Field label="Leg 3 from"><Input value={form.flight_from3} onChange={(e) => setForm({ ...form, flight_from3: e.target.value })} /></Field>
                <Field label="Flight 3"><Input value={form.flight3} onChange={(e) => setForm({ ...form, flight3: e.target.value })} /></Field>
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={addFormRow}>Add to list</Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs">Bulk paste</Label>
            <Textarea
              rows={4}
              placeholder={"date, name, surname, phone, email, from, flight1, flight2, flight3, to, flight_from1, flight_from2, flight_from3, nationality, ship"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            <div className="flex justify-between items-center">
              <p className="text-[11px] text-muted-foreground">One crew member per line. Header row optional.</p>
              <Button size="sm" variant="outline" onClick={parseBulk} disabled={!bulkText.trim()}>Parse</Button>
            </div>
            {bulkErrors.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive space-y-0.5">
                {bulkErrors.map((e, i) => <div key={i}>Line {e.line}: {e.message}</div>)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {pendingRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Unsaved crew ({pendingRows.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.name} {row.surname}</TableCell>
                    <TableCell className="text-xs">{row.email}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.from || "—"} → {row.to || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => removePending(i)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="p-3 flex justify-end border-t">
              <Button onClick={saveAll} disabled={saving}>{saving ? "Saving…" : `Save all (${pendingRows.length})`}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Crew</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Ship</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && savedCrew.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No crew added yet.</TableCell></TableRow>
              )}
              {savedCrew.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name} {c.surname}</TableCell>
                  <TableCell className="text-xs">{c.email}{c.phone ? ` · ${c.phone}` : ""}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.ship_name || "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => copyLink(c)}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Generate link
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteCrew(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><Label className="text-xs">{label}</Label>{children}</div>);
}
