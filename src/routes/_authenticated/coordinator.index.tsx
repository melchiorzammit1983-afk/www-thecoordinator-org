import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardSummary } from "@/lib/coordinator.functions";
import { CalendarDays, Inbox, Users, Truck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/coordinator/")({
  head: () => ({ meta: [{ title: "Dashboard — Coordinator" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const fn = useServerFn(getDashboardSummary);
  const { data } = useQuery({ queryKey: ["coord-summary"], queryFn: () => fn() });

  const cards = [
    { to: "/coordinator/pending", label: "Pending approvals", value: data?.pending_bookings ?? 0, icon: Inbox, tone: "text-amber-500" },
    { to: "/coordinator/calendar", label: "Unassigned jobs", value: data?.unassigned_jobs ?? 0, icon: Truck, tone: "text-blue-500" },
    { to: "/coordinator/calendar", label: "Today's trips", value: data?.today_jobs ?? 0, icon: CalendarDays, tone: "text-emerald-500" },
    { to: "/coordinator/drivers", label: "Drivers", value: data?.drivers ?? 0, icon: Users, tone: "text-primary" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-muted-foreground mt-1">Live summary of your operations.</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="rounded-lg border bg-card p-4 hover:bg-accent transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <c.icon className={`h-4 w-4 ${c.tone}`} />
            </div>
            <div className="text-3xl font-semibold mt-2 tabular-nums">{c.value}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
