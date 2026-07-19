import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Activity, Search, Sparkles, LifeBuoy, Coins, Terminal, Download } from "lucide-react";
import { adminAiActivity } from "@/lib/support.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminAiHeaderTabs } from "@/components/admin/AdminAiHeaderTabs";

export const Route = createFileRoute("/_authenticated/admin/ai-activity")({
  component: AiActivityPage,
});

type Kind = "all" | "guide" | "escalation" | "charge" | "command";

const KIND_META: Record<Kind, { label: string; icon: any; tone: string }> = {
  all: { label: "All", icon: Activity, tone: "text-foreground" },
  guide: { label: "Guide Q&A", icon: Sparkles, tone: "text-primary" },
  escalation: { label: "Escalations", icon: LifeBuoy, tone: "text-amber-600" },
  charge: { label: "Points charged", icon: Coins, tone: "text-emerald-600" },
  command: { label: "AI commands", icon: Terminal, tone: "text-purple-600" },
};

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function AiActivityPage() {
  const fn = useServerFn(adminAiActivity);
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(30);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["admin-ai-activity", kind, days],
    queryFn: () => fn({ data: { kind, from: daysAgoIso(days), limit: 500 } }),
  });

  const events = data?.events ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e: any) =>
      [e.title, e.body, e.user_email, e.company_name, e.feature_key].join(" ").toLowerCase().includes(q)
    );
  }, [events, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: events.length, guide: 0, escalation: 0, charge: 0, command: 0 };
    for (const e of events) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [events]);

  const totalPoints = useMemo(
    () => events.filter((e: any) => e.kind === "charge").reduce((s: number, e: any) => s + (e.points ?? 0), 0),
    [events]
  );

  const exportCsv = () => {
    const rows = [
      ["timestamp", "kind", "user_email", "company", "title", "body", "route", "points", "feature_key", "confidence", "thumbs", "ticket_status", "ticket_priority", "affected_count", "error", "escalated_ticket_id"],
      ...filtered.map((e: any) => [
        e.created_at, e.kind, e.user_email ?? "", e.company_name ?? "", e.title,
        (e.body ?? "").replace(/\s+/g, " ").slice(0, 500),
        e.route ?? "", e.points ?? "", e.feature_key ?? "",
        e.confidence ?? "", e.thumbs ?? "", e.ticket_status ?? "", e.ticket_priority ?? "",
        e.affected_count ?? "", e.error ?? "", e.escalated_ticket_id ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">AI activity</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>Last 24h</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(Object.keys(KIND_META) as Kind[]).map((k) => {
          const M = KIND_META[k];
          const Icon = M.icon;
          const active = kind === k;
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg border p-3 text-left transition ${active ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className={`h-4 w-4 ${M.tone}`} /> {M.label}
              </div>
              <div className="text-2xl font-bold tabular-nums mt-1">{counts[k] ?? 0}</div>
              {k === "charge" && (
                <div className="text-[10px] text-muted-foreground">
                  {totalPoints.toFixed(2)} pts total
                </div>
              )}
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">
            Events {isFetching && <span className="text-xs text-muted-foreground ml-2">loading…</span>}
          </CardTitle>
          <div className="relative w-72">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-8 pl-7 text-sm"
              placeholder="Search user, company, text…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">Kind</th>
                  <th className="text-left px-3 py-2 font-medium">User</th>
                  <th className="text-left px-3 py-2 font-medium">Company</th>
                  <th className="text-left px-3 py-2 font-medium">Detail</th>
                  <th className="text-right px-3 py-2 font-medium">Points</th>
                  <th className="text-left px-3 py-2 font-medium">Meta</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-muted-foreground">
                      No activity in this window.
                    </td>
                  </tr>
                )}
                {filtered.map((e: any) => {
                  const M = KIND_META[e.kind as Kind];
                  const Icon = M.icon;
                  const isOpen = expanded === e.id;
                  return (
                    <>
                      <tr
                        key={e.id}
                        className="border-t hover:bg-muted/30 cursor-pointer align-top"
                        onClick={() => setExpanded(isOpen ? null : e.id)}
                      >
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 text-xs ${M.tone}`}>
                            <Icon className="h-3.5 w-3.5" /> {M.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">{e.user_email ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2 text-xs">{e.company_name ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2 max-w-md">
                          <div className="font-medium truncate">{e.title}</div>
                          {e.body && <div className="text-xs text-muted-foreground line-clamp-1">{e.body}</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs">
                          {e.points != null ? e.points.toFixed(2) : ""}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {e.feature_key && <Badge variant="outline" className="text-[10px]">{e.feature_key}</Badge>}
                            {e.confidence != null && (
                              <Badge variant={e.confidence < 0.6 ? "destructive" : "secondary"} className="text-[10px]">
                                {Math.round(e.confidence * 100)}%
                              </Badge>
                            )}
                            {e.thumbs === -1 && <Badge variant="destructive" className="text-[10px]">👎</Badge>}
                            {e.thumbs === 1 && <Badge variant="secondary" className="text-[10px]">👍</Badge>}
                            {e.ticket_status && <Badge variant="outline" className="text-[10px]">{e.ticket_status}</Badge>}
                            {e.ticket_priority && <Badge variant="outline" className="text-[10px]">{e.ticket_priority}</Badge>}
                            {e.mode && <Badge variant="outline" className="text-[10px]">{e.mode}</Badge>}
                            {e.status && e.status !== "ok" && <Badge variant="destructive" className="text-[10px]">{e.status}</Badge>}
                            {typeof e.affected_count === "number" && e.affected_count > 0 && (
                              <Badge variant="secondary" className="text-[10px]">×{e.affected_count}</Badge>
                            )}
                            {e.escalated_ticket_id && e.kind === "guide" && (
                              <Badge variant="outline" className="text-[10px]">escalated</Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/20 border-t">
                          <td colSpan={7} className="px-6 py-4">
                            <EventDetail e={e} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EventDetail({ e }: { e: any }) {
  return (
    <div className="space-y-3 text-sm">
      {e.route && <div className="text-xs text-muted-foreground">Route: <span className="font-mono">{e.route}</span></div>}
      {e.body && (
        <div>
          <div className="text-xs uppercase text-muted-foreground mb-1">Content</div>
          <div className="whitespace-pre-wrap bg-background border rounded p-2 max-h-64 overflow-y-auto">{e.body}</div>
        </div>
      )}
      {e.error && (
        <div>
          <div className="text-xs uppercase text-destructive mb-1">Error</div>
          <div className="whitespace-pre-wrap bg-destructive/10 border border-destructive/30 rounded p-2 text-xs">{e.error}</div>
        </div>
      )}
      {(e.actions || e.executed_actions) && (
        <div className="grid md:grid-cols-2 gap-3">
          {e.actions && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Proposed actions</div>
              <pre className="text-[11px] bg-background border rounded p-2 max-h-48 overflow-auto">{JSON.stringify(e.actions, null, 2)}</pre>
            </div>
          )}
          {e.executed_actions && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Executed actions</div>
              <pre className="text-[11px] bg-background border rounded p-2 max-h-48 overflow-auto">{JSON.stringify(e.executed_actions, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
      {e.sources_used && (
        <div>
          <div className="text-xs uppercase text-muted-foreground mb-1">Sources used</div>
          <pre className="text-[11px] bg-background border rounded p-2 max-h-32 overflow-auto">{JSON.stringify(e.sources_used, null, 2)}</pre>
        </div>
      )}
      {e.ai_thread && (
        <details>
          <summary className="text-xs uppercase text-muted-foreground cursor-pointer">Guide thread before escalation</summary>
          <pre className="text-[11px] mt-2 bg-background border rounded p-2 max-h-64 overflow-auto">{JSON.stringify(e.ai_thread, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
