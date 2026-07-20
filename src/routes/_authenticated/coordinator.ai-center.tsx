import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Plus, Trash2, Pencil, Loader2, Undo2, Sparkles, MessageSquare, Receipt } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { listAiRules, upsertAiRule, deleteAiRule, getAiConfig, saveAiConfig, aiAutoCoordinate, applyAutoCoordinateProposal } from "@/lib/coordinator.functions";
import { listMyLessons, archiveMyLesson } from "@/lib/ai-lessons.functions";
import { listAiAuditActions, upsertGlossaryTerm, undoAssistantAction } from "@/lib/ai-audit.functions";
import { AiLearningTab } from "@/components/coordinator/AiLearningTab";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/coordinator/ai-center")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (typeof s.tab === "string" ? s.tab : "knowledge") as
      | "knowledge" | "agents" | "activity" | "learning" | "toggles",
  }),
  component: AiBrainPage,
});

function AiBrainPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">AI Brain</h1>
          <p className="text-sm text-muted-foreground">
            Everything the AI knows, does, and has done — in one place.
          </p>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => navigate({ search: { tab: v as typeof tab }, replace: true })}
      >
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="learning">Learning</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="knowledge" className="mt-4 space-y-4"><KnowledgeTab /></TabsContent>
        <TabsContent value="learning" className="mt-4"><AiLearningTab /></TabsContent>
        <TabsContent value="agents" className="mt-4 space-y-4"><AgentsTab /></TabsContent>
        <TabsContent value="activity" className="mt-4"><ActivityTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* -------------------------------------------------------------- */
/* TAB 1 · Knowledge                                              */
/* -------------------------------------------------------------- */

type Lesson = {
  id: string;
  kind: string;
  title: string;
  rule_text: string;
  status: string;
  scope: string;
};

function KnowledgeTab() {
  return (
    <>
      <GlossarySection />
      <RulesSection />
      <LearnedBiasSection />
    </>
  );
}

function GlossarySection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyLessons);
  const upsertFn = useServerFn(upsertGlossaryTerm);
  const archiveFn = useServerFn(archiveMyLesson);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-lessons-mine"],
    queryFn: () => listFn() as Promise<Lesson[]>,
  });
  const glossary = (data ?? []).filter((l) => l.kind === "glossary" && l.status === "approved");

  const [edit, setEdit] = useState<{ id?: string; term: string; meaning: string } | null>(null);

  const save = useMutation({
    mutationFn: (v: { id?: string; term: string; meaning: string }) =>
      upsertFn({ data: v }) as Promise<{ ok: boolean }>,
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["ai-lessons-mine"] });
      setEdit(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }) as Promise<{ ok: boolean }>,
    onSuccess: () => {
      toast.success("Archived");
      qc.invalidateQueries({ queryKey: ["ai-lessons-mine"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Glossary — shorthand &amp; aliases</CardTitle>
        <CardDescription>
          Short forms the assistant should expand before deciding anything (e.g. <em>MSV = Medserv Freeport</em>).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" onClick={() => setEdit({ term: "", meaning: "" })}>
          <Plus className="h-4 w-4 mr-1" /> New term
        </Button>
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && glossary.length === 0 && (
          <div className="text-xs text-muted-foreground">No terms yet.</div>
        )}
        {glossary.map((g) => (
          <div key={g.id} className="rounded-md border p-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-sm">{g.title}</div>
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">{g.rule_text}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" onClick={() => setEdit({ id: g.id, term: g.title, meaning: g.rule_text })}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => archive.mutate(g.id)} title="Archive">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
        {edit && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="space-y-1.5">
              <Label>Shorthand</Label>
              <Input value={edit.term} onChange={(e) => setEdit({ ...edit, term: e.target.value })} placeholder="MSV" />
            </div>
            <div className="space-y-1.5">
              <Label>Meaning</Label>
              <Textarea rows={2} value={edit.meaning} onChange={(e) => setEdit({ ...edit, meaning: e.target.value })} placeholder="Medserv Freeport" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
              <Button
                disabled={save.isPending || edit.term.trim().length === 0 || edit.meaning.trim().length === 0}
                onClick={() => save.mutate({ id: edit.id, term: edit.term.trim(), meaning: edit.meaning.trim() })}
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type AiRule = {
  id: string;
  title: string;
  rule_text: string;
  enabled: boolean;
  sort_order: number;
};

function RulesSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAiRules);
  const upsertFn = useServerFn(upsertAiRule);
  const delFn = useServerFn(deleteAiRule);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-rules"],
    queryFn: () => listFn() as Promise<AiRule[]>,
  });

  const [edit, setEdit] = useState<{ id?: string; title: string; rule_text: string; enabled: boolean } | null>(null);
  const save = useMutation({
    mutationFn: (v: { id?: string; title: string; rule_text: string; enabled: boolean; sort_order: number }) =>
      upsertFn({ data: v }) as Promise<{ ok: boolean }>,
    onSuccess: () => { toast.success("Rule saved"); qc.invalidateQueries({ queryKey: ["ai-rules"] }); setEdit(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }) as Promise<{ ok: boolean }>,
    onSuccess: () => { toast.success("Rule deleted"); qc.invalidateQueries({ queryKey: ["ai-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (r: AiRule) =>
    save.mutate({ id: r.id, title: r.title, rule_text: r.rule_text, enabled: !r.enabled, sort_order: r.sort_order });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Business rules</CardTitle>
        <CardDescription>
          Hard rules the AI must apply to every proposal (e.g. "always ask before assigning drivers on Sundays").
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" onClick={() => setEdit({ title: "", rule_text: "", enabled: true })}>
          <Plus className="h-4 w-4 mr-1" /> New rule
        </Button>
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && (data ?? []).length === 0 && (
          <div className="text-xs text-muted-foreground">No rules yet.</div>
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
              <Button variant="ghost" size="icon" onClick={() => setEdit({ id: r.id, title: r.title, rule_text: r.rule_text, enabled: r.enabled })}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => del.mutate(r.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
        {edit && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Rule</Label>
              <Textarea rows={3} value={edit.rule_text} onChange={(e) => setEdit({ ...edit, rule_text: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={edit.enabled} onCheckedChange={(v) => setEdit({ ...edit, enabled: !!v })} />
              <span className="text-sm">Enabled</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
              <Button
                onClick={() => save.mutate({
                  id: edit.id,
                  title: edit.title.trim(),
                  rule_text: edit.rule_text.trim(),
                  enabled: edit.enabled,
                  sort_order: 0,
                })}
                disabled={save.isPending || edit.title.trim().length === 0 || edit.rule_text.trim().length < 3}
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LearnedBiasSection() {
  const listFn = useServerFn(listMyLessons);
  const { data } = useQuery({
    queryKey: ["ai-lessons-mine"],
    queryFn: () => listFn() as Promise<Lesson[]>,
  });
  const biases = (data ?? []).filter((l) => l.kind === "suggestion_rule" && l.status === "approved");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Learned preferences
        </CardTitle>
        <CardDescription>
          Soft biases the AI has picked up from your past choices. Updates automatically — read-only here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {biases.length === 0 && (
          <div className="text-xs text-muted-foreground">Nothing learned yet — I'll start noting patterns as you use the assistant.</div>
        )}
        {biases.map((b) => (
          <div key={b.id} className="rounded-md border p-2.5 text-sm">
            <div className="font-medium">{b.title}</div>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap">{b.rule_text}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------- */
/* TAB 2 · Agents registry                                        */
/* -------------------------------------------------------------- */

function AgentsTab() {
  const listFn = useServerFn(listAiAuditActions);
  const { data } = useQuery({
    queryKey: ["ai-audit", 0],
    queryFn: () => listFn({ data: { limit: 1, offset: 0 } }) as Promise<{
      rows: Array<{ created_at: string }>;
    }>,
  });
  const lastActive = data?.rows?.[0]?.created_at ?? null;

  return (
    <>
      <AgentCard
        icon={<MessageSquare className="h-4 w-4" />}
        name="Dispatch"
        description="Handles trip creation & edits (single, batch, and by shared reference), typo fixes, grouping/ungrouping, driver &amp; client messages, conflict detection, backlog auto-coordinate, and partner hand-off suggestions. Everything runs confirm-first."
        lastActive={lastActive}
      />
      <AgentCard
        icon={<Receipt className="h-4 w-4" />}
        name="Billing"
        description="Answers billing questions in the same chat: your current points balance, recent point-spend history, and per-feature pricing. Q&amp;A only — top-ups still go through the Billing page."
        lastActive={null}
        note="Always on. Ask the assistant anything about points or feature costs."
      />
    </>
  );
}

function AgentCard(props: {
  icon: React.ReactNode;
  name: string;
  description: string;
  lastActive: string | null;
  note?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className="text-primary">{props.icon}</span>
          <CardTitle className="text-base">{props.name}</CardTitle>
          <Badge variant="outline" className="ml-auto">confirm-first</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <p className="text-sm">{props.description}</p>
        {props.lastActive && (
          <p className="text-xs text-muted-foreground">Last active: {new Date(props.lastActive).toLocaleString()}</p>
        )}
        {props.note && <p className="text-xs text-muted-foreground">{props.note}</p>}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------- */
/* TAB 3 · Activity & Rollback                                    */
/* -------------------------------------------------------------- */

type AuditRow = {
  id: string;
  action_kind: string;
  target_table: string;
  target_id: string | null;
  summary: string | null;
  raw_message: string | null;
  created_at: string;
  undone_at: string | null;
  undo_note: string | null;
  actor_email: string | null;
};

const PAGE_SIZE = 50;

function ActivityTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAiAuditActions);
  const undoFn = useServerFn(undoAssistantAction);
  const [page, setPage] = useState(0);
  const [confirmRow, setConfirmRow] = useState<AuditRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-audit", page],
    queryFn: () => listFn({ data: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } }) as Promise<{
      rows: AuditRow[]; total: number;
    }>,
  });

  const undo = useMutation({
    mutationFn: (id: string) => undoFn({ data: { audit_id: id } }) as Promise<{ ok: boolean; kind: string }>,
    onSuccess: (res) => {
      toast.success(`Undone (${res.kind})`);
      qc.invalidateQueries({ queryKey: ["ai-audit"] });
      setConfirmRow(null);
    },
    onError: (e: Error) => {
      toast.error(`Undo failed: ${e.message}`);
      setConfirmRow(null);
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent AI actions</CardTitle>
        <CardDescription>
          Every confirmed AI action with one-click rollback. Rollbacks are free.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && rows.length === 0 && (
          <div className="text-xs text-muted-foreground">No AI actions logged yet.</div>
        )}
        {rows.map((r) => {
          const undone = !!r.undone_at;
          return (
            <div key={r.id} className={`rounded-md border p-3 text-sm ${undone ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <Badge variant="outline" className="capitalize">{r.action_kind.replace("_", " ")}</Badge>
                <span>{new Date(r.created_at).toLocaleString()}</span>
                {r.actor_email && <span>· {r.actor_email}</span>}
                <span className="ml-auto">
                  {undone ? (
                    <Badge variant="secondary">Undone{r.undo_note ? ` — ${r.undo_note}` : ""}</Badge>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setConfirmRow(r)} disabled={undo.isPending}>
                      {undo.isPending && undo.variables === r.id ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Undo2 className="h-3 w-3 mr-1" />
                      )}
                      Undo
                    </Button>
                  )}
                </span>
              </div>
              <div className="mt-1 font-medium">{r.summary || `${r.action_kind} on ${r.target_table}`}</div>
              {r.raw_message && (
                <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">"{r.raw_message}"</div>
              )}
            </div>
          );
        })}

        {pageCount > 1 && (
          <div className="flex items-center justify-between pt-2">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <div className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</div>
            <Button size="sm" variant="ghost" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!confirmRow} onOpenChange={(o) => !o && setConfirmRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this AI action?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRow?.summary || `${confirmRow?.action_kind} on ${confirmRow?.target_table}`}
              <br />
              <span className="text-xs">
                If the row has changed since, the undo may be rejected. This is not billable.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undo.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={undo.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmRow) undo.mutate(confirmRow.id);
              }}
            >
              {undo.isPending ? "Undoing…" : "Undo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
