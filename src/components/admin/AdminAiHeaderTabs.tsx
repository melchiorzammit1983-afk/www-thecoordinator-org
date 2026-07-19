import { Link } from "@tanstack/react-router";
import { Settings2, BarChart3, Activity } from "lucide-react";

const TABS = [
  { to: "/admin/ai-settings", label: "Settings", icon: Settings2 },
  { to: "/admin/ai-insights", label: "Insights", icon: BarChart3 },
  { to: "/admin/ai-activity", label: "Activity", icon: Activity },
] as const;

export function AdminAiHeaderTabs({ active }: { active: "settings" | "insights" | "activity" }) {
  return (
    <div className="flex items-center gap-1 border-b -mx-1 px-1 overflow-x-auto">
      {TABS.map((t) => {
        const key = t.to.split("-").pop() as "settings" | "insights" | "activity";
        const isActive = key === active;
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={t.to}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
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
