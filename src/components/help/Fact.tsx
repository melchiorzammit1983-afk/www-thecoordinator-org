import { FACTS, type FactKey } from "@/lib/docs-facts";

// Legacy / verbose aliases so docs can reference facts by any recognizable name.
const ALIASES: Record<string, FactKey> = {
  PAX_DROPOFF_BUFFER_MIN: "conflictBufferMin",
  TIGHT_THRESHOLD_MIN: "conflictTightMin",
  WAIT_PROXIMITY_M: "waitProximityMeters",
  ARRIVAL_ACCURACY_M: "waitProximityMeters",
  ETA_POLL_SECONDS: "etaPollSeconds",
  ETA_FRESHNESS_MIN: "etaLiveFreshnessMin",
  NO_SHOW_FEE: "noShowFeeEur",
  PAX_CANCEL_FEE: "paxCancelFeeEur",
  ROUTE_DEVIATION_M: "routeDeviationMeters",
  AI_RETRY_MAX: "aiExtractionRetryMax",
};

function resolve(name: string): { value: string | number; unit: string; description: string } | null {
  if (name in FACTS) return FACTS[name as FactKey];
  const alias = ALIASES[name];
  if (alias) return FACTS[alias];
  return null;
}

export function Fact({ name, className }: { name: string; className?: string }) {
  const fact = resolve(name);
  if (!fact) {
    return (
      <span className="rounded bg-muted px-1 font-mono text-[0.85em] text-muted-foreground" title={`Unknown fact: ${name}`}>
        {name}
      </span>
    );
  }
  return (
    <span
      className={
        "inline-flex items-baseline gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[0.9em] font-semibold text-primary tabular-nums " +
        (className ?? "")
      }
      title={fact.description}
    >
      <span>{fact.value}</span>
      {fact.unit && <span className="text-[0.75em] opacity-70">{fact.unit}</span>}
    </span>
  );
}
