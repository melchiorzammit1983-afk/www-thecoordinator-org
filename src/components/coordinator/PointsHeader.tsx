import { Coins, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMyCompany } from "@/hooks/use-coordinator";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { TopUpModal } from "./TopUpModal";

export function PointsHeader() {
  const { data: company, isLoading } = useMyCompany();
  const [open, setOpen] = useState(false);

  const balance = company?.points_balance ?? 0;
  const tone =
    balance === 0 ? "text-destructive" : balance <= 50 ? "text-amber-500" : "text-emerald-500";

  return (
    <div className="border-b bg-card">
      <div className="flex items-center justify-between gap-4 px-4 md:px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-primary/10 grid place-items-center">
            <Coins className={cn("h-4 w-4", tone)} />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Points balance</div>
            <div className={cn("text-xl font-semibold tabular-nums", tone)}>
              {isLoading ? "…" : balance.toLocaleString()}
            </div>
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} className="shrink-0">
          <TrendingUp className="h-4 w-4 mr-2" /> Top Up
        </Button>
      </div>
      <TopUpModal open={open} onOpenChange={setOpen} />
    </div>
  );
}
