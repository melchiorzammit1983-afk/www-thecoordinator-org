import { Link, useRouterState } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { HELP_ARTICLES, HELP_GROUPS, type HelpRole } from "@/content/help/manifest";
import { cn } from "@/lib/utils";
import { Users, Car, Building2, ShieldCheck, Globe } from "lucide-react";

const ROLE_META: Record<HelpRole, { label: string; icon: typeof Users }> = {
  everyone: { label: "Everyone", icon: Globe },
  coordinator: { label: "Coordinator", icon: Building2 },
  driver: { label: "Driver", icon: Car },
  client: { label: "Client", icon: Users },
  admin: { label: "Admin", icon: ShieldCheck },
};

export function HelpSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [role, setRole] = useState<HelpRole>("everyone");

  const filtered = useMemo(
    () =>
      role === "everyone"
        ? HELP_ARTICLES
        : HELP_ARTICLES.filter((a) => a.roles.includes(role) || a.roles.includes("everyone")),
    [role],
  );

  return (
    <aside className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          I'm a…
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(["everyone", "coordinator", "driver", "client", "admin"] as HelpRole[]).map((r) => {
            const M = ROLE_META[r];
            return (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[10px] font-medium transition-colors",
                  role === r
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <M.icon className="h-3.5 w-3.5" />
                {M.label}
              </button>
            );
          })}
        </div>
      </div>

      {HELP_GROUPS.map((group) => {
        const items = filtered.filter((a) => a.group === group);
        if (!items.length) return null;
        return (
          <div key={group}>
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </div>
            <ul className="space-y-0.5">
              {items.map((a) => {
                const active = pathname === `/help/${a.slug}`;
                return (
                  <li key={a.slug}>
                    <Link
                      to="/help/$topic"
                      params={{ topic: a.slug }}
                      onClick={onNavigate}
                      className={cn(
                        "block truncate rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-primary text-primary-foreground font-medium"
                          : "text-foreground/80 hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {a.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </aside>
  );
}
