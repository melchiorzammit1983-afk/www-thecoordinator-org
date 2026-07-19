import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

import {
  getMyOverageSettings,
  upsertCompanyOverageSettings,
  clearCompanyOverageSettings,
} from "@/lib/ai-overage.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/coordinator/ai-overage")({
  component: Page,
});

function Page() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyOverageSettings);
  const saveFn = useServerFn(upsertCompanyOverageSettings);
  const clearFn = useServerFn(clearCompanyOverageSettings);

  const { data } = useQuery({ queryKey: ["ai-overage-me"], queryFn: () => getFn() });

  const [threshold, setThreshold] = useState<number>(1000);
  const [price, setPrice] = useState<number>(0.01);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [hasOverride, setHasOverride] = useState<boolean>(false);

  useEffect(() => {
    if (!data) return;
    const base = data.company ?? data.effective;
    setThreshold(Number(base.free_char_threshold));
    setPrice(Number(base.price_per_char));
    setEnabled(Boolean(base.enabled));
    setHasOverride(Boolean(data.company));
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({ data: { free_char_threshold: Math.round(threshold), price_per_char: Number(price), enabled } }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["ai-overage-me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMut = useMutation({
    mutationFn: () => clearFn({} as never),
    onSuccess: () => {
      toast.success("Using platform default");
      qc.invalidateQueries({ queryKey: ["ai-overage-me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const global = data?.global;
  const effective = data?.effective;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> AI long-message pricing
        </h1>
        <p className="text-sm text-muted-foreground">
          Set how many characters your team can send to the AI for free, and what each extra character costs.
          Anything past the free amount is deducted from your points balance.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Your company override</span>
            {hasOverride ? <Badge>Active</Badge> : <Badge variant="secondary">Using platform default</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="ov-enabled" />
            <Label htmlFor="ov-enabled">Enable overage billing (off = always truncate to the free limit)</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ov-threshold">Free characters per message</Label>
              <Input
                id="ov-threshold"
                type="number"
                min={0}
                max={200000}
                step={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Includes recent conversation sent with each message.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-price">Points per extra character</Label>
              <Input
                id="ov-price"
                type="number"
                min={0}
                max={100}
                step={0.001}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Example: {price ? `1000 extra chars ≈ ${(price * 1000).toFixed(2)} pts` : "set a price to see an example"}.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {hasOverride ? "Save override" : "Set company override"}
            </Button>
            {hasOverride && (
              <Button variant="outline" onClick={() => clearMut.mutate()} disabled={clearMut.isPending}>
                Reset to platform default
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Currently applied</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <div>
            Source: <b>{effective?.source ?? "default"}</b>
          </div>
          <div>Free chars: <b>{effective?.free_char_threshold ?? 1000}</b></div>
          <div>Price per extra char: <b>{effective?.price_per_char ?? 0.01} pts</b></div>
          <div>Enabled: <b>{effective?.enabled ? "yes" : "no"}</b></div>
          {global && (
            <div className="pt-3 text-xs text-muted-foreground">
              Platform default → {global.free_char_threshold} free chars, {global.price_per_char} pts / extra char,
              {global.enabled ? " enabled" : " disabled"}.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
