import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Pencil } from "lucide-react";
import { coordinatorOverrideJobStatus } from "@/lib/coordinator.functions";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "en_route", label: "On the way" },
  { value: "arrived", label: "Arrived at pickup" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

type OverrideStatus = typeof STATUS_OPTIONS[number]["value"];

export function CoordinatorStatusOverride({
  jobId,
  currentStatus,
}: {
  jobId: string;
  currentStatus: string;
}) {
  const [open, setOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<OverrideStatus>(
    (STATUS_OPTIONS.find((s) => s.value === currentStatus)?.value ?? "pending") as OverrideStatus,
  );
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const overrideFn = useServerFn(coordinatorOverrideJobStatus);

  const mut = useMutation({
    mutationFn: () =>
      overrideFn({
        data: { job_id: jobId, status: nextStatus, reason: reason.trim() || undefined },
      }) as Promise<{ ok: true; from?: string; to?: string; unchanged?: boolean }>,
    onSuccess: (r) => {
      if (r.unchanged) {
        toast.info("Status unchanged");
      } else {
        toast.success(`Status set to ${nextStatus.replace(/_/g, " ")}`);
      }
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["calendar-jobs"] });
      qc.invalidateQueries({ queryKey: ["trip-details", jobId] });
      qc.invalidateQueries({ queryKey: ["trip-map-events", jobId] });
      qc.invalidateQueries({ queryKey: ["trip-audit", jobId] });
      setOpen(false);
      setReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1">
          <Pencil className="h-3 w-3" />
          Override
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Override trip status</DialogTitle>
          <DialogDescription>
            Fix the trip status after the fact. This is logged on the trip map as a
            coordinator override — it will not affect the driver's trust score.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              New status
            </div>
            <Select value={nextStatus} onValueChange={(v) => setNextStatus(v as OverrideStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                    {s.value === currentStatus ? " (current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Reason (optional)
            </div>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Driver forgot to press Completed"
              rows={3}
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || nextStatus === currentStatus}>
            {mut.isPending ? "Saving…" : "Apply override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
