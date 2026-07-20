import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminRevenueDashboard } from "@/lib/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, Users, Sparkles, TrendingUp, Coins } from "lucide-react";
import { AdminBillingHeaderTabs } from "@/components/admin/AdminBillingHeaderTabs";

export const Route = createFileRoute("/_authenticated/admin/revenue")({
  component: RevenuePage,
});

function RevenuePage() {
  const fn = useServerFn(adminRevenueDashboard);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-revenue"],
    queryFn: () => fn() as Promise<any>,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <AdminBillingHeaderTabs active="revenue" />
      <div>
        <h1 className="text-2xl font-semibold">Revenue</h1>
        <p className="text-sm text-muted-foreground">MRR, point sales, and feature adoption over the last 30 days.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi icon={<DollarSign className="h-4 w-4" />} label="MRR" value={`€${Number(data.mrr).toFixed(2)}`} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="30d top-up revenue" value={`€${Number(data.topup_revenue_30d).toFixed(2)}`} />
        <Kpi icon={<Coins className="h-4 w-4" />} label="30d points sold" value={data.points_sold_30d.toLocaleString()} />
        <Kpi icon={<Sparkles className="h-4 w-4" />} label="30d points spent" value={data.points_spent_30d.toLocaleString()} />
        <Kpi icon={<Users className="h-4 w-4" />} label="Active subscriptions" value={`${data.active_subscriptions} / ${data.total_companies}`} />
        <Kpi icon={<DollarSign className="h-4 w-4" />} label="Total 30d revenue" value={`€${Number(data.total_revenue_30d).toFixed(2)}`} highlight />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Plan distribution</CardTitle></CardHeader>
          <CardContent>
            {data.plan_distribution.length === 0 ? <p className="text-sm text-muted-foreground">No subscriptions yet.</p> : (
              <div className="space-y-2">
                {data.plan_distribution.map((p: any) => (
                  <div key={p.plan} className="flex items-center justify-between text-sm">
                    <span>{p.plan}</span>
                    <Badge variant="secondary">{p.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Feature usage (30d)</CardTitle></CardHeader>
          <CardContent>
            {data.feature_usage_30d.length === 0 ? <p className="text-sm text-muted-foreground">No AI usage yet.</p> : (
              <div className="space-y-2">
                {data.feature_usage_30d.slice(0, 10).map((f: any) => (
                  <div key={f.feature_key} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs">{f.feature_key}</span>
                    <Badge variant="secondary">{f.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Top spenders (30d)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Company</TableHead><TableHead className="text-right">Points spent</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.top_spenders.length === 0 ? (
                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">No usage yet.</TableCell></TableRow>
              ) : data.top_spenders.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell className="text-right font-semibold">{s.spent.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-primary" : undefined}>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
