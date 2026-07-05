import { useMemo, useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Coins,
  MoreHorizontal,
  Inbox,
  Link2,
  Tag,
  FileText,
  Handshake,
  Car,
  Palette,
  Bot,
  Gift,
  KeyRound,
  LogOut,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useFeatures } from "@/hooks/use-features";
import { AI_FEATURE_KEYS, type FeatureKey } from "@/lib/features";
import { cn } from "@/lib/utils";

type TabItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact: boolean;
  feature: FeatureKey | null;
  aiGroup?: boolean;
};

// Pinned bottom tabs (user picked these).
const PINNED: TabItem[] = [
  { to: "/coordinator", label: "Home", icon: LayoutDashboard, exact: true, feature: null },
  { to: "/coordinator/calendar", label: "Dispatch", icon: CalendarDays, exact: false, feature: "dispatch" },
  { to: "/coordinator/drivers", label: "Drivers", icon: Users, exact: false, feature: "drivers" },
  { to: "/coordinator/billing", label: "Billing", icon: Coins, exact: false, feature: null },
];

// Everything else lives in More.
const MORE: TabItem[] = [
  { to: "/coordinator/pending", label: "Pending", icon: Inbox, exact: false, feature: "pending" },
  { to: "/coordinator/portal-links", label: "Portal Links", icon: Link2, exact: false, feature: "portal_links" },
  { to: "/coordinator/labels", label: "Labels", icon: Tag, exact: false, feature: "labels" },
  { to: "/coordinator/statements", label: "Statements", icon: FileText, exact: false, feature: "statements" },
  { to: "/coordinator/collaborate", label: "Collaborate", icon: Handshake, exact: false, feature: "collaborate" },
  { to: "/coordinator/my-driving", label: "My Driving", icon: Car, exact: false, feature: "my_driving" },
  { to: "/coordinator/branding", label: "Branding", icon: Palette, exact: false, feature: "branding_advert" },
  { to: "/coordinator/ai-center", label: "AI Center", icon: Bot, exact: false, feature: null, aiGroup: true },
  { to: "/coordinator/refer", label: "Refer & earn", icon: Gift, exact: false, feature: null },
];

function isItemVisible(item: TabItem, features?: Record<string, boolean>): boolean {
  if (item.aiGroup) return !features || AI_FEATURE_KEYS.some((k) => features[k] !== false);
  if (!item.feature) return true;
  return features?.[item.feature] !== false;
}

export function MobileTabBar({ onOpenChangePassword }: { onOpenChangePassword: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { data: features } = useFeatures();
  const [moreOpen, setMoreOpen] = useState(false);

  // Feature-gated items: any pinned tab that's disabled falls into More
  // so we never leave an empty slot in the bar.
  const { tabs, more } = useMemo(() => {
    const visiblePinned = PINNED.filter((i) => isItemVisible(i, features));
    const overflow = PINNED.filter((i) => !isItemVisible(i, features));
    const visibleMore = [...overflow, ...MORE.filter((i) => isItemVisible(i, features))];
    return { tabs: visiblePinned.slice(0, 4), more: visibleMore };
  }, [features]);

  const isActive = (item: TabItem) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to);
  const isMoreActive = more.some((i) => isActive(i));

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t bg-background/95 backdrop-blur pb-safe md:hidden"
        aria-label="Primary"
      >
        {tabs.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className={cn("h-5 w-5", active && "scale-110")} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
            isMoreActive || moreOpen ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
          aria-label="More"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-safe"
        >
          <div className="mx-auto -mt-2 mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          <SheetHeader className="text-left">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {more.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground hover:bg-muted",
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="leading-tight">{item.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="mt-4 border-t pt-3 space-y-1">
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                onOpenChangePassword();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium hover:bg-muted"
            >
              <KeyRound className="h-4 w-4" />
              Change password
            </button>
            <button
              type="button"
              onClick={signOut}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
