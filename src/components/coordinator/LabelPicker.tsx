import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Plus, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { listLabels, createLabel } from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LabelChip, labelTint, type Label as TLabel } from "./LabelChip";

export const PRESET_COLORS = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308",
  "#22C55E", "#10B981", "#14B8A6", "#0EA5E9",
  "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899",
];

export function LabelPicker({
  value, onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listLabels);
  const { data: labels } = useQuery({
    queryKey: ["trip-labels"],
    queryFn: () => listFn() as Promise<TLabel[]>,
    staleTime: 30_000,
  });
  const createFn = useServerFn(createLabel);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[8]);
  const createMut = useMutation({
    mutationFn: () => createFn({ data: { name: name.trim(), color } }) as Promise<TLabel>,
    onSuccess: (row) => {
      toast.success("Label created");
      setName("");
      qc.invalidateQueries({ queryKey: ["trip-labels"] });
      onChange([...value, row.id]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selected = (labels ?? []).filter((l) => value.includes(l.id));
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> Labels</Label>
      <div className="flex flex-wrap gap-1.5 items-center rounded-md border p-2 min-h-[42px]">
        {selected.length === 0 && (
          <span className="text-xs text-muted-foreground">No labels</span>
        )}
        {selected.map((l) => (
          <span
            key={l.id}
            className="inline-flex items-center gap-1 rounded text-xs px-1.5 py-0.5 font-medium"
            style={{ backgroundColor: labelTint(l.color), color: l.color }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: l.color }} />
            {l.name}
            <button type="button" onClick={() => toggle(l.id)} className="ml-0.5 opacity-70 hover:opacity-100">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs">
              <Plus className="h-3 w-3 mr-1" /> Label
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="max-h-40 overflow-auto space-y-0.5 mb-2">
              {(labels ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground px-2 py-3 text-center">
                  No labels yet — create your first below.
                </div>
              )}
              {(labels ?? []).map((l) => {
                const active = value.includes(l.id);
                return (
                  <button
                    key={l.id} type="button" onClick={() => toggle(l.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted text-left"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                    <span className="flex-1 truncate">{l.name}</span>
                    {active && <Check className="h-3 w-3 text-primary" />}
                  </button>
                );
              })}
            </div>
            <div className="border-t pt-2 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">New label</div>
              <Input
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. VIP Crew" className="h-7 text-xs"
              />
              <div className="flex flex-wrap gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c} type="button" onClick={() => setColor(c)}
                    className={`h-5 w-5 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
              <Button
                type="button" size="sm" className="w-full h-7 text-xs"
                disabled={!name.trim() || createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export { LabelChip };
