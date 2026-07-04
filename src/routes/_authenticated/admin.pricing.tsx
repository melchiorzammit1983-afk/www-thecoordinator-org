import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";
import {
  adminListPlans, adminUpsertPlan, adminDeletePlan,
  adminListPointPacks, adminUpsertPointPack, adminDeletePointPack,
  adminSetFeatureCost,
} from "@/lib/admin.functions";
import { listAiFeatureCosts } from "@/lib/billing.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FEATURE_CATALOG } from "@/lib/features";

export const Route = createFileRoute("/_authenticated/admin/pricing")({
  component: PricingAdmin,
});

function PricingAdmin() {
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="text-sm text-muted-foreground">Set plans, point packs, and per-feature costs.</p>
      </div>
      <PlansCard />
      <PointPacksCard />
      <FeatureCostsCard />
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

  const toggle = (k: string) => setFeatures((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div><Label>Price (€/mo)</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><Label>Included points</Label><Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} /></div>
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
        <Button size="sm" onClick={() => onSave({ id: plan.id, code, name, price_monthly: Number(price), included_points: Number(points), feature_keys: features, sort_order: plan.sort_order ?? 0 })}>
          <Save className="h-4 w-4 mr-1" /> Save
        </Button>
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
        <CardTitle>Point packs</CardTitle>
        <Button size="sm" variant="outline" onClick={() => upMut.mutate({ name: "New pack", points: 100, price: 10, sort_order: (packs?.length ?? 0) + 1, is_active: true })}>
          <Plus className="h-4 w-4 mr-1" /> Add pack
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Points</TableHead><TableHead>Price (€)</TableHead><TableHead>Active</TableHead><TableHead></TableHead>
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
  return (
    <TableRow>
      <TableCell><Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" /></TableCell>
      <TableCell><Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} className="h-8 w-24" /></TableCell>
      <TableCell><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 w-24" /></TableCell>
      <TableCell>
        <button type="button" onClick={() => setActive(!active)}>
          <Badge variant={active ? "default" : "outline"}>{active ? "Active" : "Off"}</Badge>
        </button>
      </TableCell>
      <TableCell className="text-right space-x-1">
        <Button size="sm" variant="ghost" onClick={() => onSave({ id: pack.id, name, points: Number(points), price: Number(price), sort_order: pack.sort_order ?? 0, is_active: active })}>
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
  const { data: costs } = useQuery({ queryKey: ["ai-feature-costs"], queryFn: () => listFn() });
  const setMut = useMutation({
    mutationFn: (row: any) => setFn({ data: row }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["ai-feature-costs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    rows: (costs ?? []).filter((c: any) => (c.category ?? "ai") === cat.key),
  })).filter((g) => g.rows.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature point costs</CardTitle>
        <p className="text-xs text-muted-foreground">
          Decimals allowed (e.g. 1.5). Disable to turn a feature off globally. "Block on empty" hard-stops the action when a company runs out; leave off for core operations (trip creation) so they never break.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {grouped.map((g) => (
          <div key={g.key}>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">{g.label}</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead>Points / use</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Block on empty</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.rows.map((c: any) => <CostRow key={c.feature_key} cost={c} onSave={setMut.mutate} />)}
              </TableBody>
            </Table>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CostRow({ cost, onSave }: { cost: any; onSave: (r: any) => void }) {
  const [points, setPoints] = useState(String(cost.points_cost));
  const [enabled, setEnabled] = useState<boolean>(cost.enabled !== false);
  const [block, setBlock] = useState<boolean>(cost.block_on_empty !== false);
  const dirty =
    points !== String(cost.points_cost) ||
    enabled !== (cost.enabled !== false) ||
    block !== (cost.block_on_empty !== false);
  return (
    <TableRow>
      <TableCell>
        <div className="text-sm font-medium">{cost.label ?? cost.feature_key}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{cost.feature_key}</div>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          className="h-8 w-24"
        />
      </TableCell>
      <TableCell>
        <button type="button" onClick={() => setEnabled(!enabled)}>
          <Badge variant={enabled ? "default" : "outline"}>{enabled ? "On" : "Off"}</Badge>
        </button>
      </TableCell>
      <TableCell>
        <button type="button" onClick={() => setBlock(!block)}>
          <Badge variant={block ? "destructive" : "secondary"}>{block ? "Hard stop" : "Allow negative"}</Badge>
        </button>
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          onClick={() => onSave({
            feature_key: cost.feature_key,
            points_cost: Number(points),
            label: cost.label,
            category: (cost.category ?? "ai"),
            enabled,
            block_on_empty: block,
          })}
        >
          <Save className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
