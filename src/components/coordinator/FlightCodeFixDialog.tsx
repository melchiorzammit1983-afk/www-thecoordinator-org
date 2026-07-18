import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { updateJobFlightCode } from "@/lib/coordinator.functions";
import { parseFlightCode, suggestCorrections, describeFlight, looksLikeVessel } from "@/lib/flight-code";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  currentCode: string | null | undefined;
  currentSide: "from" | "to";
};

/**
 * One-tap flight-code corrector. Surfaces when a job's flight chip renders as
 * "Not tracked · check code" — parses the current value, offers common fixes,
 * and can also move a mistyped vessel name into the vessel-tracking field.
 */
export function FlightCodeFixDialog({ open, onOpenChange, jobId, currentCode, currentSide }: Props) {
  const [value, setValue] = React.useState(currentCode ?? "");
  React.useEffect(() => setValue(currentCode ?? ""), [currentCode, open]);

  const qc = useQueryClient();
  const fix = useServerFn(updateJobFlightCode);
  const mut = useMutation({
    mutationFn: (input: any) => fix({ data: input }),
    onSuccess: (r: any) => {
      if (r?.retried && r?.result?.ok) toast.success("Flight tracked — status updated");
      else if (r?.retried) toast.info("Saved. Couldn't resolve — try again in a minute");
      else toast.success("Saved");
      qc.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't save"),
  });

  const parsed = parseFlightCode(value);
  const isVessel = looksLikeVessel(value);
  const suggestions = suggestCorrections(value);

  const applyCode = (code: string) =>
    mut.mutate({
      job_id: jobId,
      [currentSide === "from" ? "from_flight" : "to_flight"]: code || null,
      move_to: "flight",
      retry: true,
    });

  const moveToVessel = () =>
    mut.mutate({
      job_id: jobId,
      [currentSide === "from" ? "from_flight" : "to_flight"]: value.trim().toUpperCase() || null,
      move_to: "vessel",
      retry: true,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fix flight code</DialogTitle>
          <DialogDescription>
            We couldn't confirm this flight. Correct the IATA code (e.g. <code>LO673</code>) or move it to the vessel field if it's a ship.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="flight-fix">Flight code</Label>
            <Input
              id="flight-fix"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              placeholder="LO673"
            />
            {parsed.ok ? (
              <p className="text-[11px] text-emerald-600">✓ {describeFlight(parsed)}</p>
            ) : value.trim() ? (
              <p className="text-[11px] text-amber-600">
                {isVessel ? "Looks like a vessel name — consider moving it." : "Doesn't look like a standard flight code."}
              </p>
            ) : null}
          </div>

          {suggestions.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">Did you mean:</div>
              <div className="flex flex-wrap gap-1">
                {suggestions.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    onClick={() => setValue(s)}
                    disabled={mut.isPending}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {isVessel && (
            <Button variant="secondary" className="w-full" onClick={moveToVessel} disabled={mut.isPending}>
              This is a vessel — move to vessel tracking
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => applyCode(value.trim().toUpperCase())}
            disabled={mut.isPending || !value.trim() || value.trim().toUpperCase() === (currentCode ?? "").toUpperCase()}
          >
            {mut.isPending ? "Saving…" : "Save & retry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
