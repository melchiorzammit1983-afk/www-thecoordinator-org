import { forwardRef, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFeatureCost, useMyCompany } from "@/hooks/use-coordinator";
import { TopUpModal } from "./TopUpModal";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = ButtonProps & {
  feature: string;
  label?: string;
  showCost?: boolean;
};

export const PremiumButton = forwardRef<HTMLButtonElement, Props>(function PremiumButton(
  { feature, label, showCost = true, children, className, onClick, ...rest }, ref,
) {
  const cost = useFeatureCost(feature);
  const { data: company } = useMyCompany();
  const [topUpOpen, setTopUpOpen] = useState(false);

  const balance = company?.points_balance ?? 0;
  const free = cost === 0 || cost === undefined;
  const affordable = free || balance >= (cost ?? 0);

  if (affordable) {
    return (
      <>
        <Button ref={ref} onClick={onClick} className={className} {...rest}>
          {children ?? label}
          {showCost && !free && cost ? (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] rounded bg-primary-foreground/20 px-1.5 py-0.5">
              <Coins className="h-3 w-3" /> {cost}
            </span>
          ) : null}
        </Button>
      </>
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={ref}
              type="button"
              className={cn(className, "opacity-60")}
              onClick={(e) => { e.preventDefault(); setTopUpOpen(true); }}
              {...rest}
            >
              {children ?? label}
              {cost ? (
                <span className="ml-2 inline-flex items-center gap-1 text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                  <Coins className="h-3 w-3" /> {cost}
                </span>
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Top-Up Required — need {cost} points, have {balance}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TopUpModal open={topUpOpen} onOpenChange={setTopUpOpen} />
    </>
  );
});
