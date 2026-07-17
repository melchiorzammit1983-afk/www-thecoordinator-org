import { TRIP_EVENT_CATALOG } from "@/lib/docs-facts";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  movement: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  waiting: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  boarding: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  incident: "bg-red-500/10 text-red-700 dark:text-red-300",
  override: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  system: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

export function EventCatalogTable() {
  return (
    <div className="my-6 overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium text-right">Payout</th>
            <th className="px-3 py-2 font-medium text-right">Trust</th>
            <th className="px-3 py-2 font-medium">What it means</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {TRIP_EVENT_CATALOG.map((e) => (
            <tr key={e.type} className="hover:bg-muted/30">
              <td className="px-3 py-2 align-top">
                <div className="font-medium text-foreground">{e.label}</div>
                <code className="text-[10px] text-muted-foreground">{e.type}</code>
              </td>
              <td className="px-3 py-2 align-top">
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", CATEGORY_COLORS[e.category])}>
                  {e.category}
                </span>
              </td>
              <td className="px-3 py-2 align-top text-right font-mono tabular-nums">
                {e.payoutDeltaEur === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="text-foreground">+€{e.payoutDeltaEur}</span>
                )}
              </td>
              <td className="px-3 py-2 align-top text-right font-mono tabular-nums">
                {e.trustDelta === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className={e.trustDelta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {e.trustDelta > 0 ? "+" : ""}{e.trustDelta}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 align-top text-muted-foreground">{e.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
