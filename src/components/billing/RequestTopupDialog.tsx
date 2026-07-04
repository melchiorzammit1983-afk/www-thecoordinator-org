import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Coins, Send } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { listPointPacks, requestTopup } from "@/lib/billing.functions";
import { usePointsRemaining } from "@/hooks/use-features";

export function RequestTopupDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"pack" | "custom">("pack");
  const [packId, setPackId] = useState<string | null>(null);
  const [customPoints, setCustomPoints] = useState("500");
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const listFn = useServerFn(listPointPacks);
  const reqFn = useServerFn(requestTopup);
  const remaining = usePointsRemaining();

  const { data: packs } = useQuery({
    queryKey: ["point-packs"],
    queryFn: () => listFn() as Promise<{ id: string; name: string; points: number; price: number }[]>,
    enabled: open,
  });

  const submit = useMutation({
    mutationFn: () =>
      reqFn({
        data: {
          pack_id: mode === "pack" && packId ? packId : undefined,
          custom_points: mode === "custom" ? Number(customPoints) : undefined,
          note: note.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Top-up request sent. An admin will review it shortly.");
      qc.invalidateQueries({ queryKey: ["my-billing"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <Coins className="h-4 w-4 mr-2" /> Buy points
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Buy point pack</DialogTitle>
          <DialogDescription>
            Points fund AI features once your plan quota is spent. You have <strong>{remaining}</strong> points left.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button size="sm" variant={mode === "pack" ? "default" : "outline"} onClick={() => setMode("pack")}>Pick a pack</Button>
          <Button size="sm" variant={mode === "custom" ? "default" : "outline"} onClick={() => setMode("custom")}>Custom amount</Button>
        </div>

        {mode === "pack" ? (
          <div className="grid grid-cols-2 gap-2">
            {(packs ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPackId(p.id)}
                className={`text-left rounded-md border p-3 transition ${packId === p.id ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"}`}
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-muted-foreground">{p.points.toLocaleString()} points</div>
                <div className="mt-1 font-semibold">€{Number(p.price).toFixed(2)}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="custom-points">Points</Label>
            <Input id="custom-points" type="number" min={1} value={customPoints} onChange={(e) => setCustomPoints(e.target.value)} />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="topup-note">Note (optional)</Label>
          <Textarea id="topup-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the admin should know…" rows={2} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending || (mode === "pack" && !packId)}>
            <Send className="h-4 w-4 mr-2" /> {submit.isPending ? "Sending…" : "Request top-up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PointsBadge() {
  const remaining = usePointsRemaining();
  return (
    <Badge variant={remaining > 20 ? "secondary" : "destructive"} className="gap-1">
      <Coins className="h-3 w-3" /> {remaining}
    </Badge>
  );
}
