import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Sparkles, Wallet, ShieldAlert, Send } from "lucide-react";

import { listAiFeatureCosts } from "@/lib/billing.functions";
import { adminSetFeatureCost } from "@/lib/admin.functions";
import { getPortalSettings, updatePortalSettings, applyAiWalletDefaultsToAllCompanies } from "@/lib/portal.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/admin/ai-settings")({
  component: AiSettingsAdmin,
});

// The AI actions users trigger from Ask-the-Guide and related flows.
const AI_ACTIONS: Array<{ key: string; label: string; blurb: string }> = [
  { key: "ai_guide_chat",     label: "Guide chat",        blurb: "Each Ask-the-Guide question a user sends." },
  { key: "ai_explain_answer", label: "Explain this",      blurb: "In-context explanations (badges, statuses, glowing cards)." },
  { key: "ai_prompt_suggest", label: "Suggest a prompt",  blurb: "Auto-suggested prompts shown to the user." },
  { key: "ai_prompt_improve", label: "Improve my prompt", blurb: "Rewriting a user's prompt into a better one." },
  { key: "ai_bulk_clarify",   label: "Bulk clarify",      blurb: "Follow-up clarifying questions after a low-confidence answer." },
  { key: "ai_guide_escalate", label: "Escalate to admin", blurb: "Cost of raising a support ticket from Ask-the-Guide." },
];

function AiSettingsAdmin() {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> AI settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Set the point cost for each AI action. AI actions deduct from the general points balance.
        </p>
      </div>
      <ActionCostsCard />
    </div>
  );
}

// ---------------- Action costs ----------------

function ActionCostsCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAiFeatureCosts);
  const setFn  = useServerFn(adminSetFeatureCost);
  const { data: costs } = useQuery({ queryKey: ["ai-feature-costs"], queryFn: () => listFn() });
  const setMut = useMutation({
    mutationFn: (row: any) => setFn({ data: row }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["ai-feature-costs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const byKey = new Map<string, any>((costs ?? []).map((c: any) => [c.feature_key, c]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Points per AI action</CardTitle>
        <p className="text-xs text-muted-foreground">
          Deducted from a user's AI wallet each time the action runs. Set to 0 to make it free.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {AI_ACTIONS.map((a) => (
          <ActionRow
            key={a.key}
            meta={a}
            cost={byKey.get(a.key)}
            onSave={setMut.mutate}
            saving={setMut.isPending}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ActionRow({
  meta, cost, onSave, saving,
}: {
  meta: { key: string; label: string; blurb: string };
  cost: any;
  onSave: (r: any) => void;
  saving: boolean;
}) {
  const initialPts = Number(cost?.points_cost ?? 0);
  const initialEnabled = cost?.enabled !== false;
  const initialBlock = cost?.block_on_empty !== false;
  const [points, setPoints] = useState<number>(initialPts);
  const [enabled, setEnabled] = useState<boolean>(initialEnabled);
  const [block, setBlock] = useState<boolean>(initialBlock);

  useEffect(() => {
    setPoints(initialPts); setEnabled(initialEnabled); setBlock(initialBlock);
  }, [cost?.feature_key]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = points !== initialPts || enabled !== initialEnabled || block !== initialBlock;
  const sliderMax = Math.max(10, Math.ceil(Math.max(points, initialPts) * 1.5));

  return (
    <div className={`rounded-lg border bg-card p-4 flex flex-col gap-3 md:flex-row md:items-center ${dirty ? "ring-1 ring-primary/40" : ""}`}>
      <div className="md:w-64">
        <div className="text-sm font-semibold">{meta.label}</div>
        <div className="text-[11px] text-muted-foreground">{meta.blurb}</div>
        <div className="font-mono text-[10px] text-muted-foreground mt-1">{meta.key}</div>
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="text-2xl font-bold tabular-nums w-16 text-right">{points.toFixed(2)}</span>
        <span className="text-[10px] text-muted-foreground">pts</span>
        <div className="flex-1">
          <Slider value={[points]} min={0} max={sliderMax} step={0.25} onValueChange={(v) => setPoints(v[0] ?? 0)} />
        </div>
        <Input
          type="number" min="0" step="0.25"
          value={String(points)}
          onChange={(e) => setPoints(Number(e.target.value) || 0)}
          className="h-8 w-20"
        />
      </div>
      <div className="flex items-center gap-1.5 md:ml-3">
        <button type="button" onClick={() => setEnabled(!enabled)}>
          <Badge variant={enabled ? "default" : "outline"}>{enabled ? "Enabled" : "Disabled"}</Badge>
        </button>
        <button type="button" onClick={() => setBlock(!block)} title="What happens when wallet is empty">
          <Badge variant={block ? "destructive" : "secondary"}>{block ? "Hard stop" : "Allow negative"}</Badge>
        </button>
        <Button
          size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty || saving}
          onClick={() => onSave({
            feature_key: meta.key,
            points_cost: Number(points),
            label: cost?.label ?? meta.label,
            category: "ai",
            enabled,
            block_on_empty: block,
          })}
        >
          <Save className="h-4 w-4 mr-1" /> Save
        </Button>
      </div>
    </div>
  );
}



