import { createFileRoute, Outlet, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, LogOut, Inbox, Activity, KeyRound, Sparkles, CreditCard } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { whoAmI, countNewAccessRequests } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

const AI_PREFIXES = ["/admin/ai-insights", "/admin/ai-settings", "/admin/ai-activity", "/admin/ai-lessons", "/admin/ai-costs", "/admin/ai-overage"];
const BILLING_PREFIXES = ["/admin/topups", "/admin/revenue", "/admin/pricing"];

const NAV = [
  { to: "/admin", label: "Companies", icon: Building2, match: (p: string) => p === "/admin" },
  { to: "/admin/requests", label: "Requests", icon: Inbox, match: (p: string) => p.startsWith("/admin/requests") },
  { to: "/admin/ai-insights", label: "AI", icon: Sparkles, match: (p: string) => AI_PREFIXES.some((x) => p.startsWith(x)) },
  { to: "/admin/topups", label: "Billing", icon: CreditCard, match: (p: string) => BILLING_PREFIXES.some((x) => p.startsWith(x)) },
  { to: "/admin/password-resets", label: "Password Resets", icon: KeyRound, match: (p: string) => p.startsWith("/admin/password-resets") },
  { to: "/admin/activity", label: "Activity log", icon: Activity, match: (p: string) => p === "/admin/activity" || p.startsWith("/admin/activity/") },
] as const;

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const whoAmIFn = useServerFn(whoAmI);
  const countFn = useServerFn(countNewAccessRequests);
  const { data, isLoading, error } = useQuery({
    queryKey: ["whoami"],
    queryFn: () => whoAmIFn(),
    retry: false,
  });
  const { data: newCount } = useQuery({
    queryKey: ["access-requests-count"],
    queryFn: () => countFn(),
    enabled: !!data?.isAdmin,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  }
  if (error || !data?.isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Not authorized</h1>
          <p className="text-sm text-muted-foreground mt-2">
            This account does not have admin access.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-muted/30">
      <aside className="md:w-64 md:min-h-screen md:border-r bg-background flex md:flex-col">
        <div className="px-4 py-4 md:py-6 border-b md:border-b flex items-center gap-3 flex-1 md:flex-none">
          <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-semibold">
            CC
          </div>
          <div className="hidden md:block">
            <div className="font-semibold text-sm">Crew Change</div>
            <div className="text-xs text-muted-foreground">Admin console</div>
          </div>
          <div className="md:hidden ml-auto">
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 h-8 px-2">
              <LogOut className="h-4 w-4" />
              <span className="text-xs">Sign out</span>
            </Button>
          </div>
        </div>
        <nav className="flex md:flex-col md:p-3 overflow-x-auto md:overflow-visible">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 md:py-2 md:my-0.5 text-sm rounded-none md:rounded-md whitespace-nowrap transition-colors",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground/70 hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {item.to === "/admin/requests" && (newCount?.count ?? 0) > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                    {newCount!.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block mt-auto p-3 border-t">
          <Button variant="ghost" className="w-full justify-start gap-3" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
