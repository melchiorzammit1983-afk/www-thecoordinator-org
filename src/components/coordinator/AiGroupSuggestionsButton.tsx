import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { aiSuggestTripGroupings, groupJobs } from "@/lib/coordinator.functions";
import { FeatureGate } from "@/components/billing/FeatureGate";

type Suggestion = { trip_ids: string[]; reason: string };

export function AiGroupSuggestionsButton({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const qc = useQueryClient();
  const runFn = useServerFn(aiSuggestTripGroupings);
  const groupFn = useServerFn(groupJobs);

  const runMut = useMutation({
    mutationFn: () => runFn({ data: { date } }) as Promise<{ suggestions: Suggestion[] }>,
    onSuccess: (r) => {
      setSuggestions(r.suggestions ?? []);
      if ((r.suggestions ?? []).length === 0) toast.info("No group opportunities found.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMut = useMutation({
    mutationFn: (ids: string[]) => groupFn({ data: { job_ids: ids, name: "AI grouped" } }),
    onSuccess: () => { toast.success("Grouped"); qc.invalidateQueries({ queryKey: ["calendar-jobs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setOpen(true); runMut.mutate(); }}>
        <Sparkles className="h-4 w-4 mr-1.5" /> AI suggest groups
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI group suggestions</DialogTitle>
          </DialogHeader>
          <FeatureGate feature="ai_group_suggestions">
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {runMut.isPending ? <p className="text-sm text-muted-foreground">Thinking…</p> : null}
              {!runMut.isPending && suggestions.length === 0 ? <p className="text-sm text-muted-foreground">No suggestions yet.</p> : null}
              {suggestions.map((s, i) => (
                <div key={i} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.trip_ids.map((id) => <Badge key={id} variant="outline" className="text-[10px] font-mono">{id.slice(0, 8)}</Badge>)}
                  </div>
                  <p className="text-xs text-muted-foreground">{s.reason}</p>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => applyMut.mutate(s.trip_ids)} disabled={applyMut.isPending}>Apply</Button>
                  </div>
                </div>
              ))}
            </div>
          </FeatureGate>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button variant="secondary" onClick={() => runMut.mutate()} disabled={runMut.isPending}>Re-run</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
