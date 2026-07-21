import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";

export type PastTrip = {
  id: string;
  when: string | null;        // ISO
  from: string | null;
  to: string | null;
  status: string;
  driver_name?: string | null;
  vehicle?: string | null;
  plate?: string | null;
};

export function PastTripsCard({ trips, title = "Past trips" }: { trips: PastTrip[]; title?: string }) {
  if (!trips || trips.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {trips.map((t) => {
          const when = t.when ? new Date(t.when).toLocaleString([], {
            month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
          }) : "—";
          return (
            <div key={t.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium truncate">{when}</div>
                <Badge variant="outline" className="text-[10px] capitalize">{t.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1 truncate">
                {t.from || "—"} → {t.to || "—"}
              </div>
              {(t.driver_name || t.vehicle || t.plate) && (
                <div className="text-xs mt-1">
                  <span className="text-muted-foreground">Driver: </span>
                  {t.driver_name ?? "—"}
                  {t.vehicle ? <span className="text-muted-foreground"> · {t.vehicle}</span> : null}
                  {t.plate ? <span className="text-muted-foreground"> · {t.plate}</span> : null}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
