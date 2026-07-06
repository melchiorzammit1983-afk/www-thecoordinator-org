import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Send, Plus, Trash2, Pencil, Loader2, Bot } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAiConfig, saveAiConfig,
  listAiRules, upsertAiRule, deleteAiRule,
  runAiCommand, listAiCommandHistory, applyAiCommandActions,
} from "@/lib/coordinator.functions";

export const Route = createFileRoute("/_authenticated/coordinator/ai-center")({
  component: AiCenterPage,
});

type AiConfig = {
  auto_assign_enabled: boolean;
  auto_extract_bulk: boolean;
  auto_reply_drafts: boolean;
  ai_command_enabled: boolean;
  voice_to_trip_enabled: boolean;
  auto_coordinate_enabled: boolean;
};

type AiRule = {
  id: string;
  title: string;
  rule_text: string;
  enabled: boolean;
  sort_order: number;
};

function AiCenterPage() {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">AI Control & Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage, talk to, and train the AI that runs behind the scenes.
          </p>
        </div>
      </div>

      <Tabs defaultValue="toggles">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="toggles">Toggles</TabsTrigger>
          <TabsTrigger value="command">Command Bar</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="toggles" className="mt-4"><TogglesSection /></TabsContent>
        <TabsContent value="command" className="mt-4"><CommandSection /></TabsContent>
        <TabsContent value="rules" className="mt-4"><RulesSection /></TabsContent>
      </Tabs>
    </div>
  );
}

// -------- 1. Toggles --------
function TogglesSection() {
  const qc = useQueryClient();
  const getCfg = useServerFn(getAiConfig);
  const saveCfg = useServerFn(saveAiConfig);
  const { data, isLoading } = useQuery({ queryKey: ["ai-config"], queryFn: () => getCfg() as Promise<AiConfig> });
  const [local, setLocal] = useState<AiConfig | null>(null);
  const cfg = local ?? data ?? null;

  const mut = useMutation({
    mutationFn: (v: AiConfig) => saveCfg({ data: v }) as Promise<{ ok: boolean }>,
    onSuccess: () => { toast.success("AI settings saved"); qc.invalidateQueries({ queryKey: ["ai-config"] }); setLocal(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !cfg) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const rows: { key: keyof AiConfig; label: string; desc: string }[] = [
    { key: "auto_coordinate_enabled", label: "AI Auto-Coordinate", desc: "AI reviews the whole unassigned backlog and proposes groupings + driver assignments. Nothing runs without your approval." },
    { key: "auto_assign_enabled", label: "Auto-assign drivers", desc: "New trips are matched to a free driver instantly." },
    { key: "auto_extract_bulk", label: "Bulk-paste AI extraction", desc: "Turn pasted text into structured trips automatically." },
    { key: "voice_to_trip_enabled", label: "Voice → trip", desc: "Record or upload a voice note to create trips." },
    { key: "auto_reply_drafts", label: "AI reply drafts in chat", desc: "Suggest polite replies when clients message you." },
    { key: "ai_command_enabled", label: "AI Command Bar", desc: "Ask the AI to answer questions and act on trips." },
  ];

  const update = (k: keyof AiConfig, v: boolean) => setLocal((prev) => ({ ...(prev ?? cfg), [k]: v }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Automation feature toggles</CardTitle>
        <CardDescription>Turn each AI workflow on or off for your company.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((r) => (
          <div key={r.key} className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
            <div className="min-w-0">
              <div className="font-medium text-sm">{r.label}</div>
              <div className="text-xs text-muted-foreground">{r.desc}</div>
            </div>
            <Switch checked={cfg[r.key]} onCheckedChange={(v) => update(r.key, !!v)} />
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <Button disabled={!local || mut.isPending} onClick={() => local && mut.mutate(local)}>
            {mut.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// -------- 2. Command Bar --------
type HistoryRow = {
  id: string; mode: string; prompt: string; response: string;
  actions: any[]; status: string; created_at: string;
  applied_at: string | null; executed_actions: Array<{ index: number; ok: boolean; message: string }> | null;
  affected_count: number; requires_confirmation: boolean;
};

function describeAction(a: any): string {
  if (!a || typeof a !== "object") return "invalid";
  const short = (s?: string) => (s ? String(s).slice(0, 8) : "");
  switch (a.type) {
    case "assign": return `Assign driver ${short(a.driver_id)} → trip ${short(a.job_id)}`;
    case "unassign": return `Unassign driver from trip ${short(a.job_id)}`;
    case "reschedule": return `Reschedule ${short(a.job_id)} → ${a.date ?? ""} ${a.time ?? ""}`.trim();
    case "status": return `Set status of ${short(a.job_id)} → ${a.new_status}`;
    case "group": return `Group ${Array.isArray(a.job_ids) ? a.job_ids.length : 0} trips${a.group_name ? ` as "${a.group_name}"` : ""}`;
    case "ungroup": return `Ungroup trip ${short(a.job_id)}`;
    case "message": return `Message (${a.thread}) on ${short(a.job_id)}: ${String(a.body ?? "").slice(0, 80)}`;
    case "dispatch": return `Dispatch ${short(a.job_id)} → partner ${short(a.partner_company_id)}`;
    case "note": return `Note on ${short(a.job_id)}: ${String(a.note ?? "").slice(0, 80)}`;
    default: return String(a.type);
  }
}

function HistoryEntry({ h }: { h: HistoryRow }) {
  const qc = useQueryClient();
  const applyFn = useServerFn(applyAiCommandActions);
  const initial = new Set((h.actions ?? []).map((_, i) => i));
  const [selected, setSelected] = useState<Set<number>>(initial);

  const apply = useMutation({
    mutationFn: () => applyFn({ data: { command_log_id: h.id, action_indices: Array.from(selected).sort((a, b) => a - b) } }) as Promise<{
      ok: boolean; affected: number; results: Array<{ index: number; ok: boolean; message: string }>;
    }>,
    onSuccess: (res) => {
      toast.success(`Applied ${res.affected} action(s)`);
      qc.invalidateQueries({ queryKey: ["ai-cmd-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (i: number) => {
    const next = new Set(selected);
    next.has(i) ? next.delete(i) : next.add(i);
    setSelected(next);
  };

  const applied = !!h.applied_at;
  const acts = h.actions ?? [];

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="capitalize">{h.mode}</Badge>
        <Badge variant={applied ? "secondary" : h.status === "awaiting_confirm" ? "default" : h.status === "ok" ? "secondary" : "destructive"} className="capitalize">
          {applied ? "applied" : h.status.replace("_", " ")}
        </Badge>
        <span>{new Date(h.created_at).toLocaleString()}</span>
      </div>
      <div className="font-medium">{h.prompt}</div>
      {h.response && <div className="text-foreground/80 whitespace-pre-wrap">{h.response}</div>}
      {acts.length > 0 && (
        <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
          <div className="text-xs font-medium">Proposed actions ({acts.length}) — needs your approval</div>
          {acts.map((a, i) => {
            const result = h.executed_actions?.find((r) => r.index === i);
            return (
              <label key={i} className="flex items-start gap-2 text-xs">
                {!applied && (
                  <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="mt-0.5" />
                )}
                <span className="flex-1">{describeAction(a)}</span>
                {result && (
                  <span className={result.ok ? "text-emerald-600" : "text-destructive"}>
                    {result.ok ? "✓" : "✗"} {result.message}
                  </span>
                )}
              </label>
            );
          })}
          {!applied && (
            <div className="flex justify-end pt-1">
              <Button size="sm" disabled={selected.size === 0 || apply.isPending} onClick={() => apply.mutate()}>
                {apply.isPending ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : null}
                Approve {selected.size} of {acts.length}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CommandSection() {
  const qc = useQueryClient();
  const runFn = useServerFn(runAiCommand);
  const historyFn = useServerFn(listAiCommandHistory);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"read" | "execute">("execute");
  const [readCards, setReadCards] = useState(true);

  const { data: history } = useQuery({
    queryKey: ["ai-cmd-history"],
    queryFn: () => historyFn() as Promise<HistoryRow[]>,
  });

  const mut = useMutation({
    mutationFn: () => runFn({ data: { prompt: prompt.trim(), mode, scope: readCards ? "board" : "owned" } }) as Promise<{
      id: string | null; response: string; actions: any[]; status: string;
    }>,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["ai-cmd-history"] });
      setPrompt("");
      if (res.actions.length > 0) {
        toast.warning(`AI proposed ${res.actions.length} action(s) — review and approve below.`);
      } else {
        toast.success("AI responded");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Talk to the AI agent</CardTitle>
          <CardDescription>Ask questions or issue commands. The agent proposes actions — you approve before anything runs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Move tomorrow's Malta trips to Wednesday — or — Message the driver on trip #a1b2 that pickup is delayed 10 min"
            rows={3}
          />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMode("read")}
                  className={`px-2 py-1 rounded border ${mode === "read" ? "bg-primary text-primary-foreground border-primary" : ""}`}
                >Read</button>
                <button
                  type="button"
                  onClick={() => setMode("execute")}
                  className={`px-2 py-1 rounded border ${mode === "execute" ? "bg-primary text-primary-foreground border-primary" : ""}`}
                >Agent</button>
              </div>
              <label className="flex items-center gap-1.5 text-muted-foreground">
                <Switch checked={readCards} onCheckedChange={(v) => setReadCards(!!v)} />
                Read all dispatch board cards
              </label>
              <span className="text-muted-foreground">
                {mode === "read" ? "Q&A only." : "Proposes actions for your approval."}
              </span>
            </div>
            <Button
              onClick={() => mut.mutate()}
              disabled={mut.isPending || prompt.trim().length < 2}
            >
              {mut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
              Send
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Recent commands
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(history ?? []).length === 0 && (
            <div className="text-xs text-muted-foreground">No commands yet.</div>
          )}
          {(history ?? []).map((h) => (
            <HistoryEntry key={h.id} h={h} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// -------- 3. Rules --------
function RulesSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAiRules);
  const upsertFn = useServerFn(upsertAiRule);
  const delFn = useServerFn(deleteAiRule);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-rules"],
    queryFn: () => listFn() as Promise<AiRule[]>,
  });

  const [editing, setEditing] = useState<{ id?: string; title: string; rule_text: string; enabled: boolean } | null>(null);

  const upsert = useMutation({
    mutationFn: (v: { id?: string; title: string; rule_text: string; enabled: boolean; sort_order: number }) =>
      upsertFn({ data: v }) as Promise<{ ok: boolean }>,
    onSuccess: () => { toast.success("Rule saved"); qc.invalidateQueries({ queryKey: ["ai-rules"] }); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }) as Promise<{ ok: boolean }>,
    onSuccess: () => { toast.success("Rule deleted"); qc.invalidateQueries({ queryKey: ["ai-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (r: AiRule) => upsert.mutate({ id: r.id, title: r.title, rule_text: r.rule_text, enabled: !r.enabled, sort_order: r.sort_order });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your custom AI rules</CardTitle>
          <CardDescription>
            Plain-English rules that every AI action follows. Example: "If a flight is delayed more than 60 minutes, unassign the driver and alert me."
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" onClick={() => setEditing({ title: "", rule_text: "", enabled: true })}>
            <Plus className="h-4 w-4 mr-1" /> New rule
          </Button>
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {(data ?? []).length === 0 && !isLoading && (
            <div className="text-xs text-muted-foreground">No rules yet — add your first one above.</div>
          )}
          {(data ?? []).map((r) => (
            <div key={r.id} className="rounded-md border p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm truncate">{r.title || "(untitled)"}</div>
                  {!r.enabled && <Badge variant="outline">Off</Badge>}
                </div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap mt-0.5">{r.rule_text}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Switch checked={r.enabled} onCheckedChange={() => toggle(r)} />
                <Button variant="ghost" size="icon" onClick={() => setEditing({ id: r.id, title: r.title, rule_text: r.rule_text, enabled: r.enabled })}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => del.mutate(r.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editing.id ? "Edit rule" : "New rule"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="e.g. Flight delay handling" />
            </div>
            <div className="space-y-1.5">
              <Label>Rule</Label>
              <Textarea
                rows={4}
                value={editing.rule_text}
                onChange={(e) => setEditing({ ...editing, rule_text: e.target.value })}
                placeholder="If a flight is delayed by more than 60 minutes, unassign the driver and alert me."
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editing.enabled} onCheckedChange={(v) => setEditing({ ...editing, enabled: !!v })} />
              <span className="text-sm">Enabled</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                onClick={() => upsert.mutate({
                  id: editing.id,
                  title: editing.title.trim(),
                  rule_text: editing.rule_text.trim(),
                  enabled: editing.enabled,
                  sort_order: 0,
                })}
                disabled={upsert.isPending || editing.title.trim().length === 0 || editing.rule_text.trim().length < 3}
              >
                {upsert.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
