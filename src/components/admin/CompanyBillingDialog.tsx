import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Coins, Sparkles } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  adminGetCompanyBilling, adminListPlans, adminSetCompanyPlan, adminGrantPoints,
  adminSetFeatureCap, listFeatureEntitlements, setFeatureEntitlement, clearFeatureEntitlement,
} from "@/lib/admin.functions";
import type { FeatureKey } from "@/lib/features";
import { AI_FEATURE_KEYS, FEATURE_CATALOG } from "@/lib/features";

export function CompanyBillingDialog({ company }: { company: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const billingFn = useServerFn(adminGetCompanyBilling);
  const plansFn = useServerFn(adminListPlans);
  const setPlanFn = useServerFn(adminSetCompanyPlan);
  const grantFn = useServerFn(adminGrantPoints);
  const capFn = useServerFn(adminSetFeatureCap);
  const listEntFn = useServerFn(listFeatureEntitlements);

  const { data: billing, isLoading } = useQuery({
    queryKey: ["admin-billing", company.id],
    queryFn: () => billingFn({ data: { company_id: company.id } }) as Promise<any>,
    enabled: open,
  });
  const { data: plans } = useQuery({ queryKey: ["admin-plans"], queryFn: () => plansFn(), enabled: open });
  const { data: entRows } = useQuery({
    queryKey: ["feature-entitlements", company.id],
    queryFn: () => listEntFn({ data: { company_id: company.id } }) as Promise<any[]>,
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-billing", company.id] });
    qc.invalidateQueries({ queryKey: ["feature-entitlements", company.id] });
  };

  const setPlanMut = useMutation({
    mutationFn: (plan_id: string) => setPlanFn({ data: { company_id: company.id, plan_id } }),
    onSuccess: () => { toast.success("Plan set"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const grantMut = useMutation({
    mutationFn: (points: number) => grantFn({ data: { company_id: company.id, points, note: "admin grant from dialog" } }),
    onSuccess: () => { toast.success("Points granted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const capMut = useMutation({
    mutationFn: ({ feature, monthly_cap }: { feature: string; monthly_cap: number | null }) =>
      capFn({ data: { company_id: company.id, feature, monthly_cap } }),
    onSuccess: () => { toast.success("Cap saved"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setEntFn = useServerFn(setFeatureEntitlement);
  const clearEntFn = useServerFn(clearFeatureEntitlement);
  const toggleMut = useMutation({
    mutationFn: ({ feature, enabled }: { feature: FeatureKey; enabled: boolean }) =>
      setEntFn({ data: { company_id: company.id, feature, enabled } }),
    onSuccess: () => { toast.success("Access updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const clearMut = useMutation({
    mutationFn: (feature: FeatureKey) =>
      clearEntFn({ data: { company_id: company.id, feature } }),
    onSuccess: () => { toast.success("Reverted to plan default"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [grantAmt, setGrantAmt] = useState("500");

  const currentPlanId = billing?.subscription?.plan_id ?? "";
  const planPoints = billing?.subscription?.points_remaining_this_period ?? 0;
  const bonus = billing?.company?.points_balance ?? 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8">
          <Coins className="h-3.5 w-3.5 mr-1" /> Billing
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Billing & access — {company.name}</DialogTitle>
          <DialogDescription>Set plan, top up points, and cap AI feature usage.</DialogDescription>
        </DialogHeader>

        {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div> : (
          <div className="space-y-5 max-h-[65vh] overflow-y-auto -mx-6 px-6">
            {/* Plan */}
            <section>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><Sparkles className="h-4 w-4" /> Plan</h3>
              <div className="flex items-center gap-2">
                <Select value={currentPlanId} onValueChange={(v) => setPlanMut.mutate(v)}>
                  <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select a plan…" /></SelectTrigger>
                  <SelectContent>
                    {(plans ?? []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} — €{Number(p.price_monthly).toFixed(2)}/mo · {p.included_points} pts</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {billing?.subscription ? (
                <div className="text-xs text-muted-foreground mt-2">
                  Renews {new Date(billing.subscription.current_period_end).toLocaleDateString()} · {planPoints} plan points left
                </div>
              ) : null}
            </section>

            {/* Points */}
            <section>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><Coins className="h-4 w-4" /> Bonus points</h3>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border px-3 py-2 text-sm">Current balance: <strong>{bonus}</strong></div>
                <Input type="number" value={grantAmt} onChange={(e) => setGrantAmt(e.target.value)} className="h-9 w-24" />
                <Button size="sm" onClick={() => grantMut.mutate(Number(grantAmt))} disabled={grantMut.isPending}>Grant</Button>
                <Button size="sm" variant="outline" onClick={() => grantMut.mutate(-Number(grantAmt))} disabled={grantMut.isPending}>Deduct</Button>
              </div>
            </section>

            {/* Feature caps */}
            <section>
              <h3 className="text-sm font-medium mb-2">AI feature monthly caps</h3>
              <p className="text-xs text-muted-foreground mb-3">Blocks the feature once N uses in the current period are reached. Empty = unlimited.</p>
              <div className="space-y-2">
                {AI_FEATURE_KEYS.map((k) => {
                  const label = FEATURE_CATALOG.find((f) => f.key === k)?.label ?? k;
                  const row = (entRows ?? []).find((e: any) => e.key === k);
                  return <CapRow key={k} feature={k} label={label} row={row} onSave={(cap) => capMut.mutate({ feature: k, monthly_cap: cap })} />;
                })}
              </div>
            </section>

            {/* Recent ledger */}
            <section>
              <h3 className="text-sm font-medium mb-2">Recent activity</h3>
              <div className="rounded-md border divide-y max-h-48 overflow-y-auto text-xs">
                {(billing?.ledger ?? []).slice(0, 20).map((l: any) => (
                  <div key={l.id} className="px-3 py-1.5 flex items-center gap-2">
                    <span className="text-muted-foreground min-w-[130px]">{new Date(l.created_at).toLocaleString()}</span>
                    <span className="font-mono flex-1 truncate">{l.feature_key ?? "—"}</span>
                    <Badge variant="secondary" className="text-[10px]">{l.points_deducted > 0 ? `-${l.points_deducted}` : `+${Math.abs(l.points_deducted)}`}</Badge>
                  </div>
                ))}
                {(billing?.ledger ?? []).length === 0 ? <div className="p-3 text-muted-foreground">No activity yet.</div> : null}
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CapRow({ feature, label, row, onSave }: { feature: FeatureKey; label: string; row: any; onSave: (cap: number | null) => void }) {
  const [cap, setCap] = useState<string>(row?.monthly_cap != null ? String(row.monthly_cap) : "");
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        {row?.usage_this_period != null ? (
          <div className="text-xs text-muted-foreground">Used this period: {row.usage_this_period}</div>
        ) : null}
      </div>
      <Input type="number" placeholder="∞" value={cap} onChange={(e) => setCap(e.target.value)} className="h-8 w-24" />
      <Button size="sm" variant="outline" onClick={() => onSave(cap === "" ? null : Number(cap))}>Save</Button>
    </div>
  );
}
