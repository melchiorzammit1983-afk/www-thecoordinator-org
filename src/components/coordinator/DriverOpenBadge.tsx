import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDriverOpenStatus } from "@/lib/driver-settings.functions";
import { Badge } from "@/components/ui/badge";
import { Circle } from "lucide-react";

/**
 * Live open/closed pill for a driver, based on their weekly schedule + today's
 * exceptions. Shows the reopen time when currently closed but reopening soon.
 * Silently renders nothing when the driver has no schedule at all.
 */
export function DriverOpenBadge({ driverId }: { driverId: string }) {
  const fn = useServerFn(getDriverOpenStatus);
  const { data } = useQuery({
    queryKey: ["driver-open", driverId],
    queryFn: () => fn({ data: { driver_id: driverId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  if (!data || data.state === "unknown") return null;
  const color = data.state === "open" ? "text-emerald-600" : "text-muted-foreground";
  const label = data.state === "open"
    ? (data.note || "Open")
    : data.reopen_at ? `Closed · reopens ${data.reopen_at}` : "Closed";
  return (
    <Badge variant="outline" className="text-[10px] gap-1">
      <Circle className={`h-2 w-2 fill-current ${color}`} />
      {label}
    </Badge>
  );
}
