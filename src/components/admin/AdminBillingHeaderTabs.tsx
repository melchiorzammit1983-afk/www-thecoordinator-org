import { Link } from "@tanstack/react-router";
import { Coins, LineChart, DollarSign } from "lucide-react";

const TABS = [
  { key: "topups",  to: "/admin/topups",  label: "Top-ups", icon: Coins },
  { key: "revenue", to: "/admin/revenue", label: "Revenue", icon: LineChart },
  { key: "pricing", to: "/admin/pricing", label: "Pricing", icon: DollarSign },
] as const;

type TabKey = typeof TABS[number]["key"];

export function AdminBillingHeaderTabs({ active }: { active: TabKey }) {
  return (
    <div className="flex items-center gap-1 border-b -mx-1 px-1 overflow-x-auto">
      {TABS.map((t) => {
        const isActive = t.key === active;
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={t.to}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
              isActive
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            }`}
          >
            <Icon className="h-4 w-4" /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
