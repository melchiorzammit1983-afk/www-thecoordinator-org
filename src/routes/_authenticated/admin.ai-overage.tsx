import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

import { getMyOverageSettings, updateGlobalOverageSettings } from "@/lib/ai-overage.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AdminAiHeaderTabs } from "@/components/admin/AdminAiHeaderTabs";

export const Route = createFileRoute("/_authenticated/admin/ai-overage")({
  component: Page,
});

function Page() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyOverageSettings);
  const saveFn = useServerFn(updateGlobalOverageSettings);

  const { data } = useQuery({ queryKey: ["ai-overage-me"], queryFn: () => getFn() });

  const [threshold, setThreshold] = useState<number>(1000);
  const [price, setPrice] = useState<number>(0.01);
  const [enabled, setEnabled] = useState<boolean>(true);

  useEffect(() => {
    if (!data?.global) return;
    setThreshold(Number(data.global.free_char_threshold));
    setPrice(Number(data.global.price_per_char));
    setEnabled(Boolean(data.global.enabled));
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({ data: { free_char_threshold: Math.round(threshold), price_per_char: Number(price), enabled } }),
    onSuccess: () => {
      toast.success("Platform default updated");
      qc.invalidateQueries({ queryKey: ["ai-overage-me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (data && !data.is_admin) {
    return <div className="p-6 text-sm text-muted-foreground">Admin only.</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <AdminAiHeaderTabs active="overage" />
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> AI long-message pricing (platform default)
        </h1>
        <p className="text-sm text-muted-foreground">
          Applies to every company that hasn't set its own override. Individual companies can raise or
          lower these values from their AI overage page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Global default</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="gov-enabled" />
            <Label htmlFor="gov-enabled">Overage billing enabled globally</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="gov-threshold">Free characters per message</Label>
              <Input
                id="gov-threshold"
                type="number"
                min={0}
                max={200000}
                step={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gov-price">Points per extra character</Label>
              <Input
                id="gov-price"
                type="number"
                min={0}
                max={100}
                step={0.001}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Example: 1000 extra chars ≈ {(price * 1000).toFixed(2)} pts.
              </p>
            </div>
          </div>
          <div className="pt-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              Save default
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
