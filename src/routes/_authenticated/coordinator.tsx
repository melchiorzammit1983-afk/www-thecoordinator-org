import { createFileRoute, Outlet, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, CalendarDays, Inbox, Users, Link2, LogOut, Tag, Handshake, Car, FileText, Palette, Coins, Bot, KeyRound, Gift, AlertTriangle, MapPin, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useMyCompany } from "@/hooks/use-coordinator";
import { useFeatures } from "@/hooks/use-features";
import { whoAmI } from "@/lib/admin.functions";
import { ChangePasswordDialog } from "@/components/coordinator/ChangePasswordDialog";
import { BrandLogo } from "@/components/branding/BrandLogo";
import { PointsBadge, RequestTopupDialog } from "@/components/billing/RequestTopupDialog";

import { MobileTabBar } from "@/components/mobile/MobileTabBar";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { CoordinatorAssistant } from "@/components/coordinator/CoordinatorAssistant";


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

type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { to: "/coordinator", label: "Dashboard", icon: LayoutDashboard, exact: true, feature: null },
      { to: "/coordinator/calendar", label: "Dispatch", icon: CalendarDays, exact: false, feature: "dispatch" },
      { to: "/coordinator/pending", label: "Pending", icon: Inbox, exact: false, feature: "pending" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/coordinator/drivers", label: "Drivers", icon: Users, exact: false, feature: "drivers" },
      { to: "/coordinator/my-driving", label: "My Driving", icon: Car, exact: false, feature: "my_driving" },
      { to: "/coordinator/labels", label: "Labels", icon: Tag, exact: false, feature: "labels" },
      { to: "/coordinator/availability", label: "Availability", icon: Clock, exact: false, feature: "availability_autoforward" },
      { to: "/coordinator/ai-center", label: "AI Center", icon: Bot, exact: false, feature: null },
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

const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);



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

  // Distinguish two cases:
  //  - User navigates/deep-links to a disabled route → redirect with toast.
  //  - User was on the route when admin flipped it off → show a banner but keep the page.
  const lastPathnameRef = useRef<string | null>(null);
  const [disabledBanner, setDisabledBanner] = useState<string | null>(null);
  useEffect(() => {
    if (!features) return;
    const match = NAV.find((n) => n.feature && (n.exact ? pathname === n.to : pathname.startsWith(n.to)));
    const aiRoute = pathname.startsWith("/coordinator/ai-center");
    const aiAllOff = aiRoute && !AI_FEATURE_KEYS.some((k) => features[k] !== false);
    const featureOff = !!(match && match.feature && features[match.feature] === false);

    const pathChanged = lastPathnameRef.current !== pathname;
    lastPathnameRef.current = pathname;

    if (featureOff || aiAllOff) {
      if (pathChanged) {
        toast.error(`${match?.label ?? "This feature"} is currently disabled by your administrator.`);
        navigate({ to: "/coordinator", replace: true });
        setDisabledBanner(null);
      } else {
        setDisabledBanner(match?.label ?? "This feature");
      }
    } else {
      setDisabledBanner(null);
    }
  }, [features, pathname, navigate]);

  const anyAiEnabled = !features || AI_FEATURE_KEYS.some((k) => features[k] !== false);

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
      {/* Mobile-only auto-hiding top bar + bottom tab bar. */}
      <MobileHeader
        logoUrl={(company as any).logo_url ?? null}
        name={company.name}
        onChangePassword={() => setShowChangePw(true)}
      />

      {/* Desktop-only sidebar. Hidden on mobile — replaced by MobileTabBar. */}
      <aside className="hidden md:flex md:w-64 md:min-h-screen md:border-r bg-background md:flex-col">
        <div className="px-4 py-6 border-b flex items-center gap-3">
          <BrandLogo logoUrl={(company as any).logo_url ?? null} name={company.name} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm truncate">{company.name}</div>
            <div className="text-xs text-muted-foreground">Coordinator</div>
          </div>
          
          <RequestTopupDialog trigger={<button type="button" className="inline-flex"><PointsBadge /></button>} />
        </div>

        <nav className="flex flex-col p-3 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => {
              if (item.to === "/coordinator/ai-center") return anyAiEnabled;
              if (!item.feature) return true;
              return features?.[item.feature] !== false;
            });
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="mb-3">
                <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {items.map((item) => {
                  const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
                  return (
                    <Link
                      key={item.to} to={item.to}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 my-0.5 text-sm rounded-md whitespace-nowrap transition-colors",
                        active ? "bg-primary/10 text-primary font-medium"
                               : "text-foreground/70 hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="mt-auto p-3 border-t space-y-1">
          <Button variant="ghost" className="w-full justify-start gap-3" onClick={() => setShowChangePw(true)}>
            <KeyRound className="h-4 w-4" /> Change password
          </Button>
          <Button variant="ghost" className="w-full justify-start gap-3" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 pb-tabbar md:pb-0">
        {disabledBanner && (
          <div className="flex items-start gap-2 border-b bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <strong>{disabledBanner}</strong> was just disabled by your administrator. This page will be unavailable next time you navigate away.
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => navigate({ to: "/coordinator" })}>
              Go to dashboard
            </Button>
          </div>
        )}
        <CoordinatorAssistant>
          <Outlet />
        </CoordinatorAssistant>
      </main>

      <MobileTabBar onOpenChangePassword={() => setShowChangePw(true)} />

      {mustChangePw && <ChangePasswordDialog onDone={() => setMustChangePw(false)} />}
      {showChangePw && !mustChangePw && (
        <ChangePasswordDialog mode="voluntary" onDone={() => setShowChangePw(false)} onCancel={() => setShowChangePw(false)} />
      )}
    </div>

  );
}
