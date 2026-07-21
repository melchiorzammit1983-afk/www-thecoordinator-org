import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save, Activity, Search, Wallet } from "lucide-react";
import {
  adminListPlans, adminUpsertPlan, adminDeletePlan,
  adminListPointPacks, adminUpsertPointPack, adminDeletePointPack,
  adminSetFeatureCost,
  adminFeatureUsageThisMonth,
  adminListCompanyWallets,
} from "@/lib/admin.functions";
import { listAiFeatureCosts } from "@/lib/billing.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FEATURE_CATALOG } from "@/lib/features";
import { CompanyBillingDialog } from "@/components/admin/CompanyBillingDialog";
import { AdminBillingHeaderTabs } from "@/components/admin/AdminBillingHeaderTabs";
import { FeatureInfoTooltip } from "@/components/features/FeatureInfoTooltip";
import { useReferencePack } from "@/hooks/use-reference-rate";
import { formatEur, eurPerPoint } from "@/lib/points-eur";

export const Route = createFileRoute("/_authenticated/admin/pricing")({
  component: PricingAdmin,
});

function PricingAdmin() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <AdminBillingHeaderTabs active="pricing" />
      <div>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="text-sm text-muted-foreground">Set plans, point packs, and per-feature costs.</p>
      </div>
      <WalletsCard />
      <PlansCard />
      <PointPacksCard />
      {/* Feature cost editing lives on the AI Settings page — single source of truth */}
      {false ? <FeatureCostsCard /> : null}
      <PlansCard />
      <PointPacksCard />
    </div>
  );
}

// ---------- Plans ----------
function PlansCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListPlans);
  const upFn = useServerFn(adminUpsertPlan);
  const delFn = useServerFn(adminDeletePlan);
  const { data: plans } = useQuery({ queryKey: ["admin-plans"], queryFn: () => listFn() });

  const upMut = useMutation({
    mutationFn: (row: any) => upFn({ data: row }),
    onSuccess: () => { toast.success("Plan saved"); qc.invalidateQueries({ queryKey: ["admin-plans"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Plan deleted"); qc.invalidateQueries({ queryKey: ["admin-plans"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Plans</CardTitle>
        <Button size="sm" variant="outline" onClick={() => upMut.mutate({
          code: `plan_${Date.now()}`, name: "New plan", price_monthly: 0, included_points: 0, feature_keys: [], sort_order: (plans?.length ?? 0) + 1,
        })}>
          <Plus className="h-4 w-4 mr-1" /> Add plan
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {(plans ?? []).map((p: any) => (
          <PlanEditor key={p.id} plan={p} onSave={(row) => upMut.mutate(row)} onDelete={() => delMut.mutate(p.id)} />
        ))}
      </CardContent>
    </Card>
  );
}

function PlanEditor({ plan, onSave, onDelete }: { plan: any; onSave: (row: any) => void; onDelete: () => void }) {
  const [name, setName] = useState(plan.name);
  const [code, setCode] = useState(plan.code);
  const [price, setPrice] = useState(String(plan.price_monthly));
  const [points, setPoints] = useState(String(plan.included_points));
  const [features, setFeatures] = useState<string[]>(plan.feature_keys ?? []);
  const [description, setDescription] = useState<string>(plan.description ?? "");
  const [driverCap, setDriverCap] = useState<string>(plan.driver_cap == null ? "" : String(plan.driver_cap));
  const [trialDays, setTrialDays] = useState<string>(String(plan.trial_days ?? 14));
  const [isPublic, setIsPublic] = useState<boolean>(plan.is_public !== false);

  const toggle = (k: string) => setFeatures((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div><Label>Price (€/mo)</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><Label>Included points</Label><Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} /></div>
        <div><Label>Driver cap (blank = ∞)</Label><Input type="number" value={driverCap} onChange={(e) => setDriverCap(e.target.value)} /></div>
        <div><Label>Trial days</Label><Input type="number" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} /></div>
        <div className="md:col-span-2"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown on pricing page" /></div>
      </div>
      <div>
        <Label className="text-xs">Features included</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FEATURE_CATALOG.map((f) => (
            <button key={f.key} type="button" onClick={() => toggle(f.key)}
              className={`text-xs rounded-md border px-2 py-1 ${features.includes(f.key) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          <span className="text-muted-foreground">Listed publicly on pricing page</span>
        </label>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
          <Button size="sm" onClick={() => onSave({
            id: plan.id, code, name,
            price_monthly: Number(price), included_points: Number(points),
            feature_keys: features, sort_order: plan.sort_order ?? 0,
            description: description || null,
            driver_cap: driverCap === "" ? null : Number(driverCap),
            trial_days: Number(trialDays) || 14,
            is_public: isPublic,
          })}>
            <Save className="h-4 w-4 mr-1" /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}


// ---------- Point Packs ----------
function PointPacksCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListPointPacks);
  const upFn = useServerFn(adminUpsertPointPack);
  const delFn = useServerFn(adminDeletePointPack);
  const { data: packs } = useQuery({ queryKey: ["admin-point-packs"], queryFn: () => listFn() });

  const upMut = useMutation({
    mutationFn: (row: any) => upFn({ data: row }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["admin-point-packs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-point-packs"] }); },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Point packs</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Mark one pack as the <strong>reference rate</strong> — it becomes the benchmark used to display EUR-equivalent values for point costs across the app.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => upMut.mutate({ name: "New pack", points: 100, price: 10, sort_order: (packs?.length ?? 0) + 1, is_active: true })}>
          <Plus className="h-4 w-4 mr-1" /> Add pack
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Points</TableHead><TableHead>Price (€)</TableHead><TableHead>Active</TableHead><TableHead>Reference rate</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(packs ?? []).map((p: any) => <PackRow key={p.id} pack={p} onSave={upMut.mutate} onDelete={() => delMut.mutate(p.id)} />)}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PackRow({ pack, onSave, onDelete }: { pack: any; onSave: (r: any) => void; onDelete: () => void }) {
  const [name, setName] = useState(pack.name);
  const [points, setPoints] = useState(String(pack.points));
  const [price, setPrice] = useState(String(pack.price));
  const [active, setActive] = useState(pack.is_active);
  const [isRef, setIsRef] = useState<boolean>(!!pack.is_reference_rate);
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
          {pack.is_reference_rate && <Badge variant="default" className="whitespace-nowrap">Reference rate</Badge>}
        </div>
      </TableCell>
      <TableCell><Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} className="h-8 w-24" /></TableCell>
      <TableCell><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 w-24" /></TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch checked={active} onCheckedChange={setActive} />
          <span className="text-[11px] text-muted-foreground">{active ? "Active" : "Off"}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2" title="Only one pack can be the reference rate; drives EUR display across the app">
          <Switch checked={isRef} onCheckedChange={setIsRef} />
          <span className="text-[11px] text-muted-foreground">{isRef ? "Reference" : "—"}</span>
        </div>
      </TableCell>
      <TableCell className="text-right space-x-1">
        <Button size="sm" variant="ghost" onClick={() => onSave({ id: pack.id, name, points: Number(points), price: Number(price), sort_order: pack.sort_order ?? 0, is_active: active, is_reference_rate: isRef })}>
          <Save className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
      </TableCell>
    </TableRow>
  );
}

// ---------- Feature Costs ----------
const CATEGORIES = [
  { key: "core", label: "Core" },
  { key: "ai", label: "AI" },
  { key: "comms", label: "Comms" },
  { key: "data", label: "Data" },
] as const;

function FeatureCostsCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAiFeatureCosts);
  const setFn = useServerFn(adminSetFeatureCost);
  const usageFn = useServerFn(adminFeatureUsageThisMonth);
  const { data: costs } = useQuery({ queryKey: ["ai-feature-costs"], queryFn: () => listFn() });
  const { data: usage } = useQuery({ queryKey: ["ai-feature-usage-month"], queryFn: () => usageFn() });
  const setMut = useMutation({
    mutationFn: (row: any) => setFn({ data: row }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["ai-feature-costs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const usageMap = useMemo(() => {
    const m = new Map<string, { uses: number; companies: number }>();
    for (const u of (usage ?? []) as Array<{ feature_key: string; uses: number; companies: number }>) {
      m.set(u.feature_key, { uses: u.uses, companies: u.companies });
    }
    return m;
  }, [usage]);

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    rows: (costs ?? []).filter((c: any) => (c.category ?? "ai") === cat.key),
  })).filter((g) => g.rows.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature point costs</CardTitle>
        <p className="text-xs text-muted-foreground">
          Drag the slider to set the point cost per use. Decimals allowed. Disable to turn a feature off globally. "Hard stop" blocks the action when a company runs out; leave off for core operations so they never break.
        </p>
      </CardHeader>
      <CardContent className="space-y-8">
        {grouped.map((g) => (
          <div key={g.key}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{g.label}</div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {g.rows.map((c: any) => (
                <FeatureCostCard
                  key={c.feature_key}
                  cost={c}
                  usage={usageMap.get(c.feature_key)}
                  onSave={setMut.mutate}
                />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FeatureCostCard({
  cost, usage, onSave,
}: {
  cost: any;
  usage: { uses: number; companies: number } | undefined;
  onSave: (r: any) => void;
}) {
  const initial = Number(cost.points_cost);
  const [points, setPoints] = useState<number>(initial);
  const [enabled, setEnabled] = useState<boolean>(cost.enabled !== false);
  const [block, setBlock] = useState<boolean>(cost.block_on_empty !== false);
  const [minPlan, setMinPlan] = useState<string>(cost.min_plan_code ?? "any");
  const [isAddon, setIsAddon] = useState<boolean>(!!cost.is_addon);
  const dirty =
    points !== initial ||
    enabled !== (cost.enabled !== false) ||
    block !== (cost.block_on_empty !== false) ||
    minPlan !== (cost.min_plan_code ?? "any") ||
    isAddon !== !!cost.is_addon;

  const sliderMax = Math.max(50, Math.ceil(Math.max(points, initial)));

  const pack = useReferencePack();
  const rate = eurPerPoint(pack);

  return (
    <div className={`rounded-lg border bg-card p-4 flex flex-col gap-3 transition-shadow hover:shadow-md ${dirty ? "ring-1 ring-primary/40" : ""}`}>
      <div>
        <div className="text-sm font-semibold leading-tight flex items-center gap-1.5">
          <span className="truncate">{cost.label ?? cost.feature_key}</span>
          <FeatureInfoTooltip featureKey={cost.feature_key} />
        </div>
        <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{cost.feature_key}</div>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums">{points.toFixed(2)}</span>
        <span className="text-xs text-muted-foreground">pts / use</span>
        {rate != null && <span className="text-xs text-muted-foreground ml-1">{formatEur(points * rate)}</span>}
      </div>

      <div className="space-y-2">
        <Slider
          value={[points]}
          min={0}
          max={sliderMax}
          step={0.5}
          onValueChange={(v) => setPoints(v[0] ?? 0)}
        />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>0</span>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={String(points)}
            onChange={(e) => setPoints(Number(e.target.value) || 0)}
            className="h-6 w-20 text-xs"
          />
          <span>{sliderMax}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Activity className="h-3 w-3" />
        <span>
          Used <strong className="text-foreground tabular-nums">{(usage?.uses ?? 0).toLocaleString()}×</strong> this month
          {usage && usage.companies > 0 ? <> across {usage.companies} {usage.companies === 1 ? "company" : "companies"}</> : null}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setEnabled(!enabled)}>
          <Badge variant={enabled ? "default" : "outline"}>{enabled ? "Enabled" : "Disabled"}</Badge>
        </button>
        <button type="button" onClick={() => setBlock(!block)}>
          <Badge variant={block ? "destructive" : "secondary"}>{block ? "Hard stop" : "Allow negative"}</Badge>
        </button>
        <button type="button" onClick={() => setIsAddon(!isAddon)}>
          <Badge variant={isAddon ? "default" : "outline"}>{isAddon ? "Add-on" : "Core"}</Badge>
        </button>
        <select
          value={minPlan}
          onChange={(e) => setMinPlan(e.target.value)}
          className="ml-auto h-7 rounded-md border bg-background px-2 text-[11px]"
          title="Minimum plan required"
        >
          <option value="any">Any plan</option>
          <option value="starter">Starter+</option>
          <option value="pro">Pro+</option>
          <option value="business">Business</option>
        </select>
      </div>

      <div className="flex justify-end pt-1">
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          disabled={!dirty}
          onClick={() => onSave({
            feature_key: cost.feature_key,
            points_cost: Number(points),
            label: cost.label,
            category: (cost.category ?? "ai"),
            enabled,
            block_on_empty: block,
            min_plan_code: minPlan === "any" ? null : minPlan,
            is_addon: isAddon,
          })}
        >
          <Save className="h-4 w-4 mr-1" /> Save
        </Button>
      </div>
    </div>
  );
}


// ---------- Wallets ----------

type WalletRow = {
  id: string;
  name: string;
  created_at: string;
  points_balance: number;
  plan_name: string | null;
  plan_points: number;
  last_activity_at: string | null;
  topups_this_month: number;
};

function WalletsCard() {
  const listFn = useServerFn(adminListCompanyWallets);
  const { data: wallets } = useQuery({
    queryKey: ["admin-company-wallets"],
    queryFn: () => listFn() as Promise<WalletRow[]>,
  });
  const [q, setQ] = useState("");

  const rows = (wallets ?? []) as WalletRow[];
  const filtered = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  const totalBalance = rows.reduce((s, r) => s + r.points_balance, 0);
  const toppedUp = rows.filter((r) => r.topups_this_month > 0).length;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Company wallets</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Live point balances across all companies.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-xs text-muted-foreground">
            Total balance: <strong className="text-foreground tabular-nums">{totalBalance.toLocaleString()} pts</strong>
            {" · "}{rows.length} companies
            {" · "}{toppedUp} topped up this month
          </div>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search company…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const color =
                r.points_balance <= 0 ? "text-destructive" :
                r.points_balance < 20 ? "text-amber-600" :
                "text-emerald-600";
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Joined {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.plan_name ? (
                      <div>
                        <Badge variant="secondary">{r.plan_name}</Badge>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{r.plan_points} plan pts left</div>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-lg font-semibold tabular-nums ${color}`}>
                    {r.points_balance.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.last_activity_at ? new Date(r.last_activity_at).toLocaleString() : "No activity"}
                  </TableCell>
                  <TableCell className="text-right">
                    <CompanyBillingDialog company={{ id: r.id, name: r.name }} />
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                  {rows.length === 0 ? "Loading…" : "No companies match your search."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
