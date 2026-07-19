import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { refreshJobLiveStatus } from "@/lib/coordinator.functions";
import { cn } from "@/lib/utils";

type Props = {
  jobId: string;
  hasCode: boolean;
  variant?: "button" | "icon";
  className?: string;
  onDone?: () => void;
};

/**
 * Manual "Refresh flight status" trigger. Calls refreshJobLiveStatus which
 * hits AeroDataBox (or the vessel provider), persists the result on the
 * jobs row, and toasts the outcome. Cache-fresh lookups (<5 min) are free;
 * older ones are metered as `flight_status_extra_lookup`.
 */
export function FlightRefreshButton({ jobId, hasCode, variant = "button", className, onDone }: Props) {
  const qc = useQueryClient();
  const refresh = useServerFn(refreshJobLiveStatus);
  const mut = useMutation({
    mutationFn: () => refresh({ data: { job_id: jobId } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      const f = r?.flight;
      if (f?.ok) {
        const label = f.code ? `${f.code}` : "Flight";
        const status = f.status && f.status !== "unknown" ? ` · ${f.status}` : "";
        const note = f.note ? ` — ${f.note}` : "";
        const stamp = "";
        if (f.status === "delayed" || f.status === "cancelled" || f.status === "time_mismatch") {
          toast.error(`${label}${status}${note}${stamp}`);
        } else if (f.status === "early") {
          toast.message(`${label}${status}${note}${stamp}`);
        } else {
          toast.success(`${label}${status}${note}${stamp}`);
        }
      } else if (f?.reason) {
        toast.error(`Flight lookup: ${f.reason}`);
      } else {
        toast.success("Flight status refreshed");
      }
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message || "Refresh failed"),
  });

  const disabled = mut.isPending || !hasCode;
  const title = !hasCode ? "No flight code on this trip" : "Refresh flight status now";

  if (variant === "icon") {
    return (
      <button
        type="button"
        title={title}
        aria-label="Refresh flight status"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); mut.mutate(); }}
        className={cn(
          "inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted disabled:opacity-40",
          className,
        )}
      >
        <RefreshCw className={cn("h-3 w-3", mut.isPending && "animate-spin")} />
      </button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("h-7 px-2 text-[11px]", className)}
      disabled={disabled}
      title={title}
      onClick={(e) => { e.stopPropagation(); mut.mutate(); }}
    >
      <RefreshCw className={cn("h-3 w-3 mr-1", mut.isPending && "animate-spin")} />
      {mut.isPending ? "Checking flight…" : "Refresh flight"}
    </Button>
  );
}
