import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listDispatchRules,
  upsertDispatchRule,
  deleteDispatchRule,
  evaluateDispatchRules,
  applyDispatchRuleProposal,
  type DispatchRule,
} from "@/lib/dispatch-rules.functions";
import { getBoardingBuffer, setBoardingBuffer } from "@/lib/scheduling.functions";
import { listDrivers } from "@/lib/coordinator.functions";
import { listConnections } from "@/lib/collab.functions";

export const Route = createFileRoute("/_authenticated/coordinator/dispatch-rules")({
  component: DispatchRulesPage,
});

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function DispatchRulesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDispatchRules);
  const delFn = useServerFn(deleteDispatchRule);
  const evalFn = useServerFn(evaluateDispatchRules);
  const applyFn = useServerFn(applyDispatchRuleProposal);
  const [editing, setEditing] = useState<Partial<DispatchRule> | null>(null);
  const [doneIdx, setDoneIdx] = useState<Set<number>>(new Set());

  const rulesQ = useQuery({
    queryKey: ["dispatch-rules"],
    queryFn: () => listFn() as Promise<DispatchRule[]>,
  });

  const evalQ = useQuery({
    queryKey: ["dispatch-rules-eval"],
    queryFn: () => evalFn() as Promise<{ proposals: Array<{
      job_id: string; pickup_at: string; from_location: string | null; to_location: string | null;
      rule_id: string; rule_label: string; target_type: "driver"|"partner"; target_id: string; target_name: string;
    }> }>,
    refetchOnWindowFocus: false,
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Rule deleted"); qc.invalidateQueries({ queryKey: ["dispatch-rules"] }); qc.invalidateQueries({ queryKey: ["dispatch-rules-eval"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: (p: { idx: number; job_id: string; target_type: "driver"|"partner"; target_id: string }) =>
      applyFn({ data: { job_id: p.job_id, target_type: p.target_type, target_id: p.target_id } }) as Promise<{ ok: boolean }>,
    onSuccess: (_r, v) => {
      setDoneIdx((prev) => new Set(prev).add(v.idx));
      toast.success("Assigned");
      qc.invalidateQueries({ queryKey: ["calendar-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dispatch Rules</h1>
        <p className="text-sm text-muted-foreground">
          Default routing for recurring shifts (e.g. "Weekdays 12:30–17:00 → Driver A").
          Rules never auto-assign silently — matches surface here for your confirmation.
        </p>
      </div>

      <BoardingBufferCard />



      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Your rules</CardTitle>
            <CardDescription>{rulesQ.data?.length ?? 0} configured</CardDescription>
          </div>
          <Button size="sm" onClick={() => setEditing({ days_of_week: [1,2,3,4,5], enabled: true, target_type: "driver", start_time: "08:00", end_time: "17:00", label: "" })}>
            <Plus className="h-4 w-4 mr-1" /> New rule
          </Button>
        </CardHeader>
        <CardContent>
          {rulesQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {rulesQ.data && rulesQ.data.length === 0 && (
            <div className="text-sm text-muted-foreground py-4 text-center">No rules yet.</div>
          )}
          <div className="divide-y">
            {(rulesQ.data ?? []).map((r) => (
              <div key={r.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{r.label}</span>
                    <Badge variant={r.enabled ? "default" : "outline"} className="text-[10px]">
                      {r.enabled ? "active" : "off"}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">{r.target_type}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.days_of_week.map((d) => DOW[d]).join(", ")} · {r.start_time.slice(0,5)}–{r.end_time.slice(0,5)} → {r.target_name ?? "(unknown)"}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)} disabled={del.isPending}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Suggested assignments</CardTitle>
              <CardDescription>Upcoming unassigned trips that match your rules (next 14 days).</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => { setDoneIdx(new Set()); qc.invalidateQueries({ queryKey: ["dispatch-rules-eval"] }); }}>
              Re-scan
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {evalQ.isLoading && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Scanning…</div>}
          {evalQ.data && evalQ.data.proposals.length === 0 && (
            <div className="text-sm text-muted-foreground py-4 text-center">Nothing matches your rules right now.</div>
          )}
          <div className="space-y-2">
            {(evalQ.data?.proposals ?? []).map((p, i) => (
              <div key={i} className={`rounded-md border p-3 flex items-center gap-3 ${doneIdx.has(i) ? "opacity-50" : ""}`}>
                <div className="flex-1 min-w-0 text-xs">
                  <div className="font-medium text-sm">
                    {new Date(p.pickup_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {p.from_location ?? "?"} <ArrowRight className="inline h-3 w-3" /> {p.to_location ?? "?"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Rule: <span className="font-medium">{p.rule_label}</span> → {p.target_type} <span className="font-medium">{p.target_name}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={doneIdx.has(i) || apply.isPending}
                  onClick={() => apply.mutate({ idx: i, job_id: p.job_id, target_type: p.target_type, target_id: p.target_id })}
                >
                  {doneIdx.has(i) ? "Assigned" : "Accept"}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {editing && <RuleEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["dispatch-rules"] }); qc.invalidateQueries({ queryKey: ["dispatch-rules-eval"] }); }} />}
    </div>
  );
}

function RuleEditor({ initial, onClose, onSaved }: { initial: Partial<DispatchRule>; onClose: () => void; onSaved: () => void }) {
  const upsertFn = useServerFn(upsertDispatchRule);
  const driversFn = useServerFn(listDrivers);
  const connsFn = useServerFn(listConnections);

  const [label, setLabel] = useState(initial.label ?? "");
  const [days, setDays] = useState<number[]>(initial.days_of_week ?? [1,2,3,4,5]);
  const [start, setStart] = useState((initial.start_time ?? "08:00").slice(0,5));
  const [end, setEnd] = useState((initial.end_time ?? "17:00").slice(0,5));
  const [targetType, setTargetType] = useState<"driver"|"partner">(initial.target_type ?? "driver");
  const [targetId, setTargetId] = useState<string>(initial.target_id ?? "");
  const [enabled, setEnabled] = useState<boolean>(initial.enabled ?? true);

  const drivers = useQuery({ queryKey: ["drivers"], queryFn: () => driversFn() as Promise<Array<{ id: string; name: string }>> });
  const conns = useQuery({ queryKey: ["connections"], queryFn: () => connsFn() as Promise<Array<{ status: string; other: { id: string; name: string } }>> });
  const partners = (conns.data ?? []).filter((c) => c.status === "active").map((c) => c.other);

  const save = useMutation({
    mutationFn: () => upsertFn({ data: { id: initial.id, label: label.trim(), days_of_week: days, start_time: start, end_time: end, target_type: targetType, target_id: targetId, enabled } }),
    onSuccess: () => { toast.success("Saved"); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleDow = (d: number) => setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());

  const canSave = label.trim() && days.length && start && end && targetId;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial.id ? "Edit rule" : "New rule"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Weekday afternoons → Alex" />
          </div>
          <div>
            <Label className="text-xs">Days</Label>
            <div className="flex gap-1 mt-1 flex-wrap">
              {DOW.map((d, i) => (
                <button key={i} type="button" onClick={() => toggleDow(i)}
                  className={`px-2.5 py-1 rounded-full border text-xs ${days.includes(i) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Start</Label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><Label className="text-xs">End</Label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <div>
            <Label className="text-xs">Route to</Label>
            <div className="flex gap-2 mt-1">
              <Select value={targetType} onValueChange={(v: "driver"|"partner") => { setTargetType(v); setTargetId(""); }}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="driver">Driver</SelectItem>
                  <SelectItem value="partner">Partner</SelectItem>
                </SelectContent>
              </Select>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="flex-1"><SelectValue placeholder={targetType === "driver" ? "Pick a driver…" : "Pick a partner…"} /></SelectTrigger>
                <SelectContent>
                  {(targetType === "driver" ? (drivers.data ?? []) : partners).map((x) => (
                    <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <Label className="text-xs">Enabled</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {save.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BoardingBufferCard() {
  const qc = useQueryClient();
  const getFn = useServerFn(getBoardingBuffer);
  const setFn = useServerFn(setBoardingBuffer);
  const q = useQuery({
    queryKey: ["boarding-buffer"],
    queryFn: () => getFn() as Promise<{ boarding_buffer_min: number }>,
  });
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? q.data?.boarding_buffer_min ?? 10;
  const save = useMutation({
    mutationFn: () => setFn({ data: { boarding_buffer_min: value } }),
    onSuccess: () => {
      toast.success("Boarding buffer updated");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["boarding-buffer"] });
      qc.invalidateQueries({ queryKey: ["driver-conflicts"] });
      qc.invalidateQueries({ queryKey: ["assignment-preview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Boarding buffer</CardTitle>
        <CardDescription>
          Minutes reserved after a drop-off for the passengers to disembark before the
          driver can start their next pickup. Used by conflict warnings on trip cards,
          the driver picker and automatic grouping suggestions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label>Minutes</Label>
            <Input
              type="number"
              min={0}
              max={120}
              value={value}
              onChange={(e) => setDraft(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
              className="w-28"
            />
          </div>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending || draft === null || draft === q.data?.boarding_buffer_min}
          >
            {save.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save
          </Button>
          <div className="text-xs text-muted-foreground pb-2">
            Default 10 min. Raise it for VIP handovers or luggage-heavy runs.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
