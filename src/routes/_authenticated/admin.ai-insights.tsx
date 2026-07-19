import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Sparkles, ThumbsDown, Ticket, MessageSquare, Search, ChevronRight } from "lucide-react";
import { adminHelpInsights, adminListTickets, adminSetTicketStatus, getTicket, addTicketMessage } from "@/lib/support.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AdminAiHeaderTabs } from "@/components/admin/AdminAiHeaderTabs";

export const Route = createFileRoute("/_authenticated/admin/ai-insights")({
  component: AiInsights,
});

function AiInsights() {
  const insFn = useServerFn(adminHelpInsights);
  const { data } = useQuery({ queryKey: ["ai-insights"], queryFn: () => insFn() });
  const [q, setQ] = useState("");
  const [openTicket, setOpenTicket] = useState<string | null>(null);

  const recent = data?.recent ?? [];
  const filtered = useMemo(() =>
    recent.filter((r: any) => !q || (r.question ?? "").toLowerCase().includes(q.toLowerCase())),
    [recent, q]);
  const lowConf = recent.filter((r: any) => (r.confidence ?? 1) < 0.6);
  const escalated = recent.filter((r: any) => r.escalated_ticket_id);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-semibold">AI insights</h1>
      </div>
      <AdminAiHeaderTabs active="insights" />


      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Questions (30d)" value={recent.length} icon={<MessageSquare className="h-4 w-4" />} />
        <Stat label="Low confidence" value={lowConf.length} icon={<Sparkles className="h-4 w-4" />} tone="warn" />
        <Stat label="Thumbs-down" value={data?.thumbsDownCount ?? 0} icon={<ThumbsDown className="h-4 w-4" />} tone="warn" />
        <Stat label="Open tickets" value={data?.openTicketsCount ?? 0} icon={<Ticket className="h-4 w-4" />} tone="danger" />
      </div>

      <TicketsSection onOpen={setOpenTicket} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent Guide questions</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="h-8 pl-7 text-sm" placeholder="Search questions…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">No questions yet.</div>}
          {filtered.map((r: any) => (
            <div key={r.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{r.question}</div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.answer}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                  {r.confidence != null && (
                    <Badge variant={r.confidence < 0.6 ? "destructive" : "secondary"} className="text-[10px]">
                      {Math.round(r.confidence * 100)}%
                    </Badge>
                  )}
                  {r.thumbs === -1 && <Badge variant="destructive" className="text-[10px]">👎</Badge>}
                  {r.escalated_ticket_id && (
                    <button className="text-[10px] text-primary underline" onClick={() => setOpenTicket(r.escalated_ticket_id)}>
                      Escalated →
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {openTicket && <AdminTicketDialog id={openTicket} onClose={() => setOpenTicket(null)} />}
      {escalated.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {escalated.length} of these were escalated to a <Link to="/admin/ai-insights" className="text-primary underline">support ticket</Link>.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon, tone = "default" }: { label: string; value: number; icon: React.ReactNode; tone?: "default" | "warn" | "danger" }) {
  const color = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="grid place-items-center h-9 w-9 rounded-md bg-muted">{icon}</div>
        <div>
          <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function TicketsSection({ onOpen }: { onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const listFn = useServerFn(adminListTickets);
  const { data } = useQuery({ queryKey: ["admin-tickets", tab], queryFn: () => listFn({ data: { status: tab } }) });
  const rows = data ?? [];
  return (
    <Card>
      <CardHeader className="space-y-0 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Support tickets</CardTitle>
          <div className="flex gap-1 text-xs">
            {(["open", "resolved"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded-md px-2 py-1 ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 max-h-80 overflow-y-auto">
        {rows.length === 0 && <div className="text-sm text-muted-foreground text-center py-4">No {tab} tickets.</div>}
        {rows.map((r: any) => (
          <button key={r.id} onClick={() => onOpen(r.id)} className="w-full text-left rounded-md border p-2 hover:border-primary/60 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{r.subject}</div>
              <div className="text-[10px] text-muted-foreground">Updated {new Date(r.updated_at).toLocaleString()}</div>
            </div>
            <div className="flex items-center gap-1">
              {r.admin_unread && <Badge variant="destructive" className="text-[10px]">New</Badge>}
              <Badge variant="outline" className="text-[10px]">{r.priority}</Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function AdminTicketDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getTicket);
  const addFn = useServerFn(addTicketMessage);
  const setStatusFn = useServerFn(adminSetTicketStatus);
  const { data } = useQuery({ queryKey: ["ticket", id], queryFn: () => getFn({ data: { id } }), refetchInterval: 15_000 });
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: () => addFn({ data: { ticket_id: id, body: text } }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["ticket", id] }); qc.invalidateQueries({ queryKey: ["admin-tickets"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const resolve = useMutation({
    mutationFn: () => setStatusFn({ data: { id, status: "resolved" } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ticket", id] }); qc.invalidateQueries({ queryKey: ["admin-tickets"] }); toast.success("Resolved"); onClose(); },
  });
  const setPrio = useMutation({
    mutationFn: (priority: "low" | "medium" | "high" | "urgent") => setStatusFn({ data: { id, priority } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket", id] }),
  });
  if (!data) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-lg bg-background border p-4 space-y-3 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold truncate">{data.ticket.subject}</div>
            <div className="text-xs text-muted-foreground">Route: {data.ticket.route ?? "—"} · Viewport: {data.ticket.viewport ?? "—"}</div>
          </div>
          <div className="flex gap-1">
            {(["low", "medium", "high", "urgent"] as const).map((p) => (
              <button key={p} onClick={() => setPrio.mutate(p)}
                className={`text-[10px] rounded px-2 py-1 ${data.ticket.priority === p ? "bg-primary text-primary-foreground" : "border"}`}>{p}</button>
            ))}
          </div>
        </div>
        {data.ticket.ai_thread && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Guide conversation before escalation</summary>
            <pre className="mt-2 whitespace-pre-wrap bg-muted p-2 rounded max-h-40 overflow-y-auto">{JSON.stringify(data.ticket.ai_thread, null, 2)}</pre>
          </details>
        )}
        <div className="flex-1 space-y-2 overflow-y-auto">
          {data.messages.map((m: any) => (
            <div key={m.id} className={`rounded-lg p-2 text-sm ${m.author === "admin" ? "bg-primary/10 border border-primary/20" : "bg-muted"}`}>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">{m.author} · {new Date(m.created_at).toLocaleString()}</div>
              <div className="whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply to user…"
            onKeyDown={(e) => { if (e.key === "Enter") send.mutate(); }} />
          <Button onClick={() => send.mutate()} disabled={!text.trim() || send.isPending}>Send</Button>
          <Button variant="outline" onClick={() => resolve.mutate()} disabled={resolve.isPending}>Resolve</Button>
        </div>
      </div>
    </div>
  );
}
