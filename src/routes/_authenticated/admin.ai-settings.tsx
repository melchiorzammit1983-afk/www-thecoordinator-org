import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, Sparkles, Gift, Search, ChevronDown, ChevronRight } from "lucide-react";

import { listAiFeatureCosts } from "@/lib/billing.functions";
import {
  adminSetFeatureCost,
  adminListFreeAllowances,
  adminSearchCompanies,
  adminSetFreeAllowance,
} from "@/lib/admin.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AdminAiHeaderTabs } from "@/components/admin/AdminAiHeaderTabs";

export const Route = createFileRoute("/_authenticated/admin/ai-settings")({
  component: AiSettingsAdmin,
});

// Feature keys we've confirmed are actually referenced by application code.
// Anything NOT in this set that lives in ai_feature_costs is shown under
// "Legacy / unused" so the history stays visible but doesn't masquerade as
// an active setting.
const ACTIVE_FEATURE_KEYS = new Set<string>([
  // Coordinator assistant (single source of truth)
  "assistant_qa",
  "assistant_trip_action",
  "assistant_data_fix",
  // Overage / gating
  "ai_char_overage",
  "ai_coordinator_assist",
  // Trip/dispatch AI actions
  "ai_extraction",
  "ai_extraction_media",
  "ai_voice_to_trip",
  "ai_auto_assign",
  "ai_auto_coordinate",
  "ai_daily_plan",
  "ai_reply_drafter",
  "ai_agent_dispatch",
  "ai_agent_message",
  "ai_command_execute",
  "ai_command_read",
  "ai_watchtower_scan",
  // Guide / help
  "ai_guide_chat",
  // Flight tracking
  "flight_status_extra_lookup",
  "flight_vessel_tracking",
  "auto_shift_early_flight",
  // Ops
  "trip_auto_forward",
  "route_optimization",
  "extra_company_logos_weekly",
]);

type FeatureCost = {
  feature_key: string;
  label: string | null;
  points_cost: number | string;
  category: string | null;
  enabled: boolean;
  block_on_empty: boolean;
  est_cost_usd_cents: number | string | null;
};

function AiSettingsAdmin() {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> AI settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Single source of truth for AI pricing, margin visibility, and per-company free allowance.
        </p>
      </div>
      <AdminAiHeaderTabs active="settings" />
      <ActionCostsCard />
      <FreeAllowanceCard />
    </div>
  );
}

// ---------------- Action costs ----------------

function ActionCostsCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAiFeatureCosts);
  const setFn = useServerFn(adminSetFeatureCost);
  const { data: costs } = useQuery({ queryKey: ["ai-feature-costs"], queryFn: () => listFn() as Promise<FeatureCost[]> });
  const setMut = useMutation({
    mutationFn: (row: Partial<FeatureCost> & { feature_key: string; points_cost: number }) =>
      setFn({ data: row as never }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["ai-feature-costs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [showLegacy, setShowLegacy] = useState(false);

  const { active, legacy } = useMemo(() => {
    const all = (costs ?? []).filter((c) => (c.category ?? "").toLowerCase() === "ai");
    const active = all.filter((c) => ACTIVE_FEATURE_KEYS.has(c.feature_key));
    const legacy = all.filter((c) => !ACTIVE_FEATURE_KEYS.has(c.feature_key));
    active.sort((a, b) => a.feature_key.localeCompare(b.feature_key));
    legacy.sort((a, b) => a.feature_key.localeCompare(b.feature_key));
    return { active, legacy };
  }, [costs]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Points per AI action</CardTitle>
        <p className="text-xs text-muted-foreground">
          Loaded dynamically from <code className="text-[10px]">ai_feature_costs</code>. Actions with no code reference are grouped as Legacy so history stays intact without pretending they're active. New feature keys metered anywhere in code appear here automatically after they're added to the active list.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No active AI actions found.</div>
        ) : active.map((c) => (
          <ActionRow key={c.feature_key} cost={c} onSave={setMut.mutate} saving={setMut.isPending} />
        ))}

        {legacy.length > 0 ? (
          <div className="pt-2 border-t">
            <button
              type="button"
              onClick={() => setShowLegacy((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showLegacy ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Legacy / unused ({legacy.length}) — historical rows, not referenced in code
            </button>
            {showLegacy ? (
              <div className="mt-3 space-y-2">
                {legacy.map((c) => (
                  <ActionRow key={c.feature_key} cost={c} onSave={setMut.mutate} saving={setMut.isPending} isLegacy />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ActionRow({
  cost, onSave, saving, isLegacy,
}: {
  cost: FeatureCost;
  onSave: (r: Partial<FeatureCost> & { feature_key: string; points_cost: number }) => void;
  saving: boolean;
  isLegacy?: boolean;
}) {
  const initialPts = Number(cost.points_cost ?? 0);
  const initialEnabled = cost.enabled !== false;
  const initialBlock = cost.block_on_empty !== false;
  const initialEst = cost.est_cost_usd_cents == null ? "" : String(cost.est_cost_usd_cents);

  const [points, setPoints] = useState<number>(initialPts);
  const [enabled, setEnabled] = useState<boolean>(initialEnabled);
  const [block, setBlock] = useState<boolean>(initialBlock);
  const [estCents, setEstCents] = useState<string>(initialEst);

  useEffect(() => {
    setPoints(initialPts); setEnabled(initialEnabled); setBlock(initialBlock); setEstCents(initialEst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost.feature_key]);

  const dirty = points !== initialPts || enabled !== initialEnabled || block !== initialBlock || estCents !== initialEst;

  const estCentsNum = estCents.trim() === "" ? null : Number(estCents);
  const marginPct = estCentsNum != null && points > 0
    // Assumes 1 point ≈ $0.01 charged. Margin = (revenue - cost) / revenue.
    ? Math.round(((points * 1 - estCentsNum) / (points * 1)) * 100)
    : null;

  return (
    <div className={`rounded-lg border bg-card p-3 flex flex-col gap-3 md:flex-row md:items-start ${dirty ? "ring-1 ring-primary/40" : ""} ${isLegacy ? "opacity-70" : ""}`}>
      <div className="md:w-64 min-w-0">
        <div className="text-sm font-semibold truncate">{cost.label || cost.feature_key}</div>
        <div className="font-mono text-[10px] text-muted-foreground truncate">{cost.feature_key}</div>
        {isLegacy ? <Badge variant="outline" className="text-[10px] mt-1">Legacy</Badge> : null}
      </div>

      <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
        <label className="block">
          <span className="text-[10px] text-muted-foreground">Points charged</span>
          <Input type="number" min="0" step="0.25" value={String(points)}
            onChange={(e) => setPoints(Number(e.target.value) || 0)} className="h-8" />
        </label>
        <label className="block">
          <span className="text-[10px] text-muted-foreground">Est. AI cost (¢)</span>
          <Input type="number" min="0" step="0.01" value={estCents} placeholder="—"
            onChange={(e) => setEstCents(e.target.value)} className="h-8" />
        </label>
        <div className="text-xs">
          <div className="text-[10px] text-muted-foreground">Margin</div>
          <div className={`font-mono ${marginPct == null ? "text-muted-foreground" : marginPct >= 50 ? "text-emerald-600" : marginPct >= 0 ? "text-amber-600" : "text-destructive"}`}>
            {marginPct == null ? "—" : `${marginPct}%`}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => setEnabled(!enabled)}>
            <Badge variant={enabled ? "default" : "outline"} className="w-full justify-center">{enabled ? "Enabled" : "Disabled"}</Badge>
          </button>
          <button type="button" onClick={() => setBlock(!block)} title="What happens when wallet is empty">
            <Badge variant={block ? "destructive" : "secondary"} className="w-full justify-center">{block ? "Hard stop" : "Allow negative"}</Badge>
          </button>
        </div>
      </div>

      <Button
        size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty || saving}
        onClick={() => onSave({
          feature_key: cost.feature_key,
          points_cost: points,
          label: cost.label ?? undefined,
          category: "ai",
          enabled, block_on_empty: block,
          est_cost_usd_cents: estCentsNum,
        })}
      >
        <Save className="h-4 w-4 mr-1" /> Save
      </Button>
    </div>
  );
}

// ---------------- Free-allowance per company ----------------

function FreeAllowanceCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListFreeAllowances);
  const searchFn = useServerFn(adminSearchCompanies);
  const setFn = useServerFn(adminSetFreeAllowance);

  const { data: withOverrides } = useQuery({
    queryKey: ["ai-free-allowances"],
    queryFn: () => listFn() as Promise<Array<{
      id: string; name: string;
      ai_free_monthly_points: number | string;
      ai_free_points_used_this_period: number | string;
      ai_period_reset_at: string | null;
    }>>,
  });

  const [query, setQuery] = useState("");
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["ai-free-allowance-search", query],
    queryFn: () => searchFn({ data: { query } }) as Promise<Array<{
      id: string; name: string;
      ai_free_monthly_points: number | string;
      ai_free_points_used_this_period: number | string;
    }>>,
  });

  const setMut = useMutation({
    mutationFn: (v: { company_id: string; ai_free_monthly_points: number; reset_used?: boolean }) =>
      setFn({ data: v }),
    onSuccess: () => {
      toast.success("Free allowance updated");
      qc.invalidateQueries({ queryKey: ["ai-free-allowances"] });
      qc.invalidateQueries({ queryKey: ["ai-free-allowance-search"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Gift className="h-4 w-4 text-primary" /> Free monthly AI allowance</CardTitle>
        <p className="text-xs text-muted-foreground">
          Global default is <b>0 points/month</b> (pure pay-as-you-go). Set a per-company override for VIP clients; the free bucket is consumed <b>before</b> the subscription allowance and admin-granted wallet, and resets on the same 30-day rollover.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <section>
          <div className="text-xs font-medium mb-2">Companies with a non-zero override ({withOverrides?.length ?? 0})</div>
          {(withOverrides ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground rounded border border-dashed p-3">
              No overrides yet — everyone is on 0 free points/month.
            </div>
          ) : (
            <div className="space-y-1">
              {(withOverrides ?? []).map((r) => (
                <AllowanceRow key={r.id} row={r} onSave={setMut.mutate} saving={setMut.isPending} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="text-xs font-medium mb-2 flex items-center gap-2"><Search className="h-3 w-3" /> Find a company</div>
          <Input placeholder="Search by company name…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 mb-2" />
          <div className="space-y-1">
            {isFetching ? <div className="text-xs text-muted-foreground py-2">Searching…</div> : null}
            {(searchResults ?? []).map((r) => (
              <AllowanceRow key={r.id} row={{ ...r, ai_period_reset_at: null }} onSave={setMut.mutate} saving={setMut.isPending} />
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function AllowanceRow({
  row, onSave, saving,
}: {
  row: {
    id: string; name: string;
    ai_free_monthly_points: number | string;
    ai_free_points_used_this_period: number | string;
    ai_period_reset_at?: string | null;
  };
  onSave: (v: { company_id: string; ai_free_monthly_points: number; reset_used?: boolean }) => void;
  saving: boolean;
}) {
  const initial = Number(row.ai_free_monthly_points ?? 0);
  const used = Number(row.ai_free_points_used_this_period ?? 0);
  const [pts, setPts] = useState(String(initial));
  useEffect(() => { setPts(String(initial)); }, [initial]);
  const dirty = Number(pts) !== initial;

  return (
    <div className={`flex items-center gap-2 rounded border bg-card px-3 py-2 ${dirty ? "ring-1 ring-primary/40" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{row.name}</div>
        <div className="text-[10px] text-muted-foreground font-mono">
          used {used.toFixed(2)} / {initial.toFixed(2)} pts this period
        </div>
      </div>
      <Input type="number" min="0" step="1" value={pts}
        onChange={(e) => setPts(e.target.value)} className="h-8 w-24" />
      <span className="text-[10px] text-muted-foreground">pts/mo</span>
      <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty || saving}
        onClick={() => onSave({ company_id: row.id, ai_free_monthly_points: Number(pts) || 0 })}>
        Save
      </Button>
      {used > 0 ? (
        <Button size="sm" variant="ghost" disabled={saving}
          onClick={() => onSave({ company_id: row.id, ai_free_monthly_points: Number(pts) || 0, reset_used: true })}
          title="Reset the used-this-period counter to zero">
          Reset used
        </Button>
      ) : null}
    </div>
  );
}
