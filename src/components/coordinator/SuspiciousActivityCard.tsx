import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";
import { listSuspiciousActivity } from "@/lib/audit.functions";
import { Badge } from "@/components/ui/badge";

const SIGNAL_LABEL: Record<string, string> = {
  excessive_overrides: "Excessive overrides",
  excessive_no_shows: "Excessive no-shows",
  excessive_wait_edits: "Excessive wait-charge edits",
  gps_validation_failures: "GPS validation failures",
  rejected_actions: "Rejected actions",
};

export function SuspiciousActivityCard() {
  const fn = useServerFn(listSuspiciousActivity);
  const { data } = useQuery({
    queryKey: ["suspicious-activity"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });
  const rows = data?.rows ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          Suspicious activity ({rows.length})
        </h2>
      </div>
      <ul className="mt-2 space-y-1">
        {rows.slice(0, 5).map((r: any, i: number) => (
          <li key={i} className="flex items-center justify-between text-xs">
            <span>{SIGNAL_LABEL[r.signal] ?? r.signal}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {r.count} · {r.window}
              </Badge>
              <span className="text-[10px] text-muted-foreground font-mono">
                {(r.driver_id ?? "").slice(0, 8) || "—"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
