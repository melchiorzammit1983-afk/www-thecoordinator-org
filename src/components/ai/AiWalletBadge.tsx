import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Sparkles, AlertTriangle } from "lucide-react";
import { getMyAiWallet } from "@/lib/ai-wallet.functions";

export function AiWalletBadge({ className = "" }: { className?: string }) {
  const fn = useServerFn(getMyAiWallet);
  const { data } = useQuery({
    queryKey: ["ai-wallet"],
    queryFn: () => fn(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  if (!data) return null;

  const low = data.low_balance || data.total_available <= 0;
  const empty = data.total_available <= 0;

  return (
    <Link
      to="/coordinator/billing"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors ${
        empty
          ? "border-destructive text-destructive"
          : low
          ? "border-amber-500/60 text-amber-600 dark:text-amber-400"
          : "border-primary/40 text-primary"
      } ${className}`}
      title="AI points wallet"
    >
      {empty || low ? <AlertTriangle className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
      <span className="tabular-nums">{data.total_available.toLocaleString()}</span>
      <span className="hidden sm:inline text-muted-foreground">AI pts</span>
    </Link>
  );
}
