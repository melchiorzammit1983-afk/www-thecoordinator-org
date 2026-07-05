import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { mergeTrips } from "@/lib/coordinator.functions";

export type MergeCandidate = {
  id: string;
  date: string | null;
  time: string | null;
  from_location: string | null;
  to_location: string | null;
  pax_names?: string[];
};

export function MergeTripsDialog({
  open, onOpenChange, current, duplicates, onMerged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: MergeCandidate;
  duplicates: MergeCandidate[];
  onMerged?: () => void;
}) {
  const all = useMemo(() => {
    const uniq = new Map<string, MergeCandidate>();
    uniq.set(current.id, current);
    for (const d of duplicates) if (!uniq.has(d.id)) uniq.set(d.id, d);
    return Array.from(uniq.values());
  }, [current, duplicates]);
  const [keepId, setKeepId] = useState<string>(current.id);
  const qc = useQueryClient();
  const fn = useServerFn(mergeTrips);
  const mut = useMutation({
    mutationFn: () =>
      fn({
        data: {
          keep_job_id: keepId,
          drop_job_ids: all.map((t) => t.id).filter((id) => id !== keepId),
        },
      }),
    onSuccess: (r: any) => {
      toast.success(`Merged ${r.cancelled} trip${r.cancelled === 1 ? "" : "s"}${r.merged_pax ? ` · ${r.merged_pax} pax copied` : ""}`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["trip-flags"] });
      onOpenChange(false);
      onMerged?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge duplicate trips</DialogTitle>
          <DialogDescription>
            Pick the trip to keep. The others will be cancelled and any missing passengers copied over.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={keepId} onValueChange={setKeepId} className="space-y-2">
          {all.map((t) => (
            <label
              key={t.id}
              htmlFor={`keep-${t.id}`}
              className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer ${keepId === t.id ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <RadioGroupItem id={`keep-${t.id}`} value={t.id} className="mt-0.5" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">
                  {t.date ?? "—"} · {t.time?.slice(0, 5) ?? "—"}
                </div>
                <div className="text-muted-foreground truncate">
                  {t.from_location} → {t.to_location}
                </div>
                {(t.pax_names?.length ?? 0) > 0 && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    Pax: {t.pax_names!.join(", ")}
                  </div>
                )}
                {t.id === current.id && (
                  <Label className="text-[10px] uppercase tracking-widest text-primary mt-1 block">This trip</Label>
                )}
              </div>
            </label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Merging…" : "Merge trips"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
