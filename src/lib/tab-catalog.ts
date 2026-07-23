import { LayoutDashboard, CalendarDays, Inbox, Users, Link2, Tag, Handshake, Car, FileText, Palette, Coins, Gift, MapPin, Clock } from "lucide-react";
import type { FeatureKey } from "@/lib/features";

export type TabDef = {
  id: string;
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact: boolean;
  feature: FeatureKey | null;
  /** default slot when the user has never customized */
  defaultSlot: "bottom" | "more";
};

export const TAB_CATALOG: TabDef[] = [
  { id: "home",       to: "/coordinator",                   label: "Home",         icon: LayoutDashboard, exact: true,  feature: null,             defaultSlot: "bottom" },
  { id: "dispatch",   to: "/coordinator/calendar",          label: "Dispatch",     icon: CalendarDays,    exact: false, feature: "dispatch",       defaultSlot: "bottom" },
  { id: "pending",    to: "/coordinator/pending",           label: "Pending",      icon: Inbox,           exact: false, feature: "pending",        defaultSlot: "more" },
  { id: "drivers",    to: "/coordinator/drivers",           label: "Drivers",      icon: Users,           exact: false, feature: "drivers",        defaultSlot: "more" },
  { id: "my_driving", to: "/coordinator/my-driving",        label: "My Driving",   icon: Car,             exact: false, feature: "my_driving",     defaultSlot: "more" },
  { id: "labels",     to: "/coordinator/labels",            label: "Labels",       icon: Tag,             exact: false, feature: "labels",         defaultSlot: "more" },
  { id: "availability", to: "/coordinator/availability",    label: "Availability", icon: Clock,           exact: false, feature: "availability_autoforward", defaultSlot: "more" },
  { id: "portal_links", to: "/coordinator/portal-links",    label: "Portal Links", icon: Link2,           exact: false, feature: "portal_links",   defaultSlot: "more" },
  { id: "collaborate", to: "/coordinator/collaborate",      label: "Collaborate",  icon: Handshake,       exact: false, feature: "collaborate",    defaultSlot: "more" },
  { id: "statements", to: "/coordinator/statements",        label: "Statements",   icon: FileText,        exact: false, feature: "statements",     defaultSlot: "more" },
  { id: "billing",    to: "/coordinator/billing",           label: "Billing",      icon: Coins,           exact: false, feature: null,             defaultSlot: "more" },
  { id: "refer",      to: "/coordinator/refer",             label: "Refer & earn", icon: Gift,            exact: false, feature: null,             defaultSlot: "more" },
  { id: "branding",   to: "/coordinator/branding",          label: "Branding",     icon: Palette,         exact: false, feature: "branding_advert", defaultSlot: "more" },
  { id: "address",    to: "/coordinator/address-settings",  label: "Address & Map", icon: MapPin,         exact: false, feature: null,             defaultSlot: "more" },
];

export function tabsByFeatureVisible(features?: Record<string, boolean>) {
  return TAB_CATALOG.filter((t) => {
    if (!t.feature) return true;
    return features?.[t.feature] !== false;
  });
}

export type ResolvedLayout = {
  bottom: TabDef[];         // in the bottom bar (max 3 non-plus slots + more)
  more: TabDef[];           // shown in More sheet
  defaultTabId: string;
};

const MAX_BOTTOM = 3; // 2 left + 1 right + center "+" + more = 5 total slots

export function resolveMobileLayout(
  saved: { tabs?: string[]; hidden_tabs?: string[]; default_tab?: string } | undefined,
  features?: Record<string, boolean>,
): ResolvedLayout {
  const visible = tabsByFeatureVisible(features);
  const byId = new Map(visible.map((t) => [t.id, t] as const));
  const hidden = new Set(saved?.hidden_tabs ?? []);

  // Ordered bottom list = saved.tabs (filtered), else defaults
  let bottomIds: string[];
  if (saved?.tabs && saved.tabs.length) {
    bottomIds = saved.tabs.filter((id) => byId.has(id) && !hidden.has(id));
  } else {
    bottomIds = visible.filter((t) => t.defaultSlot === "bottom" && !hidden.has(t.id)).map((t) => t.id);
  }
  bottomIds = bottomIds.slice(0, MAX_BOTTOM);
  const bottom = bottomIds.map((id) => byId.get(id)!).filter(Boolean);

  const bottomSet = new Set(bottom.map((t) => t.id));
  const more = visible.filter((t) => !bottomSet.has(t.id) && !hidden.has(t.id));

  const defaultTabId =
    saved?.default_tab && byId.has(saved.default_tab) ? saved.default_tab : "home";

  return { bottom, more, defaultTabId };
}
