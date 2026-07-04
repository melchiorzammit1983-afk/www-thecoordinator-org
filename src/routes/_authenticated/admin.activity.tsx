import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";

import { listActivityLog, listActivityFacets } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/activity")({
  component: AdminActivityPage,
});

type Row = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_label: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  table_name: string;
  row_id: string | null;
  company_id: string | null;
  changed_keys: string[] | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
};

const PAGE_SIZE = 100;

function AdminActivityPage() {
  const listFn = useServerFn(listActivityLog);
  const facetsFn = useServerFn(listActivityFacets);
  const [filters, setFilters] = useState({
    actor_user_id: "",
    table_name: "",
    action: "",
    company_id: "",
    search: "",
    since: "",
    until: "",
  });
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: facets } = useQuery({
    queryKey: ["activity-facets"],
    queryFn: () => facetsFn(),
  });

  const payload = useMemo(() => ({
    actor_user_id: filters.actor_user_id || null,
    table_name: filters.table_name || null,
    action: (filters.action as "INSERT" | "UPDATE" | "DELETE" | "") || null,
    company_id: filters.company_id || null,
    search: filters.search || null,
    since: filters.since ? new Date(filters.since).toISOString() : null,
    until: filters.until ? new Date(filters.until).toISOString() : null,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [filters, page]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["activity-log", payload],
    queryFn: () => listFn({ data: payload as any }) as Promise<{ rows: Row[]; total: number }>,
  });

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function reset() {
    setFilters({ actor_user_id: "", table_name: "", action: "", company_id: "", search: "", since: "", until: "" });
    setPage(0);
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Activity log</h1>
          <p className="text-xs text-muted-foreground">Every mutation across the platform. Admins only.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>Reset filters</Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-7 bg-background border rounded-md p-3">
        <div className="lg:col-span-2 relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-9 text-sm"
            placeholder="Search email or row id…"
            value={filters.search}
            onChange={(e) => { setFilters((f) => ({ ...f, search: e.target.value })); setPage(0); }}
          />
        </div>
        <Select value={filters.actor_user_id || "__all"} onValueChange={(v) => { setFilters((f) => ({ ...f, actor_user_id: v === "__all" ? "" : v })); setPage(0); }}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Actor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All actors</SelectItem>
            {(facets?.actors ?? []).map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>
                {a.email ?? a.user_id.slice(0, 8)} <span className="opacity-60">({a.label})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.table_name || "__all"} onValueChange={(v) => { setFilters((f) => ({ ...f, table_name: v === "__all" ? "" : v })); setPage(0); }}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Table" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All tables</SelectItem>
            {(facets?.tables ?? []).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.action || "__all"} onValueChange={(v) => { setFilters((f) => ({ ...f, action: v === "__all" ? "" : v })); setPage(0); }}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All actions</SelectItem>
            <SelectItem value="INSERT">INSERT</SelectItem>
            <SelectItem value="UPDATE">UPDATE</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.company_id || "__all"} onValueChange={(v) => { setFilters((f) => ({ ...f, company_id: v === "__all" ? "" : v })); setPage(0); }}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Company" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All companies</SelectItem>
            {(facets?.companies ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="datetime-local" className="h-9 text-sm" value={filters.since}
          onChange={(e) => { setFilters((f) => ({ ...f, since: e.target.value })); setPage(0); }} />
      </div>

      <div className="bg-background border rounded-md overflow-hidden">
        <div className="grid grid-cols-[24px_150px_1fr_100px_180px_1fr] px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b">
          <div></div>
          <div>When</div>
          <div>Actor</div>
          <div>Action</div>
          <div>Table</div>
          <div>Row / changes</div>
        </div>
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No entries match these filters.</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => toggle(r.id)}
                className="w-full grid grid-cols-[24px_150px_1fr_100px_180px_1fr] px-3 py-2 text-sm text-left hover:bg-muted/40"
              >
                <div className="flex items-center">{expanded.has(r.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</div>
                <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                <div className="truncate">
                  <span className="font-medium">{r.actor_email ?? "—"}</span>{" "}
                  <span className="text-[10px] uppercase text-muted-foreground">{r.actor_label ?? "?"}</span>
                </div>
                <div>
                  <Badge variant={r.action === "DELETE" ? "destructive" : r.action === "INSERT" ? "default" : "secondary"} className="text-[10px]">
                    {r.action}
                  </Badge>
                </div>
                <div className="text-xs font-mono truncate">{r.table_name}</div>
                <div className="text-xs truncate">
                  <span className="text-muted-foreground">{r.row_id?.slice(0, 8) ?? "—"}</span>
                  {r.changed_keys && r.changed_keys.length > 0 && (
                    <span className="ml-2 text-muted-foreground">Δ {r.changed_keys.slice(0, 4).join(", ")}{r.changed_keys.length > 4 ? "…" : ""}</span>
                  )}
                </div>
              </button>
              {expanded.has(r.id) && (
                <div className="px-6 pb-4 bg-muted/30 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">Before</div>
                    <pre className="text-[11px] bg-background border rounded p-2 overflow-x-auto max-h-72">{JSON.stringify(r.before_data, null, 2) || "—"}</pre>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">After</div>
                    <pre className="text-[11px] bg-background border rounded p-2 overflow-x-auto max-h-72">{JSON.stringify(r.after_data, null, 2) || "—"}</pre>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>{total.toLocaleString()} events</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
          <span>Page {page + 1} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
