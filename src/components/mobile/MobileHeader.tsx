import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScrollDirection } from "@/hooks/use-scroll-direction";
import { BrandLogo } from "@/components/branding/BrandLogo";
import { PointsBadge, RequestTopupDialog } from "@/components/billing/RequestTopupDialog";
import { AiWalletBadge } from "@/components/ai/AiWalletBadge";
import { cn } from "@/lib/utils";

type Props = {
  logoUrl: string | null;
  name: string;
  onChangePassword: () => void;
};

/**
 * Compact top bar for the mobile coordinator layout. Hides on scroll-down
 * (transform, not display, so nothing reflows) and reveals on scroll-up.
 * Sign-out lives in the More drawer now — this bar only carries brand
 * identity, points balance, and change-password shortcut.
 */
export function MobileHeader({ logoUrl, name, onChangePassword }: Props) {
  const dir = useScrollDirection();
  const hidden = dir === "down";

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-13 items-center gap-3 border-b bg-background/90 px-3 backdrop-blur transition-transform duration-200 pt-safe md:hidden",
        hidden ? "-translate-y-full" : "translate-y-0",
      )}
      style={{ height: "52px" }}
    >
      <BrandLogo logoUrl={logoUrl} name={name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
      </div>
      <AiWalletBadge />
      <RequestTopupDialog
        trigger={
          <button type="button" className="inline-flex shrink-0">
            <PointsBadge />
          </button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={onChangePassword}
        className="h-9 w-9 shrink-0"
        aria-label="Change password"
      >
        <KeyRound className="h-4 w-4" />
      </Button>
    </header>
  );
}
