import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { requestTopUp } from "@/lib/coordinator.functions";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function TopUpModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [points, setPoints] = useState("500");
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const fn = useServerFn(requestTopUp);
  const mut = useMutation({
    mutationFn: () => fn({ data: { points_requested: Number(points), note: note || undefined } }),
    onSuccess: () => {
      toast.success("Top-up request sent to admin");
      onOpenChange(false); setPoints("500"); setNote("");
      qc.invalidateQueries({ queryKey: ["topup-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a top-up</DialogTitle>
          <DialogDescription>
            Your admin will approve and add points to your balance.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
          <div className="space-y-2">
            <Label htmlFor="tu-points">Points requested</Label>
            <Input id="tu-points" type="number" min={1} step={1} value={points} onChange={(e) => setPoints(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tu-note">Note (optional)</Label>
            <Input id="tu-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mut.isPending || !points}>{mut.isPending ? "Sending…" : "Send request"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
