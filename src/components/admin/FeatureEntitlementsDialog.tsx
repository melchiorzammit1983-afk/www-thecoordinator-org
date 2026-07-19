import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listFeatureEntitlements,
  setFeatureEntitlement,
  clearFeatureEntitlement,
  bulkSetFeatureEntitlements,
} from "@/lib/admin.functions";
import { AI_FEATURE_KEYS, type FeatureKey } from "@/lib/features";

type Row = {
  key: FeatureKey;
  label: string;
  description: string;
  enabled: boolean;
  expires_at: string | null;
  active: boolean;
  has_override: boolean;
};

type Duration = "permanent" | "1" | "7" | "30" | "custom";

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours}h left`;
  const days = Math.round(hours / 24);
  return `${days}d left`;
}

export function FeatureEntitlementsDialog({ company }: { company: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const listFn = useServerFn(listFeatureEntitlements);
  const setFn = useServerFn(setFeatureEntitlement);
  const clearFn = useServerFn(clearFeatureEntitlement);

  const { data, isLoading } = useQuery({
    queryKey: ["feature-entitlements", company.id],
    queryFn: () => listFn({ data: { company_id: company.id } }) as Promise<Row[]>,
    enabled: open,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["feature-entitlements", company.id] });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8">
          <Settings2 className="h-3.5 w-3.5 mr-1" /> Features
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Features — {company.name}</DialogTitle>
          <DialogDescription>
            Toggle features per coordinator. Set a duration for temporary access; leave as Permanent for no expiry. Features default to enabled.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6 divide-y">
          {isLoading || !data ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            data.map((row) => (
              <FeatureRow
                key={row.key}
                row={row}
                onSave={async (enabled, durationDays) => {
                  await setFn({ data: { company_id: company.id, feature: row.key, enabled, duration_days: durationDays } });
                  toast.success(`${row.label} updated`);
                  invalidate();
                }}
                onReset={async () => {
                  await clearFn({ data: { company_id: company.id, feature: row.key } });
                  toast.success(`${row.label} reset to default`);
                  invalidate();
                }}
              />
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FeatureRow({
  row,
  onSave,
  onReset,
}: {
  row: Row;
  onSave: (enabled: boolean, durationDays: number | null) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(row.enabled);
  const [duration, setDuration] = useState<Duration>(() => {
    if (!row.expires_at) return "permanent";
    const days = Math.max(1, Math.round((new Date(row.expires_at).getTime() - Date.now()) / 86400_000));
    if (days === 1) return "1";
    if (days === 7) return "7";
    if (days === 30) return "30";
    return "custom";
  });
  const [customDays, setCustomDays] = useState<string>(() => {
    if (!row.expires_at) return "14";
    const days = Math.max(1, Math.round((new Date(row.expires_at).getTime() - Date.now()) / 86400_000));
    return String(days);
  });

  useEffect(() => { setEnabled(row.enabled); }, [row.enabled]);

  const saveMut = useMutation({
    mutationFn: () => {
      let days: number | null = null;
      if (duration === "1") days = 1;
      else if (duration === "7") days = 7;
      else if (duration === "30") days = 30;
      else if (duration === "custom") {
        const parsed = parseInt(customDays, 10);
        if (!parsed || parsed < 1) throw new Error("Enter a valid number of days");
        days = parsed;
      }
      return onSave(enabled, days);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({ mutationFn: onReset });

  const expiry = formatExpiry(row.expires_at);

  return (
    <div className="py-3 flex flex-col md:flex-row md:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm">{row.label}</div>
          {!row.active ? (
            <Badge variant="destructive" className="text-[10px]">Off</Badge>
          ) : row.has_override ? (
            <Badge variant="secondary" className="text-[10px]">Custom</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">Default on</Badge>
          )}
          {expiry ? <Badge variant="outline" className="text-[10px]">{expiry}</Badge> : null}
        </div>
        <div className="text-xs text-muted-foreground">{row.description}</div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Switch checked={enabled} onCheckedChange={setEnabled} />
        <Select value={duration} onValueChange={(v) => setDuration(v as Duration)}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="permanent">Permanent</SelectItem>
            <SelectItem value="1">1 day</SelectItem>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="custom">Custom…</SelectItem>
          </SelectContent>
        </Select>
        {duration === "custom" ? (
          <Input
            type="number" min={1} max={3650}
            className="h-8 w-20"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
          />
        ) : null}
        <Button size="sm" className="h-8" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending ? "…" : "Save"}
        </Button>
        {row.has_override ? (
          <Button size="sm" variant="ghost" className="h-8" onClick={() => resetMut.mutate()} disabled={resetMut.isPending}>
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
