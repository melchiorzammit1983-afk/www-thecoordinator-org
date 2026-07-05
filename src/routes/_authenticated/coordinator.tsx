import { createFileRoute, Outlet, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { LayoutDashboard, CalendarDays, Inbox, Users, Link2, LogOut, Tag, Handshake, Car, FileText, Palette, Coins, Bot, KeyRound, Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useMyCompany } from "@/hooks/use-coordinator";
import { useFeatures } from "@/hooks/use-features";
import { whoAmI } from "@/lib/admin.functions";
import { ChangePasswordDialog } from "@/components/coordinator/ChangePasswordDialog";
import { BrandLogo } from "@/components/branding/BrandLogo";
import { PointsBadge, RequestTopupDialog } from "@/components/billing/RequestTopupDialog";


export const Route = createFileRoute("/_authenticated/coordinator")({
  component: CoordinatorLayout,
});

import { AI_FEATURE_KEYS, type FeatureKey } from "@/lib/features";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact: boolean;
  feature: FeatureKey | null;
};

const NAV: NavItem[] = [
  { to: "/coordinator", label: "Dashboard", icon: LayoutDashboard, exact: true, feature: null },
  { to: "/coordinator/calendar", label: "Dispatch", icon: CalendarDays, exact: false, feature: "dispatch" },
  { to: "/coordinator/pending", label: "Pending", icon: Inbox, exact: false, feature: "pending" },
  { to: "/coordinator/drivers", label: "Drivers", icon: Users, exact: false, feature: "drivers" },
  { to: "/coordinator/portal-links", label: "Portal Links", icon: Link2, exact: false, feature: "portal_links" },
  { to: "/coordinator/labels", label: "Labels", icon: Tag, exact: false, feature: "labels" },
  { to: "/coordinator/statements", label: "Statements", icon: FileText, exact: false, feature: "statements" },
  { to: "/coordinator/collaborate", label: "Collaborate", icon: Handshake, exact: false, feature: "collaborate" },
  { to: "/coordinator/my-driving", label: "My Driving", icon: Car, exact: false, feature: "my_driving" },
  { to: "/coordinator/branding", label: "Branding", icon: Palette, exact: false, feature: "branding_advert" },
  { to: "/coordinator/ai-center", label: "AI Center", icon: Bot, exact: false, feature: null },
  { to: "/coordinator/billing", label: "Billing", icon: Coins, exact: false, feature: null },
  { to: "/coordinator/refer", label: "Refer & earn", icon: Gift, exact: false, feature: null },
];



function CoordinatorLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: company, isLoading, error } = useMyCompany();
  const whoAmIFn = useServerFn(whoAmI);
  const { data: features } = useFeatures();
  const { data: identity, isLoading: identityLoading } = useQuery({
    queryKey: ["whoami"],
    queryFn: () => whoAmIFn(),
    retry: false,
  });

  const [mustChangePw, setMustChangePw] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const meta = (data.user?.user_metadata ?? {}) as { must_change_password?: boolean };
      setMustChangePw(!!meta.must_change_password);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isLoading && !company && identity?.isAdmin) {
      navigate({ to: "/admin", replace: true });
    }
  }, [company, identity?.isAdmin, isLoading, navigate]);

  // If admin turned off the feature that owns the route the user is looking at,
  // bounce them back to the dashboard so disabled surfaces stay unreachable.
  useEffect(() => {
    if (!features) return;
    const match = NAV.find((n) => n.feature && (n.exact ? pathname === n.to : pathname.startsWith(n.to)));
    if (match && match.feature && features[match.feature] === false) {
      navigate({ to: "/coordinator", replace: true });
    }
    if (pathname.startsWith("/coordinator/ai-center") && !AI_FEATURE_KEYS.some((k) => features[k] !== false)) {
      navigate({ to: "/coordinator", replace: true });
    }
  }, [features, pathname, navigate]);

  const anyAiEnabled = !features || AI_FEATURE_KEYS.some((k) => features[k] !== false);
  const visibleNav = NAV.filter((item) => {
    if (item.to === "/coordinator/ai-center") return anyAiEnabled;
    if (!item.feature) return true;
    return features?.[item.feature] !== false;
  });

  if (isLoading || (!company && identityLoading)) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  }
  if (!company && identity?.isAdmin) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Opening admin…</div>;
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
          <BrandLogo logoUrl={(company as any).logo_url ?? null} name={company.name} />
          <div className="hidden md:block min-w-0 flex-1">
            <div className="font-semibold text-sm truncate">{company.name}</div>
            <div className="text-xs text-muted-foreground">Coordinator</div>
          </div>
          <div className="md:hidden ml-auto">
            <RequestTopupDialog trigger={<button type="button" className="inline-flex"><PointsBadge /></button>} />
          </div>
          <div className="md:hidden">
            <Button variant="ghost" size="icon" onClick={() => setShowChangePw(true)} className="h-8 w-8" aria-label="Change password">
              <KeyRound className="h-4 w-4" />
            </Button>
          </div>
          <div className="md:hidden">
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 h-8 px-2">
              <LogOut className="h-4 w-4" />
              <span className="text-xs">Sign out</span>
            </Button>
          </div>
          <div className="hidden md:block">
            <RequestTopupDialog trigger={<button type="button" className="inline-flex"><PointsBadge /></button>} />
          </div>
        </div>
        <nav className="flex md:flex-col md:p-3 overflow-x-auto md:overflow-visible">
          {visibleNav.map((item) => {
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
        <div className="hidden md:block mt-auto p-3 border-t space-y-1">
          <Button variant="ghost" className="w-full justify-start gap-3" onClick={() => setShowChangePw(true)}>
            <KeyRound className="h-4 w-4" /> Change password
          </Button>
          <Button variant="ghost" className="w-full justify-start gap-3" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
      {mustChangePw && <ChangePasswordDialog onDone={() => setMustChangePw(false)} />}
      {showChangePw && !mustChangePw && (
        <ChangePasswordDialog mode="voluntary" onDone={() => setShowChangePw(false)} onCancel={() => setShowChangePw(false)} />
      )}
    </div>

  );
}
