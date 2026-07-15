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
  Plus,
  MapPin,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useFeatures } from "@/hooks/use-features";
import { AI_FEATURE_KEYS, type FeatureKey } from "@/lib/features";
import { cn } from "@/lib/utils";
import { JobFormDialog } from "@/components/coordinator/JobFormDialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDrivers } from "@/lib/coordinator.functions";

type TabItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact: boolean;
  feature: FeatureKey | null;
  aiGroup?: boolean;
};

// Only the two most-used destinations flank the center "+ New" button.
// Everything else lives in the More sheet — grouped for scan-ability.
const LEFT: TabItem[] = [
  { to: "/coordinator", label: "Home", icon: LayoutDashboard, exact: true, feature: null },
  { to: "/coordinator/calendar", label: "Dispatch", icon: CalendarDays, exact: false, feature: "dispatch" },
];

const RIGHT: TabItem[] = [
  { to: "/coordinator/ai-center", label: "AI", icon: Bot, exact: false, feature: null, aiGroup: true },
];

type Group = { label: string; items: TabItem[] };

const MORE_GROUPS: Group[] = [
  {
    label: "Operations",
    items: [
      { to: "/coordinator/pending", label: "Pending", icon: Inbox, exact: false, feature: "pending" },
      { to: "/coordinator/drivers", label: "Drivers", icon: Users, exact: false, feature: "drivers" },
      { to: "/coordinator/my-driving", label: "My Driving", icon: Car, exact: false, feature: "my_driving" },
      { to: "/coordinator/labels", label: "Labels", icon: Tag, exact: false, feature: "labels" },
    ],
  },
  {
    label: "Clients & Partners",
    items: [
      { to: "/coordinator/portal-links", label: "Portal Links", icon: Link2, exact: false, feature: "portal_links" },
      { to: "/coordinator/collaborate", label: "Collaborate", icon: Handshake, exact: false, feature: "collaborate" },
      { to: "/coordinator/statements", label: "Statements", icon: FileText, exact: false, feature: "statements" },
    ],
  },
  {
    label: "Business",
    items: [
      { to: "/coordinator/billing", label: "Billing", icon: Coins, exact: false, feature: null },
      { to: "/coordinator/refer", label: "Refer & earn", icon: Gift, exact: false, feature: null },
      { to: "/coordinator/branding", label: "Branding", icon: Palette, exact: false, feature: "branding_advert" },
      { to: "/coordinator/address-settings", label: "Address & Map", icon: MapPin, exact: false, feature: null },
    ],
  },
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
  const [addOpen, setAddOpen] = useState(false);
  const driversFn = useServerFn(listDrivers);
  const { data: drivers } = useQuery({ queryKey: ["drivers"], queryFn: () => driversFn() });
  const qc = useQueryClient();

  const { left, right, groups } = useMemo(() => {
    const left = LEFT.filter((i) => isItemVisible(i, features));
    const right = RIGHT.filter((i) => isItemVisible(i, features));
    const groups = MORE_GROUPS
      .map((g) => ({ ...g, items: g.items.filter((i) => isItemVisible(i, features)) }))
      .filter((g) => g.items.length > 0);
    return { left, right, groups };
  }, [features]);

  const isActive = (item: TabItem) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to);
  const isMoreActive = groups.some((g) => g.items.some((i) => isActive(i)));

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t bg-background/95 backdrop-blur pb-safe md:hidden"
        aria-label="Primary"
      >
        {left.map((item) => (
          <TabButton key={item.to} item={item} active={isActive(item)} />
        ))}

        {/* Center primary action — visually raised */}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            aria-label="New trip"
            className="-mt-6 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95 transition"
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>

        {right.map((item) => (
          <TabButton key={item.to} item={item} active={isActive(item)} />
        ))}

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

          <div className="mt-4 space-y-5">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {g.items.map((item) => {
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
              </div>
            ))}
          </div>

          <div className="mt-5 border-t pt-3 space-y-1">
            <button
              type="button"
              onClick={() => { setMoreOpen(false); onOpenChangePassword(); }}
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

      <JobFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        drivers={(drivers ?? []) as any}
        onSaved={() => {
          setAddOpen(false);
          qc.invalidateQueries({ queryKey: ["coord-dash-activity"] });
          qc.invalidateQueries({ queryKey: ["coord-summary"] });
          qc.invalidateQueries({ queryKey: ["jobs"] });
        }}
      />
    </>
  );
}

function TabButton({ item, active }: { item: TabItem; active: boolean }) {
  return (
    <Link
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
}
