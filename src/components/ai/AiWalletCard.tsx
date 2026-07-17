import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Wallet, AlertTriangle, ArrowRightLeft } from "lucide-react";
import {
  allocateToAiWallet,
  getMyAiWallet,
  setMyAiFallback,
  setMyAiMonthlyCap,
} from "@/lib/ai-wallet.functions";

export function AiWalletCard() {
  const qc = useQueryClient();
  const getWallet = useServerFn(getMyAiWallet);
  const allocFn = useServerFn(allocateToAiWallet);
  const capFn = useServerFn(setMyAiMonthlyCap);
  const fbFn = useServerFn(setMyAiFallback);

  const { data: w, isLoading } = useQuery({
    queryKey: ["ai-wallet"],
    queryFn: () => getWallet(),
    staleTime: 30_000,
  });

  const [amount, setAmount] = useState("");
  const [capInput, setCapInput] = useState("");

  const allocate = useMutation({
    mutationFn: async () => allocFn({ data: { amount: Number(amount) } }),
    onSuccess: () => {
      toast.success(`Moved ${amount} points to AI wallet`);
      setAmount("");
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
      qc.invalidateQueries({ queryKey: ["my-billing"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to allocate"),
  });

  const saveCap = useMutation({
    mutationFn: async () => {
      const parsed = capInput.trim() === "" ? null : Number(capInput);
      return capFn({ data: { cap: parsed } });
    },
    onSuccess: () => {
      toast.success("Monthly cap updated");
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed"),
  });

  const toggleFb = useMutation({
    mutationFn: async (enabled: boolean) => fbFn({ data: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-wallet"] }),
    onError: (e: Error) => toast.error(e.message || "Failed"),
  });

  if (isLoading) return null;
  if (!w) return null;

  const capValue = capInput === "" && w.ai_monthly_cap != null ? String(w.ai_monthly_cap) : capInput;

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> AI Points Wallet
          {w.low_balance && (
            <Badge variant="destructive" className="ml-2 gap-1">
              <AlertTriangle className="h-3 w-3" /> Low balance
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Plan AI included" value={`${w.subscription_ai_remaining} / ${w.subscription_ai_included}`} sub="Resets monthly" />
          <Stat label="Wallet balance" value={w.ai_points_balance.toLocaleString()} sub="Admin grants + top-ups" />
          <Stat
            label="Total available"
            value={w.total_available.toLocaleString()}
            sub={w.ai_fallback_to_general ? "Includes general fallback" : "AI-only sources"}
            highlight
          />
        </div>

        {w.ai_monthly_cap != null && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Monthly usage vs cap</span>
              <span>{w.ai_points_used_this_period} / {w.ai_monthly_cap}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full transition-all ${(w.cap_percent_used ?? 0) > 80 ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${w.cap_percent_used ?? 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border p-3 space-y-2">
            <Label className="flex items-center gap-2 text-sm">
              <ArrowRightLeft className="h-3.5 w-3.5" /> Move general → AI
            </Label>
            <p className="text-xs text-muted-foreground">
              You have <strong>{w.general_points_balance.toLocaleString()}</strong> general points.
            </p>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Points to allocate"
              />
              <Button
                onClick={() => allocate.mutate()}
                disabled={!amount || Number(amount) <= 0 || Number(amount) > w.general_points_balance || allocate.isPending}
              >
                Move
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <div className="space-y-2">
              <Label className="text-sm flex items-center gap-2">
                <Wallet className="h-3.5 w-3.5" /> Monthly AI spending cap
              </Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  value={capValue}
                  onChange={(e) => setCapInput(e.target.value)}
                  placeholder="No cap"
                />
                <Button variant="outline" onClick={() => saveCap.mutate()} disabled={saveCap.isPending}>
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave empty for no cap. AI actions block once this is reached this month.
              </p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <div>
                <Label className="text-sm">Fallback to general points</Label>
                <p className="text-xs text-muted-foreground">
                  If AI wallet empties, keep AI running by using general points.
                </p>
              </div>
              <Switch
                checked={w.ai_fallback_to_general}
                onCheckedChange={(v) => toggleFb.mutate(v)}
                disabled={toggleFb.isPending}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "bg-primary/5 border-primary/30" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
