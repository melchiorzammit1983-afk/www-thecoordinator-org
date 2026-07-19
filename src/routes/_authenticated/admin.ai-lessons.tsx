import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { GraduationCap, Check, X, Archive, Globe, Building2, Loader2, Sparkles, ShieldAlert } from "lucide-react";
import { adminListLessons, adminDecideLesson, adminCreateGlobalLesson } from "@/lib/ai-lessons.functions";
import { redactPii } from "@/lib/ai-pii-preview";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SafetyBanner } from "@/components/ai/SafetyBanner";

type LessonKind = "parse_pattern" | "qa" | "suggestion_rule" | "signal_fix";

export const Route = createFileRoute("/_authenticated/admin/ai-lessons")({
  component: AiLessonsAdmin,
});

type Lesson = {
  id: string; kind: string; scope: string; status: string; title: string;
  rule_text: string; example_input_redacted: string; company_id: string | null;
  usage_count: number; positive_count: number; negative_count: number;
  reject_reason: string | null; created_at: string;
};

function AiLessonsAdmin() {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const listFn = useServerFn(adminListLessons);
  const decideFn = useServerFn(adminDecideLesson);
  const qc = useQueryClient();

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["admin", "ai-lessons", tab],
    queryFn: () => listFn({ data: { status: tab } }) as Promise<Lesson[]>,
  });

  type DecideInput = { id: string; action: "approve_global" | "approve_company" | "reject" | "archive"; reason?: string; edited_rule?: string; edited_title?: string };
  const decide = useMutation({
    mutationFn: (v: DecideInput) => decideFn({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "ai-lessons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-primary" /> AI Lessons — curation
        </h1>
        <p className="text-sm text-muted-foreground">
          Approve, edit, or reject patterns companies teach the AI. Approved global lessons benefit every opted-in company.
        </p>
      </div>

      <SafetyBanner />

      <TeachGlobalCard />



      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {isFetching && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>}
      {rows.length === 0 && !isFetching && (
        <div className="text-sm text-muted-foreground p-6 text-center border rounded-lg">Nothing here yet.</div>
      )}

      <div className="grid gap-3">
        {rows.map((l) => (
          <LessonRow key={l.id} lesson={l} onDecide={(v) => decide.mutate(v)} busy={decide.isPending} />
        ))}
      </div>
    </div>
  );
}

function LessonRow({ lesson, onDecide, busy }: {
  lesson: Lesson;
  onDecide: (v: { id: string; action: "approve_global" | "approve_company" | "reject" | "archive"; reason?: string; edited_rule?: string; edited_title?: string }) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(lesson.title);
  const [rule, setRule] = useState(lesson.rule_text);
  const [reason, setReason] = useState("");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Badge variant="outline">{lesson.kind}</Badge>
          <Badge variant={lesson.scope === "global" ? "default" : "secondary"}>{lesson.scope}</Badge>
          <Badge variant={lesson.status === "approved" ? "default" : lesson.status === "rejected" ? "destructive" : "outline"}>
            {lesson.status}
          </Badge>
          <span className="text-xs text-muted-foreground ml-auto">
            👍 {lesson.positive_count} · 👎 {lesson.negative_count} · used {lesson.usage_count}×
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full mt-0.5 px-2 py-1 rounded border bg-background text-sm" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground">Rule</label>
          <Textarea rows={2} value={rule} onChange={(e) => setRule(e.target.value)} className="text-xs" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground">Example (redacted)</label>
          <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">{lesson.example_input_redacted}</pre>
        </div>
        {lesson.reject_reason && (
          <div className="text-red-600">Reject reason: {lesson.reject_reason}</div>
        )}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" disabled={busy} onClick={() => onDecide({ id: lesson.id, action: "approve_global", edited_title: title, edited_rule: rule })}>
            <Globe className="h-3 w-3 mr-1" /> Approve global
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide({ id: lesson.id, action: "approve_company", edited_title: title, edited_rule: rule })}>
            <Building2 className="h-3 w-3 mr-1" /> Approve company-only
          </Button>
          <div className="flex items-center gap-1">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reject reason"
              className="px-2 py-1 rounded border bg-background text-xs w-40" />
            <Button size="sm" variant="destructive" disabled={busy}
              onClick={() => onDecide({ id: lesson.id, action: "reject", reason })}>
              <X className="h-3 w-3 mr-1" /> Reject
            </Button>
          </div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide({ id: lesson.id, action: "archive" })}>
            <Archive className="h-3 w-3 mr-1" /> Archive
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TeachGlobalCard() {
  const createFn = useServerFn(adminCreateGlobalLesson);
  const qc = useQueryClient();
  const [kind, setKind] = useState<LessonKind>("qa");
  const [title, setTitle] = useState("");
  const [example, setExample] = useState("");
  const [rule, setRule] = useState("");

  const preview = example ? redactPii(example) : null;
  const mut = useMutation({
    mutationFn: () => createFn({ data: { kind, title, example_input: example, rule_text: rule } }),
    onSuccess: () => {
      toast.success("Global lesson saved — every opted-in company will retrieve it.");
      setTitle(""); setExample(""); setRule("");
      qc.invalidateQueries({ queryKey: ["admin", "ai-lessons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = title.trim().length >= 3 && example.trim().length >= 1 && rule.trim().length >= 3;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" /> Teach the global AI
        </CardTitle>
        <CardDescription>
          Anything you save here is stored as an approved global lesson and injected into every opted-in company's AI when it's semantically relevant. Personal data is stripped first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Kind</Label>
          <RadioGroup value={kind} onValueChange={(v) => setKind(v as LessonKind)} className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-1.5">
            {[
              ["parse_pattern", "Message format"],
              ["qa", "How-to answer"],
              ["suggestion_rule", "Suggestion rule"],
              ["signal_fix", "Signal → fix"],
            ].map(([v, l]) => (
              <div key={v} className="flex items-center gap-2 rounded-md border p-2 text-xs">
                <RadioGroupItem value={v} id={`g-${v}`} /> <Label htmlFor={`g-${v}`} className="cursor-pointer">{l}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div>
          <Label htmlFor="g-title" className="text-xs">Short title</Label>
          <Input id="g-title" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder='e.g. "Hotel emails put pax count in brackets after name"' />
        </div>

        <div>
          <Label htmlFor="g-example" className="text-xs">Example input</Label>
          <Textarea id="g-example" rows={4} value={example} onChange={(e) => setExample(e.target.value)}
            placeholder="Paste a representative message or extract…" />
          {preview && Object.keys(preview.stripped).length > 0 && (
            <div className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              <ShieldAlert className="mt-0.5 h-3 w-3" />
              <span>
                Personal data will be replaced with tags before storage:{" "}
                {Object.entries(preview.stripped).map(([k, n]) => `${k}(${n})`).join(", ")}.
              </span>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="g-rule" className="text-xs">The rule to remember</Label>
          <Textarea id="g-rule" rows={3} value={rule} onChange={(e) => setRule(e.target.value)}
            placeholder='e.g. "Number in brackets after the name is the passenger count"' />
        </div>

        <div className="flex justify-end">
          <Button size="sm" disabled={!canSubmit || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            <Globe className="h-3.5 w-3.5 mr-1" /> Save global lesson
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

