import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { emergencyOverrideJobStatus } from "@/lib/coordinator-public.functions";
import {
  EMERGENCY_OVERRIDE_ACTION_DESCRIPTIONS,
  EMERGENCY_OVERRIDE_ACTION_LABELS,
  EMERGENCY_OVERRIDE_REASON_LABELS,
  EMERGENCY_OVERRIDE_TO_STATUS,
  getEmergencyOverrideActionOptions,
  type EmergencyOverrideAction,
  type EmergencyOverrideReason,
} from "@/lib/emergency-override";

type EmergencyOverrideDialogJob = {
  id: string;
  status: string | null | undefined;
};

export function EmergencyOverrideDialog({
  open,
  onOpenChange,
  token,
  job,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  job: EmergencyOverrideDialogJob | null;
}) {
  const qc = useQueryClient();
  const emergencyFn = useServerFn(emergencyOverrideJobStatus);
  const actions = useMemo(
    () => getEmergencyOverrideActionOptions(job?.status),
    [job?.status],
  );
  const [action, setAction] = useState<EmergencyOverrideAction | null>(null);
  const [reason, setReason] = useState<EmergencyOverrideReason | null>(null);
  const [reasonNote, setReasonNote] = useState("");
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (!open) {
      setAction(null);
      setReason(null);
      setReasonNote("");
      setStep(1);
      return;
    }
    setAction((current) => current && actions.includes(current) ? current : actions[0] ?? null);
    setStep(1);
  }, [actions, open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!job || !action || !reason) throw new Error("missing_override_selection");
      return emergencyFn({
        data: {
          token,
          job_id: job.id,
          action,
          reason,
          reason_note: reasonNote.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("Emergency override applied — coordinator notified");
      qc.invalidateQueries({ queryKey: ["driver-manifest", token] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      setStep(1);
    },
  });

  const selectedActionLabel = action ? EMERGENCY_OVERRIDE_ACTION_LABELS[action] : null;
  const selectedReasonLabel = reason ? EMERGENCY_OVERRIDE_REASON_LABELS[reason] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Emergency Override
          </DialogTitle>
          <DialogDescription>
            This bypasses automatic checks and creates a permanent coordinator-facing record.
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Forced status</Label>
              <RadioGroup value={action ?? ""} onValueChange={(value) => setAction(value as EmergencyOverrideAction)} className="gap-3">
                {actions.map((option) => (
                  <label
                    key={option}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm hover:bg-muted/40"
                  >
                    <RadioGroupItem value={option} className="mt-1 h-5 w-5" />
                    <div className="space-y-1">
                      <div className="font-semibold">{EMERGENCY_OVERRIDE_ACTION_LABELS[option]}</div>
                      <div className="text-xs text-muted-foreground">
                        {EMERGENCY_OVERRIDE_ACTION_DESCRIPTIONS[option]}
                      </div>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>Reason</Label>
              <RadioGroup value={reason ?? ""} onValueChange={(value) => setReason(value as EmergencyOverrideReason)} className="gap-3">
                {Object.entries(EMERGENCY_OVERRIDE_REASON_LABELS).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm hover:bg-muted/40"
                  >
                    <RadioGroupItem value={value} className="mt-1 h-5 w-5" />
                    <span className="font-medium">{label}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>Additional details (optional)</Label>
              <Textarea
                rows={4}
                maxLength={500}
                value={reasonNote}
                onChange={(event) => setReasonNote(event.target.value)}
                placeholder="Add any details the coordinator should review later."
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <div className="text-sm font-semibold text-destructive">Confirm emergency override</div>
              <div className="mt-2 text-sm">
                You are about to <span className="font-semibold">{selectedActionLabel}</span>
                {selectedReasonLabel ? <> because <span className="font-semibold">{selectedReasonLabel}</span></> : null}.
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Target status: {action ? EMERGENCY_OVERRIDE_TO_STATUS[action].replace("_", " ") : "—"}
              </div>
              {reasonNote.trim() && (
                <div className="mt-3 rounded-lg bg-background/80 p-3 text-xs text-muted-foreground">
                  {reasonNote.trim()}
                </div>
              )}
            </div>
            <Button
              className="min-h-14 w-full text-base font-bold"
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Applying override…" : "Confirm Override"}
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {step === 2 ? (
            <Button variant="outline" onClick={() => setStep(1)} disabled={mutation.isPending}>
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
          )}
          {step === 1 && (
            <Button
              variant="destructive"
              onClick={() => setStep(2)}
              disabled={!action || !reason || mutation.isPending}
            >
              Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
