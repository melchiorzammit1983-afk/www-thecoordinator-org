import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DollarSign, RefreshCw, Save, Trash2, Building2, User, Wrench, Cpu } from "lucide-react";

import {
  adminGetAiCostSummary,
  adminListRecentAiCalls,
  adminListModelRates,
  adminUpsertModelRate,
  adminDeleteModelRate,
} from "@/lib/ai-cost-admin.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AdminAiHeaderTabs } from "@/components/admin/AdminAiHeaderTabs";

export const Route = createFileRoute("/_authenticated/admin/ai-costs")({
  component: AiCostsAdmin,
});

const fmtUsd = (cents: number) => `$${(cents / 100).toFixed(4)}`;
const fmtNum = (n: number) => n.toLocaleString();
const fmtCredits = (n: number) => n.toFixed(2);

function AiCostsAdmin() {
  const [days, setDays] = useState(7);
  const getSummary = useServerFn(adminGetAiCostSummary);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ai-cost-summary", days],
    queryFn: () => getSummary({ data: { days } }),
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" /> Real AI cost vs points charged
          </h1>
          <p className="text-sm text-muted-foreground">
            Actual Lovable AI Gateway spend per model call, computed from real token usage × your per-model rate table.
            Compare against the system points you charged the company to see margin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[1, 7, 30].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
              {d === 1 ? "24h" : `${d}d`}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      <AdminAiHeaderTabs active="costs" />

      <TotalsCard summary={data ?? undefined} loading={isLoading} />

      <div className="grid md:grid-cols-2 gap-4">
        <BreakdownCard
          title="By company"
          icon={Building2}
          rows={(data?.by_company ?? []).slice(0, 15).map((r) => ({
            key: r.company_id ?? "none",
            label: r.company_name ?? "(no company)",
            calls: r.calls,
            usdCents: r.real_cost_usd_cents,
            credits: r.real_cost_credits,
            points: r.points_charged,
          }))}
        />
        <BreakdownCard
          title="By feature"
          icon={Wrench}
          rows={(data?.by_feature ?? []).map((r) => ({
            key: r.feature_key,
            label: r.feature_key,
            calls: r.calls,
            usdCents: r.real_cost_usd_cents,
            credits: r.real_cost_credits,
            points: r.points_charged,
          }))}
        />
        <BreakdownCard
          title="By coordinator"
          icon={User}
          rows={(data?.by_user ?? []).slice(0, 15).map((r) => ({
            key: r.actor_user_id ?? "none",
            label: r.email ?? (r.actor_user_id ? r.actor_user_id.slice(0, 8) : "(system)"),
            calls: r.calls,
            usdCents: r.real_cost_usd_cents,
            credits: r.real_cost_credits,
            points: r.points_charged,
          }))}
        />
        <ModelUsageCard rows={data?.by_model ?? []} />
      </div>

      <RecentCallsCard />
      <ModelRatesCard />
    </div>
  );
}

function TotalsCard({ summary, loading }: { summary?: Awaited<ReturnType<typeof adminGetAiCostSummary>>; loading: boolean }) {
  const t = summary?.totals;
  const marginPct = t && t.real_cost_credits > 0 ? ((t.points_charged - t.real_cost_credits) / t.real_cost_credits) * 100 : 0;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Totals</CardTitle>
      </CardHeader>
      <CardContent>
        {loading || !t ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
            <Metric label="AI calls" value={fmtNum(t.calls)} />
            <Metric label="Input tokens" value={fmtNum(t.input_tokens)} />
            <Metric label="Output tokens" value={fmtNum(t.output_tokens)} />
            <Metric label="Real cost (USD)" value={fmtUsd(t.real_cost_usd_cents)} />
            <Metric label="Real cost (Lovable credits)" value={fmtCredits(t.real_cost_credits)} />
            <Metric
              label="Points charged"
              value={fmtCredits(t.points_charged)}
              hint={t.real_cost_credits > 0 ? `${marginPct >= 0 ? "+" : ""}${marginPct.toFixed(0)}% vs cost` : ""}
              hintClass={marginPct >= 0 ? "text-emerald-600" : "text-red-600"}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint, hintClass }: { label: string; value: string; hint?: string; hintClass?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold text-lg tabular-nums">{value}</div>
      {hint ? <div className={`text-[11px] ${hintClass ?? "text-muted-foreground"}`}>{hint}</div> : null}
    </div>
  );
}

type BreakdownRow = { key: string; label: string; calls: number; usdCents: number; credits: number; points: number };

function BreakdownCard({ title, icon: Icon, rows }: { title: string; icon: typeof Building2; rows: BreakdownRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Icon className="h-4 w-4" /> {title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4">No data.</div>
        ) : (
          <div className="divide-y">
            {rows.map((r) => {
              const margin = r.points - r.credits;
              return (
                <div key={r.key} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <div className="flex-1 truncate">
                    <div className="font-medium truncate">{r.label}</div>
                    <div className="text-[11px] text-muted-foreground">{r.calls} calls</div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div>{fmtUsd(r.usdCents)}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtCredits(r.credits)} credits</div>
                  </div>
                  <div className="text-right tabular-nums w-24">
                    <div>{fmtCredits(r.points)} pts</div>
                    <div className={`text-[11px] ${margin >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {margin >= 0 ? "+" : ""}{fmtCredits(margin)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ModelUsageCard({ rows }: { rows: Awaited<ReturnType<typeof adminGetAiCostSummary>>["by_model"] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Cpu className="h-4 w-4" /> By model</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4">No data.</div>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.model ?? "none"} className="flex items-center gap-3 px-4 py-2 text-sm">
                <div className="flex-1 truncate">
                  <div className="font-medium truncate">{r.model ?? "(unknown)"}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtNum(r.calls)} calls · {fmtNum(r.input_tokens)} in · {fmtNum(r.output_tokens)} out</div>
                </div>
                <div className="text-right tabular-nums">{fmtUsd(r.real_cost_usd_cents)}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentCallsCard() {
  const listFn = useServerFn(adminListRecentAiCalls);
  const { data: rows, refetch, isFetching } = useQuery({
    queryKey: ["ai-recent-calls"],
    queryFn: () => listFn({ data: { limit: 50 } }),
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Recent calls (last 50)</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {!rows?.length ? (
          <div className="text-sm text-muted-foreground p-4">No calls recorded yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Feature</th>
                <th className="text-left px-3 py-2">Model</th>
                <th className="text-right px-3 py-2">In</th>
                <th className="text-right px-3 py-2">Out</th>
                <th className="text-right px-3 py-2">Real USD</th>
                <th className="text-right px-3 py-2">Real credits</th>
                <th className="text-right px-3 py-2">Points</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-1.5"><Badge variant="outline" className="text-[10px]">{r.feature_key}</Badge></td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.model ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.input_tokens}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.output_tokens}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtUsd(Number(r.real_cost_usd_cents))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtCredits(Number(r.real_cost_credits))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtCredits(Number(r.points_charged))}</td>
                  <td className="px-3 py-1.5">
                    <span className={r.status === "ok" ? "text-emerald-600" : "text-red-600"}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function ModelRatesCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListModelRates);
  const upsertFn = useServerFn(adminUpsertModelRate);
  const delFn = useServerFn(adminDeleteModelRate);
  const { data: rates } = useQuery({ queryKey: ["ai-model-rates"], queryFn: () => listFn() });

  const upsert = useMutation({
    mutationFn: (row: { model: string; input_usd_per_1m: number; output_usd_per_1m: number; credits_per_usd: number; notes?: string | null }) =>
      upsertFn({ data: row }),
    onSuccess: () => { toast.success("Rate saved"); qc.invalidateQueries({ queryKey: ["ai-model-rates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["ai-model-rates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [draft, setDraft] = useState({ model: "", input: "0", output: "0", credits: "100", notes: "" });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Model price table</CardTitle>
        <p className="text-xs text-muted-foreground">
          Real cost = <code>tokens × USD/1M</code>. Lovable credits = <code>USD × credits/USD</code>. Keep these in sync with the current Lovable AI pricing so margin numbers stay accurate.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {(rates ?? []).map((r) => (
          <RateRow key={r.id} row={r} onSave={(patch) => upsert.mutate({ model: r.model, ...patch })} onDelete={() => del.mutate(r.id)} saving={upsert.isPending || del.isPending} />
        ))}
        <div className="border-t pt-3">
          <div className="text-xs text-muted-foreground mb-2">Add / override a model</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <div className="col-span-2">
              <label className="text-[10px] text-muted-foreground">Model id</label>
              <Input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="google/gemini-3.5-flash" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">In $/1M</label>
              <Input value={draft.input} onChange={(e) => setDraft({ ...draft, input: e.target.value })} type="number" step="0.0001" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Out $/1M</label>
              <Input value={draft.output} onChange={(e) => setDraft({ ...draft, output: e.target.value })} type="number" step="0.0001" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Credits/$</label>
              <Input value={draft.credits} onChange={(e) => setDraft({ ...draft, credits: e.target.value })} type="number" step="0.01" />
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (!draft.model.trim()) { toast.error("Model id required"); return; }
                upsert.mutate({
                  model: draft.model.trim(),
                  input_usd_per_1m: Number(draft.input) || 0,
                  output_usd_per_1m: Number(draft.output) || 0,
                  credits_per_usd: Number(draft.credits) || 100,
                  notes: draft.notes || null,
                });
                setDraft({ model: "", input: "0", output: "0", credits: "100", notes: "" });
              }}
              disabled={upsert.isPending}
            >
              <Save className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RateRow({ row, onSave, onDelete, saving }: {
  row: { id: string; model: string; input_usd_per_1m: number; output_usd_per_1m: number; credits_per_usd: number; notes: string | null };
  onSave: (patch: { input_usd_per_1m: number; output_usd_per_1m: number; credits_per_usd: number; notes: string | null }) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [input, setInput] = useState(String(row.input_usd_per_1m));
  const [output, setOutput] = useState(String(row.output_usd_per_1m));
  const [credits, setCredits] = useState(String(row.credits_per_usd));
  const [notes, setNotes] = useState(row.notes ?? "");
  const dirty = useMemo(
    () => Number(input) !== Number(row.input_usd_per_1m) || Number(output) !== Number(row.output_usd_per_1m) || Number(credits) !== Number(row.credits_per_usd) || (notes || null) !== row.notes,
    [input, output, credits, notes, row],
  );
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end border rounded-md p-2">
      <div className="col-span-2">
        <div className="text-sm font-medium truncate">{row.model}</div>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="mt-1 text-xs" />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">In $/1M</label>
        <Input value={input} onChange={(e) => setInput(e.target.value)} type="number" step="0.0001" />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">Out $/1M</label>
        <Input value={output} onChange={(e) => setOutput(e.target.value)} type="number" step="0.0001" />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">Credits/$</label>
        <Input value={credits} onChange={(e) => setCredits(e.target.value)} type="number" step="0.01" />
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || saving}
          onClick={() => onSave({
            input_usd_per_1m: Number(input) || 0,
            output_usd_per_1m: Number(output) || 0,
            credits_per_usd: Number(credits) || 100,
            notes: notes || null,
          })}
        >
          <Save className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} disabled={saving}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
