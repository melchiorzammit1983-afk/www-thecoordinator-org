import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Archive, Loader2 } from "lucide-react";
import { listMyLessons, archiveMyLesson, getShareSettings, setShareSettings } from "@/lib/ai-lessons.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SafetyBanner } from "@/components/ai/SafetyBanner";
import { TeachAiDialog } from "@/components/ai/TeachAiDialog";

export function AiLearningTab() {
  const listFn = useServerFn(listMyLessons);
  const archFn = useServerFn(archiveMyLesson);
  const getShare = useServerFn(getShareSettings);
  const setShare = useServerFn(setShareSettings);
  const qc = useQueryClient();

  const { data: lessons = [], isLoading } = useQuery({
    queryKey: ["my-ai-lessons"],
    queryFn: () => listFn() as Promise<Array<{
      id: string; kind: string; title: string; rule_text: string; status: string; scope: string;
      usage_count: number; positive_count: number; negative_count: number; created_at: string;
    }>>,
  });

  const { data: share } = useQuery({
    queryKey: ["ai-share-settings"],
    queryFn: () => getShare(),
  });

  const [contribute, setContribute] = useState<boolean | null>(null);
  const [consume, setConsume] = useState<boolean | null>(null);
  const effContribute = contribute ?? share?.contribute_to_global ?? false;
  const effConsume = consume ?? share?.consume_global ?? true;

  const save = useMutation({
    mutationFn: () => setShare({ data: { contribute_to_global: effContribute, consume_global: effConsume } }),
    onSuccess: () => { toast.success("Settings saved."); qc.invalidateQueries({ queryKey: ["ai-share-settings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const arch = useMutation({
    mutationFn: (id: string) => archFn({ data: { id } }),
    onSuccess: () => { toast.success("Archived"); qc.invalidateQueries({ queryKey: ["my-ai-lessons"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const active = lessons.filter((l) => l.status !== "archived");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Teach the AI</CardTitle>
              <CardDescription>
                Patterns your company sees a lot — hotel email formats, shorthand, how to handle a signal.
                Only redacted, non-personal patterns are stored.
              </CardDescription>
            </div>
            <TeachAiDialog />
          </div>
        </CardHeader>
      </Card>

      <SafetyBanner />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Sharing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm">Use lessons from other companies</Label>
              <p className="text-xs text-muted-foreground">Benefit from admin-approved global patterns.</p>
            </div>
            <Switch checked={effConsume} onCheckedChange={(v) => setConsume(v)} />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm">Contribute my lessons to the global brain</Label>
              <p className="text-xs text-muted-foreground">Your submissions marked "propose to global" go into the admin queue. Personal data is stripped first.</p>
            </div>
            <Switch checked={effContribute} onCheckedChange={(v) => setContribute(v)} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">My lessons ({active.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>}
          {!isLoading && active.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No lessons yet. Click "Teach the AI" to add one.
            </div>
          )}
          <div className="divide-y">
            {active.map((l) => (
              <div key={l.id} className="py-2 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-sm">{l.title}</span>
                    <Badge variant="outline" className="text-[10px]">{l.kind}</Badge>
                    <Badge variant={l.scope === "global" ? "default" : "secondary"} className="text-[10px]">{l.scope}</Badge>
                    <Badge variant={l.status === "approved" ? "default" : "outline"} className="text-[10px]">{l.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{l.rule_text}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Used {l.usage_count}× · 👍 {l.positive_count} · 👎 {l.negative_count}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => arch.mutate(l.id)} disabled={arch.isPending}>
                  <Archive className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
