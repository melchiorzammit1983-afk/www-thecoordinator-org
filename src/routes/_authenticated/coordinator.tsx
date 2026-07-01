import { createFileRoute, Outlet, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, CalendarDays, Inbox, Users, Link2, LogOut, Tag, Handshake, Car } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PointsHeader } from "@/components/coordinator/PointsHeader";
import { useMyCompany } from "@/hooks/use-coordinator";

export const Route = createFileRoute("/_authenticated/coordinator")({
  component: CoordinatorLayout,
});

const NAV = [
  { to: "/coordinator", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/coordinator/calendar", label: "Dispatch", icon: CalendarDays, exact: false },
  { to: "/coordinator/pending", label: "Pending", icon: Inbox, exact: false },
  { to: "/coordinator/drivers", label: "Drivers", icon: Users, exact: false },
  { to: "/coordinator/portal-links", label: "Portal Links", icon: Link2, exact: false },
  { to: "/coordinator/labels", label: "Labels", icon: Tag, exact: false },
  { to: "/coordinator/collaborate", label: "Collaborate", icon: Handshake, exact: false },
] as const;

function CoordinatorLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: company, isLoading, error } = useMyCompany();

  if (isLoading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  }
  if (error || !company) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">No company assigned</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Ask an administrator to add your email as the coordinator for a company, then sign in again.
          </p>
          <Button
            variant="outline" className="mt-4"
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}
          >Sign out</Button>
        </div>
      </div>
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-muted/30 w-full">
      <aside className="md:w-64 md:min-h-screen md:border-r bg-background flex md:flex-col">
        <div className="px-4 py-4 md:py-6 border-b flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-semibold">
            {company.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="hidden md:block min-w-0">
            <div className="font-semibold text-sm truncate">{company.name}</div>
            <div className="text-xs text-muted-foreground">Coordinator</div>
          </div>
        </div>
        <nav className="flex md:flex-col md:p-3 overflow-x-auto md:overflow-visible">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to} to={item.to}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 md:py-2 md:my-0.5 text-sm rounded-none md:rounded-md whitespace-nowrap transition-colors",
                  active ? "bg-primary/10 text-primary font-medium"
                         : "text-foreground/70 hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block mt-auto p-3 border-t">
          <Button variant="ghost" className="w-full justify-start gap-3" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <PointsHeader />
        <Outlet />
      </main>
    </div>
  );
}
