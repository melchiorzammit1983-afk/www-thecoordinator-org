/**
 * Renders a client name alongside a small pin that opens the client's note
 * for view/edit. Reads and writes go through `listClientNotes` /
 * `upsertClientNote` (RLS-scoped to the coordinator's company).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { StickyNote, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { listClientNotes, upsertClientNote, normalizeClientKey } from "@/lib/client-notes.functions";

type Props = {
  clientName: string | null | undefined;
  /** Fallback text when clientName is empty. Defaults to nothing. */
  emptyLabel?: string;
  className?: string;
};

export function useClientNotesMap() {
  const listFn = useServerFn(listClientNotes);
  const q = useQuery({
    queryKey: ["client-notes"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });
  const map = useMemo(() => {
    const m = new Map<string, { note: string; display: string }>();
    for (const n of q.data ?? []) m.set(n.client_key, { note: n.note, display: n.client_display });
    return m;
  }, [q.data]);
  return { map, isLoading: q.isLoading };
}

export function ClientNameWithNote({ clientName, emptyLabel = "", className }: Props) {
  const qc = useQueryClient();
  const { map } = useClientNotesMap();
  const upsertFn = useServerFn(upsertClientNote);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const name = (clientName ?? "").trim();
  const key = name ? normalizeClientKey(name) : "";
  const existing = key ? map.get(key)?.note ?? "" : "";

  const save = useMutation({
    mutationFn: () => upsertFn({ data: { client_name: name, note: draft } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["client-notes"] });
      toast.success(r.deleted ? "Note removed." : "Note saved.");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!name) return <span className={className}>{emptyLabel}</span>;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <span className="truncate">{name}</span>
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) setDraft(existing);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={existing ? "View client note" : "Add client note"}
            className={
              existing
                ? "inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
                : "inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground"
            }
          >
            <StickyNote className="h-3 w-3" />
            {existing ? <span>note</span> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-2" align="start">
          <div className="text-xs font-medium">Note for {name}</div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="e.g. Annex 1 needed on arrival. Always invoice to head office."
          />
          <div className="flex justify-between items-center">
            <p className="text-[10px] text-muted-foreground">Shown next to this client everywhere.</p>
            <div className="flex gap-2">
              {existing ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft("");
                    save.mutate();
                  }}
                  disabled={save.isPending}
                >
                  Remove
                </Button>
              ) : null}
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || draft === existing}>
                {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}
