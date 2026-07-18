import { createFileRoute } from "@tanstack/react-router";
import { useMyBilling } from "@/hooks/use-features";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, Sparkles, TrendingDown } from "lucide-react";
import { RequestTopupDialog } from "@/components/billing/RequestTopupDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


export const Route = createFileRoute("/_authenticated/coordinator/billing")({
  component: BillingPage,
});

function BillingPage() {
  const { data, isLoading } = useMyBilling();

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading billing…</div>;
  }

  const plan = data.subscription?.plans;
  const planPoints = data.subscription?.points_remaining_this_period ?? 0;
  const bonusPoints = data.company?.points_balance ?? 0;
  const totalPoints = planPoints + bonusPoints;
  const included = plan?.included_points ?? 0;
  const percent = included ? Math.max(0, Math.min(100, Math.round((planPoints / included) * 100))) : 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Billing & Points</h1>
          <p className="text-sm text-muted-foreground">Your plan, point balance, and recent AI usage.</p>
        </div>
        <RequestTopupDialog />
      </div>

      

      <div className="grid gap-4 md:grid-cols-3">

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Current plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> {plan?.name ?? "No plan"}
            </div>
            {plan ? (
              <div className="text-xs text-muted-foreground mt-1">
                €{Number(plan.price_monthly).toFixed(2)} / month · {plan.included_points} points included
              </div>
            ) : (
              <div className="text-xs text-muted-foreground mt-1">Contact your administrator to activate a plan.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Plan points remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{planPoints.toLocaleString()}<span className="text-base text-muted-foreground"> / {included}</span></div>
            <div className="h-2 rounded-full bg-muted mt-2 overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
            <div className="text-xs text-muted-foreground mt-2">Resets on {data.subscription?.current_period_end ? new Date(data.subscription.current_period_end).toLocaleDateString() : "—"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Bonus point balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" /> {bonusPoints.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Used after plan points are spent.</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI feature costs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2">
            {data.costs.map((c) => (
              <div key={c.feature_key} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">{c.label ?? c.feature_key}</div>
                  <div className="text-xs text-muted-foreground">{c.feature_key}</div>
                </div>
                <Badge variant="secondary">{c.points_cost} pt{c.points_cost === 1 ? "" : "s"}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Recent usage</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Feature</TableHead>
                <TableHead>Points</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No usage yet.</TableCell></TableRow>
              ) : (
                data.recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{r.feature_key ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.points_deducted > 0 ? `-${r.points_deducted}` : `+${Math.abs(r.points_deducted)}`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.note ?? ""}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">Total available: <strong>{totalPoints}</strong> points</p>
    </div>
  );
}
