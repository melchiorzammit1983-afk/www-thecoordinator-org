import { FACTS, type FactKey } from "@/lib/docs-facts";

export function Fact({ name, className }: { name: FactKey; className?: string }) {
  const fact = FACTS[name];
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
