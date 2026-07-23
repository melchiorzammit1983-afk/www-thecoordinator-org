import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Coins, CreditCard } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  adminGetCompanyBilling, adminListPlans, adminSetCompanyPlan, adminGrantPoints,
  adminListCompanyPriceOverrides, adminSetCompanyPriceOverride,
} from "@/lib/admin.functions";
import { listAiFeatureCosts } from "@/lib/billing.functions";

export function CompanyBillingDialog({ company }: { company: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const billingFn = useServerFn(adminGetCompanyBilling);
  const plansFn = useServerFn(adminListPlans);
  const setPlanFn = useServerFn(adminSetCompanyPlan);
  const grantFn = useServerFn(adminGrantPoints);

  const { data: billing, isLoading } = useQuery({
    queryKey: ["admin-billing", company.id],
    queryFn: () => billingFn({ data: { company_id: company.id } }) as Promise<any>,
    enabled: open,
  });
  const { data: plans } = useQuery({ queryKey: ["admin-plans"], queryFn: () => plansFn(), enabled: open });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-billing", company.id] });
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
          <DialogDescription>Set the plan, manage points and configure service pricing.</DialogDescription>
        </DialogHeader>

        {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div> : (
          <div className="space-y-5 max-h-[65vh] overflow-y-auto -mx-6 px-6">
            {/* Plan */}
            <section>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><CreditCard className="h-4 w-4" /> Plan</h3>
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


            {/* Per-company price overrides */}
            <PriceOverridesSection companyId={company.id} />

            {/* Recent ledger */}
            <section>
              <h3 className="text-sm font-medium mb-2">Recent activity</h3>
              <div className="rounded-md border divide-y max-h-48 overflow-y-auto text-xs">
                {(billing?.ledger ?? []).slice(0, 20).map((l: any) => (
                  <div key={l.id} className="px-3 py-1.5 flex items-center gap-2">
                    <span className="text-muted-foreground min-w-[130px]">{new Date(l.created_at).toLocaleString()}</span>
                    <span className="font-mono flex-1 truncate">{l.feature_key ?? "—"}</span>
                    <Badge variant="secondary" className="text-[10px]">{Number(l.points_deducted) > 0 ? `-${Number(l.points_deducted)}` : `+${Math.abs(Number(l.points_deducted))}`}</Badge>
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

const DEACTIVATED_PRICE_KEYS = new Set([
  "ai_coordinator_assist",
  "ai_extraction",
  "ai_extraction_media",
  "ai_voice_to_trip",
  "ai_auto_coordinate",
  "ai_daily_plan",
  "ai_reply_drafter",
  "ai_watchtower_scan",
  "ai_char_overage",
  "ai_guide_chat",
  "sales_bot",
  "flight_lookup_bundle",
  "flight_lookup_refresh",
  "flight_lookup_vessel",
  "flight_vessel_tracking",
  "auto_shift_early_flight",
  "route_optimization",
]);

function PriceOverridesSection({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const listCostsFn = useServerFn(listAiFeatureCosts);
  const listOverridesFn = useServerFn(adminListCompanyPriceOverrides);
  const setOverrideFn = useServerFn(adminSetCompanyPriceOverride);

  const { data: costs } = useQuery({
    queryKey: ["ai-feature-costs"],
    queryFn: () => listCostsFn() as Promise<any[]>,
  });
  const { data: overrides } = useQuery({
    queryKey: ["company-price-overrides", companyId],
    queryFn: () => listOverridesFn({ data: { company_id: companyId } }) as Promise<Array<{ feature_key: string; points_cost: number }>>,
  });

  const setMut = useMutation({
    mutationFn: (row: { feature_key: string; points_cost: number | null }) =>
      setOverrideFn({ data: { company_id: companyId, ...row } }),
    onSuccess: () => {
      toast.success("Override saved");
      qc.invalidateQueries({ queryKey: ["company-price-overrides", companyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const overrideMap = new Map((overrides ?? []).map((o) => [o.feature_key, Number(o.points_cost)]));
  const visibleCosts = (costs ?? []).filter((c: any) => !DEACTIVATED_PRICE_KEYS.has(c.feature_key));

  return (
    <section>
      <h3 className="text-sm font-medium mb-2">Per-company price overrides</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Set a custom point cost for this company. Leave blank to use the global default.
      </p>
      <div className="rounded-md border divide-y max-h-64 overflow-y-auto">
        {visibleCosts.map((c: any) => (
          <OverrideRow
            key={c.feature_key}
            cost={c}
            override={overrideMap.get(c.feature_key) ?? null}
            onSave={(v) => setMut.mutate({ feature_key: c.feature_key, points_cost: v })}
          />
        ))}
      </div>
    </section>
  );
}

function OverrideRow({
  cost, override, onSave,
}: {
  cost: any;
  override: number | null;
  onSave: (v: number | null) => void;
}) {
  const [val, setVal] = useState<string>(override != null ? String(override) : "");
  const effective = val === "" ? Number(cost.points_cost) : Number(val);
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{cost.label ?? cost.feature_key}</div>
        <div className="text-[10px] text-muted-foreground">
          Global: {Number(cost.points_cost)} · Effective: <strong>{effective}</strong>
        </div>
      </div>
      <Input
        type="number"
        step="0.01"
        min="0"
        placeholder="default"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="h-8 w-24"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => onSave(val === "" ? null : Number(val))}
      >
        Save
      </Button>
      {override != null && (
        <Button size="sm" variant="ghost" onClick={() => { setVal(""); onSave(null); }}>
          Reset
        </Button>
      )}
    </div>
  );
}
