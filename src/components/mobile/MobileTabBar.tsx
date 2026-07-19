import { useEffect, useMemo, useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  MoreHorizontal,
  KeyRound,
  LogOut,
  Plus,
  Settings as SettingsIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useFeatures } from "@/hooks/use-features";
import { usePreferences } from "@/hooks/use-preferences";
import { cn } from "@/lib/utils";
import { JobFormDialog } from "@/components/coordinator/JobFormDialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDrivers } from "@/lib/coordinator.functions";
import { resolveMobileLayout, type TabDef } from "@/lib/tab-catalog";

export function MobileTabBar({ onOpenChangePassword }: { onOpenChangePassword: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { data: features } = useFeatures();
  const { prefs } = usePreferences();
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const driversFn = useServerFn(listDrivers);
  const { data: drivers } = useQuery({ queryKey: ["drivers"], queryFn: () => driversFn() });
  const qc = useQueryClient();

  const { bottom, more, defaultTabId } = useMemo(
    () => resolveMobileLayout(prefs.home_layout as any, features),
    [prefs.home_layout, features],
  );

  // First-launch: navigate to the user's chosen default tab (once per session)
  useEffect(() => {
    if (pathname !== "/coordinator") return;
    const target = bottom.concat(more).find((t) => t.id === defaultTabId);
    if (!target || target.to === "/coordinator") return;
    const flag = "__coord_launched_default";
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(flag)) return;
    sessionStorage.setItem(flag, "1");
    navigate({ to: target.to, replace: true });
  }, [pathname, bottom, more, defaultTabId, navigate]);

  const isActive = (item: TabDef) => (item.exact ? pathname === item.to : pathname.startsWith(item.to));
  const isMoreActive = more.some((i) => isActive(i));

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  // Split bottom row: left slots + center "+" + right slots
  // With max 3 pinned, we place first 2 on the left, remainder on the right.
  const left = bottom.slice(0, 2);
  const right = bottom.slice(2, 3);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t bg-background/95 backdrop-blur pb-safe md:hidden"
        aria-label="Primary"
      >
        {left.map((item) => (
          <TabButton key={item.id} item={item} active={isActive(item)} />
        ))}
        {/* Fill left slot when only 1 pinned so + stays centered */}
        {left.length < 2 && <span className="flex-1" aria-hidden />}

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
          <TabButton key={item.id} item={item} active={isActive(item)} />
        ))}
        {right.length < 1 && <span className="flex-1" aria-hidden />}

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
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-safe">
          <div className="mx-auto -mt-2 mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          <SheetHeader className="text-left">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {more.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.id}
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

          <div className="mt-5 border-t pt-3 space-y-1">
            <Link
              to="/settings"
              onClick={() => setMoreOpen(false)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium hover:bg-muted"
            >
              <SettingsIcon className="h-4 w-4" />
              Settings
            </Link>
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

function TabButton({ item, active }: { item: TabDef; active: boolean }) {
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

