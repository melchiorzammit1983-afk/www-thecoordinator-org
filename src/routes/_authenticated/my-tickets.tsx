import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, Send, ChevronLeft } from "lucide-react";
import { listMyTickets, getTicket, addTicketMessage, createSupportTicket } from "@/lib/support.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/my-tickets")({
  component: MyTickets,
});

function MyTickets() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Support tickets</h1>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>New ticket</Button>
      </div>
      {openId ? (
        <TicketView id={openId} onBack={() => setOpenId(null)} />
      ) : (
        <TicketList onOpen={setOpenId} />
      )}
      {showNew && <NewTicketDialog onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); setOpenId(id); }} />}
    </div>
  );
}

function TicketList({ onOpen }: { onOpen: (id: string) => void }) {
  const listFn = useServerFn(listMyTickets);
  const { data } = useQuery({ queryKey: ["my-tickets"], queryFn: () => listFn() });
  const rows = data ?? [];
  if (rows.length === 0) {
    return <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No tickets yet. Ask the Guide to help, or open a new ticket.</CardContent></Card>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r: any) => (
        <button key={r.id} onClick={() => onOpen(r.id)} className="w-full text-left rounded-lg border bg-card p-3 hover:border-primary/60 transition">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{r.subject}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Updated {new Date(r.updated_at).toLocaleString()}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant={r.status === "resolved" ? "secondary" : "default"}>{r.status}</Badge>
              {r.user_unread && <Badge variant="destructive" className="text-[10px]">New reply</Badge>}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function TicketView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getTicket);
  const addFn = useServerFn(addTicketMessage);
  const { data } = useQuery({ queryKey: ["ticket", id], queryFn: () => getFn({ data: { id } }), refetchInterval: 15_000 });
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: () => addFn({ data: { ticket_id: id, body: text } }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["ticket", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Button variant="ghost" size="icon" onClick={onBack}><ChevronLeft className="h-4 w-4" /></Button>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-base truncate">{data.ticket.subject}</CardTitle>
          <div className="text-xs text-muted-foreground">Priority {data.ticket.priority} · {data.ticket.status}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          {data.messages.map((m: any) => (
            <div key={m.id} className={`rounded-lg p-3 text-sm ${m.author === "admin" ? "bg-primary/10 border border-primary/20" : "bg-muted"}`}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                {m.author} · {new Date(m.created_at).toLocaleString()}
              </div>
              <div className="whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
        </div>
        {data.ticket.status === "open" && (
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply…" onKeyDown={(e) => { if (e.key === "Enter") send.mutate(); }} />
            <Button size="icon" onClick={() => send.mutate()} disabled={!text.trim() || send.isPending}><Send className="h-4 w-4" /></Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NewTicketDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const createFn = useServerFn(createSupportTicket);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const m = useMutation({
    mutationFn: () => createFn({ data: { subject, body, route: typeof window !== "undefined" ? window.location.pathname : undefined } }),
    onSuccess: (r) => onCreated(r.id),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-background border p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="font-semibold">New support ticket</div>
        <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea placeholder="Describe the issue…" value={body} onChange={(e) => setBody(e.target.value)} rows={6}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!subject.trim() || !body.trim() || m.isPending}>Submit</Button>
        </div>
      </div>
    </div>
  );
}
