import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { LifeBuoy, ChevronRight } from "lucide-react";
import { adminListTickets, adminSetTicketStatus, getTicket, addTicketMessage } from "@/lib/support.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/ai-insights")({
  component: SupportPage,
});

function SupportPage() {
  const [openTicket, setOpenTicket] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Support</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Review customer support requests and reply to users.
        </p>
      </div>

      <TicketsSection onOpen={setOpenTicket} />

      {openTicket && <AdminTicketDialog id={openTicket} onClose={() => setOpenTicket(null)} />}
    </div>
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
