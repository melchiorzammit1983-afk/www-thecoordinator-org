import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, Printer, Filter, RefreshCw, Check, X, Wallet } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  buildStatement, listDrivers, listLabels,
  markJobPayment, unmarkJobPayment, bulkMarkPayment,
} from "@/lib/coordinator.functions";
import { listConnections } from "@/lib/collab.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useMyCompany } from "@/hooks/use-coordinator";

export const Route = createFileRoute("/_authenticated/coordinator/statements")({
  head: () => ({ meta: [{ title: "Statements — Coordinator" }] }),
  component: StatementsPage,
});

type Row = {
  id: string; date: string; time: string; pickup_at: string | null;
  status: string; payment_status: string;
  from_location: string; to_location: string;
  flight: string; flight_status: string; flight_status_note: string;
  client: string; vehicle: string;
  driver_name: string; driver_phone: string; driver_vehicle: string;
  pax_count: number; pax_names: string; pax_boarded: number;
  labels: string; label_colors: string;
  company_name: string; origin_company: string; executor_company: string;
  chain: string; chain_hops: number; dispatch_status: string;
  driver_accepted_at: string | null; deletion_requested_at: string | null;
  created_at: string;
  price_amount: number | null; price_currency: string; payment_method: string;
  price_display: string; price_set_by: string;
  driver_actual_minutes: number | null; driver_reported_km: number | null;
  paid_at: string | null; paid_amount: number | null; paid_method: string;
  paid_reference: string; paid_by_role: string;
  driver_paid_at: string | null; driver_paid_amount: number | null; driver_paid_method: string;
  driver_paid_reference: string; driver_payout_status: string;
  hops: { index: number; from: string; to: string; status: string; decided_at: string | null; note: string }[];
  pax_rows: { id: string; name: string; status: string; boarded_at: string | null }[];
};

type Statement = {
  generated_at: string;
  company: { id: string; name: string };
  rows: Row[]; total_trips: number; total_pax: number; truncated: boolean;
  totals?: {
    billed: number; received_client: number; received_driver: number;
    outstanding_client: number; outstanding_driver: number;
  };
};

const ALL_COLUMNS: { key: keyof Row | "chain_detail" | "actions"; label: string; group: string }[] = [
  { key: "date", label: "Date", group: "Trip" },
  { key: "time", label: "Time", group: "Trip" },
  { key: "status", label: "Status", group: "Trip" },
  { key: "payment_status", label: "Client paid?", group: "Payment" },
  { key: "paid_amount", label: "Received (client)", group: "Payment" },
  { key: "paid_method", label: "Payment method", group: "Payment" },
  { key: "paid_at", label: "Received on", group: "Payment" },
  { key: "paid_reference", label: "Payment ref.", group: "Payment" },
  { key: "driver_payout_status", label: "Driver paid?", group: "Payment" },
  { key: "driver_paid_amount", label: "Payout amount", group: "Payment" },
  { key: "driver_paid_method", label: "Payout method", group: "Payment" },
  { key: "driver_paid_at", label: "Payout on", group: "Payment" },
  { key: "actions", label: "Mark paid", group: "Payment" },
  { key: "payment_method", label: "Agreed method", group: "Trip" },
  { key: "price_display", label: "Amount", group: "Trip" },
  { key: "price_amount", label: "Amount (number)", group: "Trip" },
  { key: "price_currency", label: "Currency", group: "Trip" },
  { key: "price_set_by", label: "Price set by", group: "Trip" },
  { key: "labels", label: "Labels", group: "Trip" },
  { key: "client", label: "Client company", group: "Trip" },
  { key: "created_at", label: "Created", group: "Trip" },
  { key: "from_location", label: "From", group: "Route" },
  { key: "to_location", label: "To", group: "Route" },
  { key: "flight", label: "Flight", group: "Route" },
  { key: "flight_status", label: "Flight status", group: "Route" },
  { key: "driver_name", label: "Driver", group: "People" },
  { key: "driver_phone", label: "Driver phone", group: "People" },
  { key: "driver_vehicle", label: "Driver vehicle", group: "People" },
  { key: "vehicle", label: "Trip vehicle", group: "People" },
  { key: "pax_count", label: "Pax count", group: "People" },
  { key: "pax_names", label: "Passenger names", group: "People" },
  { key: "pax_boarded", label: "Boarded", group: "People" },
  { key: "driver_actual_minutes", label: "Duration (min)", group: "People" },
  { key: "driver_reported_km", label: "Distance (km)", group: "People" },
  { key: "company_name", label: "Owner company", group: "Chain" },
  { key: "origin_company", label: "Origin", group: "Chain" },
  { key: "executor_company", label: "Executor", group: "Chain" },
  { key: "chain", label: "Chain (A → B → C)", group: "Chain" },
  { key: "chain_hops", label: "Chain hops", group: "Chain" },
  { key: "dispatch_status", label: "Dispatch status", group: "Chain" },
  { key: "driver_accepted_at", label: "Accepted at", group: "Ops" },
  { key: "deletion_requested_at", label: "Deletion requested", group: "Ops" },
];
const DEFAULT_COLS = ["date", "time", "from_location", "to_location", "driver_name", "price_display", "payment_status", "paid_amount", "driver_payout_status", "actions"];
const STORAGE_KEY = "statement:columns:v4";


const STATUSES = ["pending", "assigned", "accepted", "en_route", "arrived", "in_progress", "completed", "cancelled"];
const PAYMENT_STATUSES = ["pending", "partial", "paid"];
const FLIGHT_STATUSES = ["scheduled", "active", "landed", "delayed", "cancelled", "diverted"];

function StatementsPage() {
  const { data: company } = useMyCompany();
  const [filters, setFilters] = useState({
    from: "" as string, to: "" as string,
    status: [] as string[], payment_status: [] as string[],
    driver_ids: [] as string[], include_unassigned: false,
    label_ids: [] as string[],
    company_scope: "own" as "own" | "chain" | "all",
    partner_company_ids: [] as string[],
    flight_contains: "", flight_status: [] as string[],
    from_contains: "", to_contains: "", pax_contains: "", search: "",
    deletion_only: false,
  });
  const [selectedCols, setSelectedCols] = useState<string[]>(() => {
    if (typeof window === "undefined") return DEFAULT_COLS;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return DEFAULT_COLS;
  });
  const [includeChain, setIncludeChain] = useState(false);
  const [includePax, setIncludePax] = useState(false);

  function saveCols(next: string[]) {
    setSelectedCols(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  const buildFn = useServerFn(buildStatement);
  const driversFn = useServerFn(listDrivers);
  const labelsFn = useServerFn(listLabels);
  const connectionsFn = useServerFn(listConnections);
  const markFn = useServerFn(markJobPayment);
  const unmarkFn = useServerFn(unmarkJobPayment);
  const bulkFn = useServerFn(bulkMarkPayment);
  const qc = useQueryClient();

  const { data: drivers } = useQuery({ queryKey: ["drivers"], queryFn: () => driversFn() as Promise<any[]> });
  const { data: labels } = useQuery({ queryKey: ["trip-labels"], queryFn: () => labelsFn() as Promise<any[]> });
  const { data: connections } = useQuery({ queryKey: ["connections"], queryFn: () => connectionsFn() as Promise<any[]> });

  const { data: statement, isFetching, refetch } = useQuery({
    queryKey: ["statement", filters],
    queryFn: () => buildFn({ data: filters }) as Promise<Statement>,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSide, setBulkSide] = useState<"client" | "driver">("client");
  const [bulkMethod, setBulkMethod] = useState<string>("cash");

  const bulkMut = useMutation({
    mutationFn: (ids: string[]) => bulkFn({ data: { job_ids: ids, side: bulkSide, method: bulkMethod as any } }) as Promise<any>,
    onSuccess: (r) => {
      toast.success(`Marked ${r.updated}/${r.total} trips as paid`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["statement"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markMut = useMutation({
    mutationFn: (v: { job_id: string; side: "client" | "driver"; amount?: number; method?: string; reference?: string }) =>
      markFn({ data: v as any }) as Promise<any>,
    onSuccess: () => {
      toast.success("Marked as paid");
      qc.invalidateQueries({ queryKey: ["statement"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unmarkMut = useMutation({
    mutationFn: (v: { job_id: string; side: "client" | "driver" }) =>
      unmarkFn({ data: v }) as Promise<any>,
    onSuccess: () => {
      toast.success("Payment cleared");
      qc.invalidateQueries({ queryKey: ["statement"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cols = useMemo(
    () => ALL_COLUMNS.filter((c) => selectedCols.includes(c.key as string)),
    [selectedCols],
  );

  function renderCell(row: Row, key: string) {
    if (key === "actions") {
      return (
        <div className="flex gap-1">
          <MarkPaidPopover row={row} side="client" onSubmit={(v) => markMut.mutate({ job_id: row.id, side: "client", ...v })}
            onClear={() => unmarkMut.mutate({ job_id: row.id, side: "client" })} />
          <MarkPaidPopover row={row} side="driver" onSubmit={(v) => markMut.mutate({ job_id: row.id, side: "driver", ...v })}
            onClear={() => unmarkMut.mutate({ job_id: row.id, side: "driver" })} />
        </div>
      );
    }
    if (key === "payment_status" || key === "driver_payout_status") {
      const v = (row as any)[key] || "pending";
      const tone = v === "paid" ? "bg-emerald-100 text-emerald-800 border-emerald-300"
        : v === "partial" ? "bg-amber-100 text-amber-800 border-amber-300"
        : "bg-muted text-muted-foreground border-border";
      return <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${tone}`}>{v}</span>;
    }
    const v = (row as any)[key];
    if (v === null || v === undefined || v === "") return "—";
    if (key.endsWith("_at") || key === "created_at") {
      try { return new Date(v).toLocaleString(); } catch { return String(v); }
    }
    if (key === "paid_amount" || key === "driver_paid_amount") {
      const cur = row.price_currency || "EUR";
      return `${Number(v).toFixed(2)} ${cur}`;
    }
    return String(v);
  }

  function exportRows(): Record<string, unknown>[] {
    if (!statement) return [];
    const out: Record<string, unknown>[] = [];
    for (const r of statement.rows) {
      if (includePax && r.pax_rows.length) {
        for (const p of r.pax_rows) {
          const base: Record<string, unknown> = {};
          for (const c of cols) base[c.label] = (r as any)[c.key] ?? "";
          base["Passenger"] = p.name;
          base["Pax status"] = p.status;
          base["Boarded at"] = p.boarded_at ? new Date(p.boarded_at).toLocaleString() : "";
          if (includeChain) base["Chain detail"] = r.hops.map((h) => `${h.from}→${h.to} (${h.status})`).join(" | ");
          out.push(base);
        }
      } else {
        const base: Record<string, unknown> = {};
        for (const c of cols) base[c.label] = (r as any)[c.key] ?? "";
        if (includeChain) base["Chain detail"] = r.hops.map((h) => `${h.from}→${h.to} (${h.status})`).join(" | ");
        out.push(base);
      }
    }
    return out;
  }

  function fileBase() {
    const slug = (company?.name ?? "company").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `statement_${slug}_${filters.from || "all"}_${filters.to || "all"}`;
  }

  function exportCSV() {
    const rows = exportRows();
    if (!rows.length) { toast.info("Nothing to export"); return; }
    const headers = Object.keys(rows[0]);
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${fileBase()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportXLSX() {
    const rows = exportRows();
    if (!rows.length) { toast.info("Nothing to export"); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statement");
    XLSX.writeFile(wb, `${fileBase()}.xlsx`);
  }

  function toggleInArray<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];
    if (filters.from || filters.to) chips.push(`${filters.from || "…"} → ${filters.to || "…"}`);
    if (filters.status.length) chips.push(`Status: ${filters.status.join(", ")}`);
    if (filters.payment_status.length) chips.push(`Payment: ${filters.payment_status.join(", ")}`);
    if (filters.driver_ids.length) chips.push(`${filters.driver_ids.length} driver(s)`);
    if (filters.include_unassigned) chips.push("Incl. unassigned");
    if (filters.label_ids.length) chips.push(`${filters.label_ids.length} label(s)`);
    if (filters.company_scope !== "own") chips.push(`Scope: ${filters.company_scope}`);
    if (filters.partner_company_ids.length) chips.push(`${filters.partner_company_ids.length} partner(s)`);
    if (filters.flight_contains) chips.push(`Flight: ${filters.flight_contains}`);
    if (filters.flight_status.length) chips.push(`Flight status: ${filters.flight_status.join(", ")}`);
    if (filters.from_contains) chips.push(`From: ${filters.from_contains}`);
    if (filters.to_contains) chips.push(`To: ${filters.to_contains}`);
    if (filters.pax_contains) chips.push(`Pax: ${filters.pax_contains}`);
    if (filters.search) chips.push(`Search: ${filters.search}`);
    if (filters.deletion_only) chips.push("Deletion requested only");
    return chips;
  }, [filters]);

  const groups = useMemo(() => {
    const map: Record<string, typeof ALL_COLUMNS> = {};
    for (const c of ALL_COLUMNS) { (map[c.group] ||= []).push(c); }
    return map;
  }, []);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <style>{`@media print {
        aside, .no-print { display: none !important; }
        main { padding: 0 !important; }
        .print-only { display: block !important; }
        table { font-size: 11px; }
      }`}</style>

      <div className="flex items-start justify-between gap-3 flex-wrap no-print">
        <div>
          <h1 className="text-2xl font-semibold">Statements</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Detailed trip report — filter, pick columns, then export.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4 mr-1" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={exportXLSX}><FileSpreadsheet className="h-4 w-4 mr-1" /> XLSX</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print / PDF</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 no-print">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Filter className="h-4 w-4" /> Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">From date</Label>
                <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">To date</Label>
                <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Flight contains</Label>
                <Input value={filters.flight_contains} onChange={(e) => setFilters((f) => ({ ...f, flight_contains: e.target.value }))} placeholder="e.g. KM101" /></div>
              <div className="space-y-1"><Label className="text-xs">Free search</Label>
                <Input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="text…" /></div>
              <div className="space-y-1"><Label className="text-xs">From contains</Label>
                <Input value={filters.from_contains} onChange={(e) => setFilters((f) => ({ ...f, from_contains: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">To contains</Label>
                <Input value={filters.to_contains} onChange={(e) => setFilters((f) => ({ ...f, to_contains: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Passenger name</Label>
                <Input value={filters.pax_contains} onChange={(e) => setFilters((f) => ({ ...f, pax_contains: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Company scope</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={filters.company_scope}
                  onChange={(e) => setFilters((f) => ({ ...f, company_scope: e.target.value as any }))}>
                  <option value="own">Own trips only</option>
                  <option value="chain">Chain-visible</option>
                  <option value="all">Own + chain</option>
                </select>
              </div>
            </div>

            <FilterMultiRow label="Status" options={STATUSES}
              selected={filters.status}
              onToggle={(v) => setFilters((f) => ({ ...f, status: toggleInArray(f.status, v) }))} />
            <FilterMultiRow label="Payment" options={PAYMENT_STATUSES}
              selected={filters.payment_status}
              onToggle={(v) => setFilters((f) => ({ ...f, payment_status: toggleInArray(f.payment_status, v) }))} />
            <FilterMultiRow label="Flight status" options={FLIGHT_STATUSES}
              selected={filters.flight_status}
              onToggle={(v) => setFilters((f) => ({ ...f, flight_status: toggleInArray(f.flight_status, v) }))} />

            {(drivers ?? []).length > 0 && (
              <div>
                <Label className="text-xs mb-1 block">Drivers</Label>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                  <ChipToggle active={filters.include_unassigned}
                    onClick={() => setFilters((f) => ({ ...f, include_unassigned: !f.include_unassigned }))}>
                    Unassigned
                  </ChipToggle>
                  {(drivers ?? []).map((d: any) => (
                    <ChipToggle key={d.id} active={filters.driver_ids.includes(d.id)}
                      onClick={() => setFilters((f) => ({ ...f, driver_ids: toggleInArray(f.driver_ids, d.id) }))}>
                      {d.name}
                    </ChipToggle>
                  ))}
                </div>
              </div>
            )}

            {(labels ?? []).length > 0 && (
              <div>
                <Label className="text-xs mb-1 block">Labels</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(labels ?? []).map((l: any) => (
                    <ChipToggle key={l.id} active={filters.label_ids.includes(l.id)}
                      onClick={() => setFilters((f) => ({ ...f, label_ids: toggleInArray(f.label_ids, l.id) }))}>
                      <span className="inline-block h-2 w-2 rounded-full mr-1" style={{ backgroundColor: l.color }} />
                      {l.name}
                    </ChipToggle>
                  ))}
                </div>
              </div>
            )}

            {(connections ?? []).length > 0 && (
              <div>
                <Label className="text-xs mb-1 block">Partner companies</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(connections ?? []).map((c: any) => (
                    <ChipToggle key={c.partner_company_id ?? c.id}
                      active={filters.partner_company_ids.includes(c.partner_company_id ?? c.id)}
                      onClick={() => setFilters((f) => ({
                        ...f,
                        partner_company_ids: toggleInArray(f.partner_company_ids, c.partner_company_id ?? c.id),
                      }))}>
                      {c.partner_name ?? c.name ?? "Partner"}
                    </ChipToggle>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 pt-1 flex-wrap">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={filters.deletion_only}
                  onCheckedChange={(v) => setFilters((f) => ({ ...f, deletion_only: !!v }))} />
                Deletion requested only
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={includeChain} onCheckedChange={(v) => setIncludeChain(!!v)} />
                Include chain detail in export
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={includePax} onCheckedChange={(v) => setIncludePax(!!v)} />
                One row per passenger
              </label>
              <Button variant="ghost" size="sm" onClick={() => setFilters({
                from: "", to: "", status: [], payment_status: [], driver_ids: [], include_unassigned: false,
                label_ids: [], company_scope: "own", partner_company_ids: [], flight_contains: "",
                flight_status: [], from_contains: "", to_contains: "", pax_contains: "", search: "", deletion_only: false,
              })}>Reset</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Columns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => saveCols(ALL_COLUMNS.map((c) => c.key as string))}>All</Button>
              <Button size="sm" variant="outline" onClick={() => saveCols(DEFAULT_COLS)}>Defaults</Button>
              <Button size="sm" variant="ghost" onClick={() => saveCols([])}>None</Button>
            </div>
            <div className="max-h-[420px] overflow-auto space-y-3 pr-1">
              {Object.entries(groups).map(([grp, list]) => (
                <div key={grp}>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{grp}</div>
                  <div className="space-y-1">
                    {list.map((c) => (
                      <label key={c.key as string} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedCols.includes(c.key as string)}
                          onCheckedChange={(v) => saveCols(v ? [...selectedCols, c.key as string] : selectedCols.filter((k) => k !== c.key))}
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div>
              <CardTitle className="text-base">{company?.name ?? "Statement"}</CardTitle>
              <div className="text-xs text-muted-foreground mt-0.5">
                Generated {statement ? new Date(statement.generated_at).toLocaleString() : "…"}
                {statement?.truncated && <span className="ml-2 text-amber-600">(truncated — narrow filters)</span>}
              </div>
            </div>
            <div className="flex gap-3 text-sm flex-wrap items-center">
              <span><b>{statement?.total_trips ?? 0}</b> trips</span>
              <span><b>{statement?.total_pax ?? 0}</b> pax</span>
              {statement?.totals && (
                <>
                  <span className="text-muted-foreground">|</span>
                  <span>Billed <b>{statement.totals.billed.toFixed(2)}</b></span>
                  <span className="text-emerald-700">Received <b>{statement.totals.received_client.toFixed(2)}</b></span>
                  <span className="text-amber-700">Outstanding <b>{statement.totals.outstanding_client.toFixed(2)}</b></span>
                </>
              )}
            </div>
          </div>
          {activeFilterChips.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {activeFilterChips.map((c, i) => <Badge key={i} variant="outline" className="text-[10px]">{c}</Badge>)}
            </div>
          )}
          {selectedIds.size > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 p-2 rounded-md border bg-muted/30">
              <span className="text-xs font-medium">{selectedIds.size} selected</span>
              <Select value={bulkSide} onValueChange={(v) => setBulkSide(v as "client" | "driver")}>
                <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client paid us</SelectItem>
                  <SelectItem value="driver">We paid driver</SelectItem>
                </SelectContent>
              </Select>
              <Select value={bulkMethod} onValueChange={setBulkMethod}>
                <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8" disabled={bulkMut.isPending}
                onClick={() => bulkMut.mutate(Array.from(selectedIds))}>
                <Check className="h-3.5 w-3.5 mr-1" /> Mark {selectedIds.size} paid
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelectedIds(new Set())}>
                <X className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            </div>
          )}
        </CardHeader>
        <Separator />
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/50">
              <tr>
                <th className="w-8 px-2 py-2 border-b">
                  <Checkbox
                    checked={(statement?.rows.length ?? 0) > 0 && selectedIds.size === statement?.rows.length}
                    onCheckedChange={(v) => {
                      if (v) setSelectedIds(new Set((statement?.rows ?? []).map((r) => r.id)));
                      else setSelectedIds(new Set());
                    }}
                  />
                </th>
                {cols.map((c) => (
                  <th key={c.key as string} className="text-left px-2 py-2 font-medium whitespace-nowrap border-b">
                    {c.label}
                  </th>
                ))}
                {includeChain && <th className="text-left px-2 py-2 font-medium border-b">Chain detail</th>}
              </tr>
            </thead>
            <tbody>
              {(statement?.rows ?? []).length === 0 ? (
                <tr><td colSpan={cols.length + 1 + (includeChain ? 1 : 0)} className="text-center py-10 text-muted-foreground">
                  {isFetching ? "Loading…" : "No trips match these filters."}
                </td></tr>
              ) : statement!.rows.map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/30 align-top">
                  <td className="px-2 py-1.5">
                    <Checkbox
                      checked={selectedIds.has(r.id)}
                      onCheckedChange={(v) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(r.id); else next.delete(r.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  {cols.map((c) => (
                    <td key={c.key as string} className="px-2 py-1.5 whitespace-nowrap max-w-[280px] truncate" title={c.key === "actions" ? "" : String((r as any)[c.key] ?? "")}>
                      {renderCell(r, c.key as string)}
                    </td>
                  ))}
                  {includeChain && (
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {r.hops.length === 0 ? "—" : r.hops.map((h) => `${h.from}→${h.to} (${h.status})`).join(" | ")}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function MarkPaidPopover({ row, side, onSubmit, onClear }: {
  row: Row; side: "client" | "driver";
  onSubmit: (v: { amount?: number; method?: string; reference?: string }) => void;
  onClear: () => void;
}) {
  const paidAt = side === "client" ? row.paid_at : row.driver_paid_at;
  const paidAmt = side === "client" ? row.paid_amount : row.driver_paid_amount;
  const paidMethod = side === "client" ? row.paid_method : row.driver_paid_method;
  const paidRef = side === "client" ? row.paid_reference : row.driver_paid_reference;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(paidAmt != null ? String(paidAmt) : (row.price_amount != null ? String(row.price_amount) : ""));
  const [method, setMethod] = useState<string>(paidMethod || row.payment_method || "cash");
  const [reference, setReference] = useState<string>(paidRef || "");
  const label = side === "client" ? "Client" : "Driver";
  const done = !!paidAt;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm" variant={done ? "default" : "outline"}
          className={`h-7 px-2 text-[10px] ${done ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
          title={done ? `${label} paid ${paidAmt ?? ""} on ${new Date(paidAt!).toLocaleDateString()}` : `Mark ${label.toLowerCase()} paid`}
        >
          <Wallet className="h-3 w-3 mr-1" /> {label} {done ? "✓" : "?"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2" align="end">
        <div className="text-xs font-medium">{done ? `Edit ${label.toLowerCase()} payment` : `Mark ${label.toLowerCase()} paid`}</div>
        <div className="space-y-1">
          <Label className="text-[10px]">Amount ({row.price_currency || "EUR"})</Label>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">Method</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="bank_transfer">Bank transfer</SelectItem>
              <SelectItem value="card">Card</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">Reference (optional)</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Invoice / receipt #" className="h-8 text-xs" />
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            size="sm" className="h-7 flex-1 text-xs"
            onClick={() => {
              const amt = amount.trim() === "" ? undefined : Number(amount);
              if (amt != null && Number.isNaN(amt)) { toast.error("Invalid amount"); return; }
              onSubmit({ amount: amt, method, reference: reference.trim() || undefined });
              setOpen(false);
            }}
          >
            {done ? "Update" : "Mark paid"}
          </Button>
          {done && (
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => { onClear(); setOpen(false); }}>
              Clear
            </Button>
          )}
        </div>
        {done && paidAt && (
          <div className="text-[10px] text-muted-foreground pt-1">
            Recorded {new Date(paidAt).toLocaleString()}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterMultiRow({ label, options, selected, onToggle }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs mb-1 block">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <ChipToggle key={o} active={selected.includes(o)} onClick={() => onToggle(o)}>{o.replace(/_/g, " ")}</ChipToggle>
        ))}
      </div>
    </div>
  );
}

function ChipToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
      }`}>
      {children}
    </button>
  );
}
