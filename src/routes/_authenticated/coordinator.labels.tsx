import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { listLabels, createLabel, updateLabel, deleteLabel } from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PRESET_COLORS } from "@/components/coordinator/LabelPicker";
import { LabelChip, type Label as TLabel } from "@/components/coordinator/LabelChip";

export const Route = createFileRoute("/_authenticated/coordinator/labels")({
  head: () => ({ meta: [{ title: "Labels — Coordinator" }] }),
  component: LabelsPage,
});

function LabelsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listLabels);
  const { data: labels } = useQuery({
    queryKey: ["trip-labels"],
    queryFn: () => listFn() as Promise<TLabel[]>,
  });

  const createFn = useServerFn(createLabel);
  const updateFn = useServerFn(updateLabel);
  const deleteFn = useServerFn(deleteLabel);

  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[8]);

  const createMut = useMutation({
    mutationFn: () => createFn({ data: { name: name.trim(), color } }),
    onSuccess: () => {
      toast.success("Created");
      setName("");
      qc.invalidateQueries({ queryKey: ["trip-labels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; name?: string; color?: string }) => updateFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trip-labels"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["trip-labels"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold">Trip labels</h1>
        <p className="text-sm text-muted-foreground">Color-coded tags (VIP, urgent, airport run…) you can attach to any trip.</p>
      </header>

      <section className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Create label</div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VIP Crew" />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c} type="button" onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c }} aria-label={c}
                />
              ))}
            </div>
          </div>
          <Button disabled={!name.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
            <Plus className="h-4 w-4 mr-1" /> Create
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="text-sm font-medium mb-3">Your labels ({labels?.length ?? 0})</div>
        {(!labels || labels.length === 0) ? (
          <div className="text-sm text-muted-foreground py-8 text-center">No labels yet.</div>
        ) : (
          <ul className="divide-y">
            {labels.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2">
                <input
                  type="color" value={l.color}
                  onChange={(e) => updateMut.mutate({ id: l.id, color: e.target.value.toUpperCase() })}
                  className="h-8 w-8 rounded cursor-pointer border-0 bg-transparent p-0"
                  aria-label="Color"
                />
                <Input
                  defaultValue={l.name}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) updateMut.mutate({ id: l.id, name: v }); }}
                  className="max-w-[240px]"
                />
                <div className="flex-1"><LabelChip label={l} /></div>
                <Button
                  size="sm" variant="ghost" className="text-destructive"
                  onClick={() => { if (confirm(`Delete label "${l.name}"?`)) deleteMut.mutate(l.id); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
