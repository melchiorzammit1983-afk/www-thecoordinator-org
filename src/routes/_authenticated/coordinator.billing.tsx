import { createFileRoute } from "@tanstack/react-router";
import { useMyBilling } from "@/hooks/use-features";
import { useEntitlements } from "@/hooks/use-entitlements";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, Sparkles, TrendingDown, ShieldAlert, Clock } from "lucide-react";
import { RequestTopupDialog } from "@/components/billing/RequestTopupDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/coordinator/billing")({
  component: BillingPage,
});

function BillingPage() {
  const { data, isLoading } = useMyBilling();
  const ent = useEntitlements();

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading billing…</div>;
  }

  const plan = data.subscription?.plans;
  const included = plan?.included_points ?? 0;
  const percent = included ? Math.max(0, Math.min(100, Math.round((ent.planPts / included) * 100))) : 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Billing & Points</h1>
          <p className="text-sm text-muted-foreground">One wallet, one plan. Every action draws from the same pool.</p>
        </div>
        <RequestTopupDialog />
      </div>

      {ent.trialActive && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>
            <strong>Free trial</strong> — full access until{" "}
            {new Date(ent.trialEndsAt!).toLocaleDateString()}.
          </span>
        </div>
      )}
      {!ent.trialActive && ent.wallet <= 0 && (
        <div className="rounded-md border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-center gap-2 text-sm">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <span>
            Wallet is empty. You have <strong>{ent.graceLeft}</strong> grace action{ent.graceLeft === 1 ? "" : "s"} left before hard-block. Top up to keep going.
          </span>
        </div>
      )}

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
            <CardTitle className="text-sm text-muted-foreground font-medium">Wallet</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" />
              {ent.wallet.toLocaleString()}
              <span className="text-base text-muted-foreground font-normal">pts</span>
            </div>
            <div className="h-2 rounded-full bg-muted mt-2 overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              {ent.planPts.toLocaleString()} plan + {ent.balancePts.toLocaleString()} top-up
              {data.subscription?.current_period_end && (
                <> · Resets {new Date(data.subscription.current_period_end).toLocaleDateString()}</>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Grace actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" /> {ent.graceLeft}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Emergency buffer used only after your wallet is empty.</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feature point costs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2">
            {data.costs.map((c) => {
              const allowed = ent.canUse(c);
              return (
                <div key={c.feature_key} className={`flex items-center justify-between rounded-md border p-3 ${allowed ? "" : "opacity-60"}`}>
                  <div>
                    <div className="text-sm font-medium">{c.label ?? c.feature_key}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      {c.feature_key}
                      {c.min_plan_code && <Badge variant="outline" className="ml-1 text-[10px]">requires {c.min_plan_code}</Badge>}
                    </div>
                  </div>
                  <Badge variant={allowed ? "secondary" : "outline"}>{c.points_cost} pt{c.points_cost === 1 ? "" : "s"}</Badge>
                </div>
              );
            })}
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
    </div>
  );
}
