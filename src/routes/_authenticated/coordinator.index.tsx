import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getDashboardSummary,
  getDashboardActivity,
  listDrivers,
} from "@/lib/coordinator.functions";
import {
  CalendarDays,
  Inbox,
  Users,
  Truck,
  Euro,
  Plus,
  Bot,
  ArrowRight,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobFormDialog } from "@/components/coordinator/JobFormDialog";
import { SuspiciousActivityCard } from "@/components/coordinator/SuspiciousActivityCard";
import { TrafficBadge } from "@/components/coordinator/TrafficBadge";
import { formatEtaMinutes } from "@/lib/trip-display";
import { useEnrichVisibleJobs } from "@/hooks/use-enrich-jobs";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/_authenticated/coordinator/")({
  head: () => ({ meta: [{ title: "Dashboard — Coordinator" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const summaryFn = useServerFn(getDashboardSummary);
  const activityFn = useServerFn(getDashboardActivity);
  const driversFn = useServerFn(listDrivers);

  const { data } = useQuery({ queryKey: ["coord-summary"], queryFn: () => summaryFn() });
  const { data: activity, refetch: refetchActivity } = useQuery({
    queryKey: ["coord-dash-activity"],
    queryFn: () => activityFn(),
    refetchInterval: 30_000,
  });
  const { data: drivers } = useQuery({ queryKey: ["drivers"], queryFn: () => driversFn() });

  const [addOpen, setAddOpen] = useState(false);

  const enrichable = [
    ...((activity?.pending ?? []) as any[]),
    ...((activity?.unassigned ?? []) as any[]),
  ].filter((j) => j?.id);
  useEnrichVisibleJobs(enrichable, [["coord-dash-activity"]]);


  const stats = [
    { to: "/coordinator/pending", label: "Pending", value: data?.pending_bookings ?? 0, icon: Inbox, tone: "text-amber-500", pulse: (data?.pending_bookings ?? 0) > 0 },
    { to: "/coordinator/calendar", label: "Proposals", value: data?.open_price_proposals ?? 0, icon: Euro, tone: "text-emerald-600", pulse: (data?.open_price_proposals ?? 0) > 0 },
    { to: "/coordinator/calendar", label: "Unassigned", value: data?.unassigned_jobs ?? 0, icon: Truck, tone: "text-blue-500", pulse: false },
    { to: "/coordinator/calendar", label: "Today", value: data?.today_jobs ?? 0, icon: CalendarDays, tone: "text-emerald-500", pulse: false },
    { to: "/coordinator/drivers", label: "Drivers", value: data?.drivers ?? 0, icon: Users, tone: "text-primary", pulse: false },
  ];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto pb-24 md:pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold truncate">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Live summary of your operations.</p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <Button
          size="lg"
          className="h-14 justify-start gap-3 text-base shadow-sm"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-5 w-5" />
          <span className="text-left leading-tight">
            <span className="block font-semibold">New trip</span>
            <span className="block text-[11px] font-normal opacity-80">Add or bulk paste</span>
          </span>
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="h-14 justify-start gap-3 text-base shadow-sm"
          onClick={() => navigate({ to: "/coordinator/ai-center" })}
        >
          <Bot className="h-5 w-5 text-primary" />
          <span className="text-left leading-tight">
            <span className="block font-semibold">Chat with AI</span>
            <span className="block text-[11px] font-normal opacity-70">Voice, rules & auto‑dispatch</span>
          </span>
        </Button>
      </div>

      {/* Stats – tight grid, no clipping on 375px */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mt-5">
        {stats.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className={cn(
              "rounded-xl border bg-card p-3 hover:bg-accent transition-colors min-w-0",
              c.pulse && "ring-2 ring-emerald-500/60",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground truncate">{c.label}</span>
              <c.icon className={cn("h-4 w-4 shrink-0", c.tone)} />
            </div>
            <div className="text-2xl font-semibold mt-1.5 tabular-nums">{c.value}</div>
          </Link>
        ))}
      </div>

      {/* New trips – recent pending client bookings */}
      <SectionHeader
        icon={Inbox}
        title="New trips"
        subtitle="Recent portal bookings waiting on you"
        to="/coordinator/pending"
        badge={activity?.pending?.length ?? 0}
      />
      <div className="space-y-2">
        {(activity?.pending ?? []).length === 0 ? (
          <EmptyLine text="No new bookings — you're all caught up." />
        ) : (
          activity!.pending.map((b: any) => (
            <TripRow
              key={b.id}
              to="/coordinator/pending"
              from={b.pickup_display_name || b.from_location}
              to_={b.dropoff_display_name || b.to_location}
              date={b.date}
              time={b.time}
              badge={b.status === "modification_pending" ? "Change" : "Pending"}
              badgeTone="bg-amber-500/15 text-amber-700 dark:text-amber-300"
              meta={b.pax_count ? `${b.pax_count} pax` : undefined}
              job={b}
            />

          ))
        )}
      </div>

      {/* Unassigned jobs */}
      <SectionHeader
        icon={Truck}
        title="Unassigned jobs"
        subtitle="Upcoming trips still needing a driver"
        to="/coordinator/calendar"
        badge={activity?.unassigned?.length ?? 0}
      />
      <div className="space-y-2">
        {(activity?.unassigned ?? []).length === 0 ? (
          <EmptyLine text="Every upcoming trip has a driver. Nice." />
        ) : (
          activity!.unassigned.map((j: any) => (
            <TripRow
              key={j.id}
              to="/coordinator/calendar"
              from={j.pickup_display_name || j.from_location}
              to_={j.dropoff_display_name || j.to_location}
              date={j.date}
              time={j.time}
              badge="Unassigned"
              badgeTone="bg-blue-500/15 text-blue-700 dark:text-blue-300"
              job={j}
            />

          ))
        )}
      </div>

      <div className="mt-6">
        <SuspiciousActivityCard />
      </div>

      <JobFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        drivers={(drivers ?? []) as any}
        onSaved={() => {
          setAddOpen(false);
          refetchActivity();
        }}
      />
    </div>
  );
}

function SectionHeader({
  icon: Icon, title, subtitle, to, badge,
}: {
  icon: typeof Inbox; title: string; subtitle?: string; to: string; badge?: number;
}) {
  return (
    <div className="mt-6 mb-2 flex items-end justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <h2 className="text-sm font-semibold truncate">{title}</h2>
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-1.5 py-0.5 tabular-nums">
              {badge}
            </span>
          )}
        </div>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
      </div>
      <Link to={to} className="text-xs font-medium text-primary inline-flex items-center gap-1 shrink-0">
        Open <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function TripRow({
  to, from, to_, date, time, badge, badgeTone, meta,
}: {
  to: string; from?: string | null; to_?: string | null;
  date?: string | null; time?: string | null;
  badge: string; badgeTone: string; meta?: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-xl border bg-card p-3 hover:bg-accent transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{from || "—"}</div>
          <div className="text-xs text-muted-foreground truncate">→ {to_ || "—"}</div>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeTone)}>
          {badge}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {date ?? ""}{time ? ` · ${time.slice(0, 5)}` : ""}
        </span>
        {meta && <span>· {meta}</span>}
      </div>
    </Link>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
