/**
 * AI Watchtower control — opt-in, points-metered background scanner.
 *
 * Off by default. When on, ticks on the user's chosen interval and calls
 * `runWatchtowerScan`. Each scan charges `ai_watchtower_scan` points; a
 * daily cap plus auto-pause on insufficient points keeps spend predictable.
 * Shows the most recent alerts inside the popover with dismiss actions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell, Eye, Loader2, ShieldAlert, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  acknowledgeWatchtowerAlert,
  getWatchtowerSettings,
  listWatchtowerAlerts,
  runWatchtowerScan,
  saveWatchtowerSettings,
  type WatchKind,
} from "@/lib/watchtower.functions";

const INTERVAL_OPTIONS = [
  { value: 120, label: "Every 2 min" },
  { value: 300, label: "Every 5 min" },
  { value: 900, label: "Every 15 min" },
];

const KIND_META: { key: WatchKind; label: string; hint: string }[] = [
  { key: "flight", label: "Flight & vessel", hint: "Delays, cancellations, diversions" },
  { key: "execution", label: "Trip execution", hint: "Driver late, stalled, over-wait" },
  { key: "conflict", label: "Driver workload", hint: "Schedule collisions & imbalance" },
  { key: "data", label: "Data problems", hint: "Missing addresses, invalid fields" },
];

const SEV_LABELS: Record<number, string> = {
  1: "Chatty",
  2: "Balanced",
  3: "Important only",
  4: "Serious only",
  5: "Critical only",
};

export function WatchtowerToggle() {
  const qc = useQueryClient();
  const getSettings = useServerFn(getWatchtowerSettings);
  const saveSettingsFn = useServerFn(saveWatchtowerSettings);
  const runScan = useServerFn(runWatchtowerScan);
  const listAlerts = useServerFn(listWatchtowerAlerts);
  const ackAlert = useServerFn(acknowledgeWatchtowerAlert);

  const { data: settingsData, refetch: refetchSettings } = useQuery({
    queryKey: ["watchtower-settings"],
    queryFn: () => getSettings(),
  });
  const { data: alertsData, refetch: refetchAlerts } = useQuery({
    queryKey: ["watchtower-alerts"],
    queryFn: () => listAlerts(),
    refetchInterval: 30_000,
  });

  const settings = settingsData?.settings;
  const pointsPerScan = settingsData?.points_per_scan ?? 1;
  const alerts = (alertsData?.alerts ?? []) as any[];
  const unread = alerts.filter((a) => a.status === "new").length;

  const [running, setRunning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<number | null>(null);

  const enabled = !!settings?.enabled;
  const intervalSec = settings?.interval_sec ?? 300;

  const scan = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const r = (await runScan()) as any;
      if (r?.ok) {
        qc.invalidateQueries({ queryKey: ["watchtower-alerts"] });
        qc.invalidateQueries({ queryKey: ["watchtower-settings"] });
        if (r.new_alerts > 0) {
          toast(`Watchtower found ${r.new_alerts} new issue${r.new_alerts === 1 ? "" : "s"}`);
        }
      } else if (r?.reason === "insufficient_points") {
        toast.error("Watchtower paused — not enough points. Top up to resume.");
        refetchSettings();
      } else if (r?.reason === "daily_cap_reached") {
        toast("Watchtower daily scan cap reached — pausing until tomorrow.");
      }
    } catch (e: any) {
      toast.error(`Watchtower scan failed: ${e?.message ?? "unknown"}`);
    } finally {
      setRunning(false);
    }
  }, [running, runScan, qc, refetchSettings]);

  // Interval ticker
  useEffect(() => {
    if (!enabled) {
      setCountdown(0);
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    setCountdown(intervalSec);
    scan(); // fire immediately on enable / interval change
    timerRef.current = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setCountdown((c) => {
        if (c <= 1) {
          scan();
          return intervalSec;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalSec]);

  async function save(patch: Record<string, unknown>) {
    await saveSettingsFn({ data: patch });
    refetchSettings();
  }

  const scansToday = settings?.scans_today ?? 0;
  const dailyCap = settings?.daily_scan_cap ?? 200;
  const pointsPerHour = useMemo(
    () => Math.round((3600 / intervalSec) * pointsPerScan),
    [intervalSec, pointsPerScan],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={enabled ? "default" : "outline"}
          className="h-8 gap-1.5 relative"
          title="AI Watchtower"
        >
          {enabled ? (
            <>
              <ShieldAlert className="h-3.5 w-3.5" />
              <span className="text-xs">Watching · {countdown}s</span>
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" />
              <span className="text-xs">AI Watch</span>
            </>
          )}
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold px-1 flex items-center justify-center">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0 max-h-[80vh] overflow-y-auto">
        <div className="p-3 border-b flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <ShieldAlert className="h-4 w-4 text-primary" />
              AI Watchtower
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Background scans that flag issues before they hurt trips.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => save({ enabled: v })}
          />
        </div>

        {/* Cost banner */}
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border-b flex items-start gap-2">
          <Zap className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-[11px] leading-snug">
            <b>{pointsPerScan} point{pointsPerScan === 1 ? "" : "s"}</b> per scan · ~<b>{pointsPerHour}</b> pts/hour at current interval.
            <br />
            Today: <b>{scansToday}</b> / {dailyCap} scans.
          </div>
        </div>

        {/* Controls */}
        <div className={cn("p-3 space-y-3", !enabled && "opacity-50 pointer-events-none")}>
          <div>
            <Label className="text-[11px]">Scan interval</Label>
            <Select
              value={String(intervalSec)}
              onValueChange={(v) => save({ interval_sec: Number(v) })}
            >
              <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-[11px]">Alert level</Label>
              <span className="text-[10px] text-muted-foreground">
                {SEV_LABELS[settings?.severity_min ?? 2]}
              </span>
            </div>
            <Slider
              className="mt-2"
              min={1}
              max={5}
              step={1}
              value={[settings?.severity_min ?? 2]}
              onValueChange={([v]) => save({ severity_min: v })}
            />
          </div>

          <div>
            <Label className="text-[11px]">Watch for</Label>
            <div className="mt-1.5 space-y-1.5">
              {KIND_META.map((k) => {
                const on = (settings?.kinds ?? []).includes(k.key);
                return (
                  <label key={k.key} className="flex items-start gap-2 text-[11px] cursor-pointer">
                    <Checkbox
                      className="mt-0.5"
                      checked={on}
                      onCheckedChange={(v) => {
                        const next = new Set<WatchKind>((settings?.kinds ?? []) as WatchKind[]);
                        if (v) next.add(k.key); else next.delete(k.key);
                        save({ kinds: Array.from(next) });
                      }}
                    />
                    <span>
                      <span className="font-medium">{k.label}</span>
                      <span className="block text-muted-foreground">{k.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="w-full h-8"
            onClick={scan}
            disabled={running}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
            Scan now
          </Button>
        </div>

        {/* Alerts list */}
        <div className="border-t">
          <div className="p-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <Bell className="h-3 w-3" />
              Alerts
              {unread > 0 && (
                <span className="rounded-full bg-red-500/15 text-red-600 px-1.5 py-0.5 text-[10px]">
                  {unread} new
                </span>
              )}
            </div>
          </div>
          {alerts.length === 0 ? (
            <p className="px-3 pb-3 text-[11px] text-muted-foreground">
              {enabled ? "All quiet. Scanning…" : "Turn on the Watchtower to start receiving alerts."}
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y">
              {alerts.map((a: any) => (
                <div key={a.id} className="p-2.5 flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-1 h-2 w-2 rounded-full shrink-0",
                      a.severity >= 4 ? "bg-red-500" : a.severity >= 3 ? "bg-amber-500" : "bg-blue-500",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium leading-tight">{a.title}</div>
                    {a.body && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{a.body}</p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    onClick={async () => {
                      await ackAlert({ data: { id: a.id, status: "dismissed" } });
                      refetchAlerts();
                    }}
                    title="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
