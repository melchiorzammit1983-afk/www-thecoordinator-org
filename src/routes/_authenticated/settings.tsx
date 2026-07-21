import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, ChevronUp, ChevronDown, Eye, EyeOff, RotateCcw, Settings as SettingsIcon, Bot, LayoutGrid, Palette, Bell, User } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AI_TOGGLES, type AiToggleKey, type AiToggleCategory } from "@/lib/user-prefs.functions";
import { usePreferences, useUpdatePreferences, useResetPreferences } from "@/hooks/use-preferences";
import { useFeatures } from "@/hooks/use-features";
import { TAB_CATALOG, tabsByFeatureVisible, resolveMobileLayout } from "@/lib/tab-catalog";
import { TOGGLEABLE_FEATURES } from "@/lib/feature-descriptions";
import { useFeaturePrefs, useSetFeaturePref } from "@/hooks/use-feature-prefs";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAiFeatureCosts } from "@/lib/billing.functions";
import { useReferencePack } from "@/hooks/use-reference-rate";
import { formatPoints } from "@/lib/points-eur";
import { Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — The Coordinator" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const { prefs } = usePreferences();
  const update = useUpdatePreferences();
  const reset = useResetPreferences();

  const aiOffCount = Object.values(prefs.ai_toggles).filter((v) => v === false).length;
  const totalAi = AI_TOGGLES.length;
  const allAiOff = aiOffCount === totalAi;

  function toggleAll(off: boolean) {
    const next: Partial<Record<AiToggleKey, boolean>> = {};
    for (const t of AI_TOGGLES) next[t.key] = !off;
    update.mutate({ ai_toggles: next }, {
      onSuccess: () => toast.success(off ? "All AI features off" : "All AI features on"),
    });
  }

  function toggleOne(k: AiToggleKey, on: boolean) {
    update.mutate({ ai_toggles: { [k]: on } });
  }

  const byCat = useMemo(() => {
    const g: Record<AiToggleCategory, typeof AI_TOGGLES> = { background: [], ondemand: [], routing: [] };
    for (const t of AI_TOGGLES) g[t.category].push(t);
    return g;
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4 md:pt-8">
      <header className="mb-5 flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <SettingsIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-black">Settings</h1>
          <p className="text-xs text-muted-foreground">Personalize your app — saved to your account.</p>
        </div>
      </header>

      {/* Home screen section */}
      <Section title="Home screen" icon={LayoutGrid}>
        <Row
          leftIcon={LayoutGrid}
          title="Customize mobile layout"
          subtitle="Reorder or hide bottom tabs, choose your default screen"
          onClick={() => setLayoutOpen(true)}
          trailing={<ChevronRight className="h-4 w-4 text-muted-foreground" />}
        />
      </Section>

      {/* AI section */}
      <Section
        title="AI & automation"
        icon={Bot}
        action={
          <button
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => reset.mutate("ai", { onSuccess: () => toast.success("AI settings reset") })}
          >
            Reset
          </button>
        }
      >
        <Row
          leftIcon={Bot}
          title="Master switch"
          subtitle={aiOffCount === 0 ? "All AI features on" : `${aiOffCount}/${totalAi} disabled`}
          trailing={<Switch checked={!allAiOff} onCheckedChange={(v) => toggleAll(!v)} />}
        />
        <SubHeading>Background (automatic)</SubHeading>
        {byCat.background.map((t) => (
          <ToggleRow key={t.key} label={t.label} description={t.description}
            checked={prefs.ai_toggles[t.key] !== false}
            onChange={(v) => toggleOne(t.key, v)} />
        ))}
        <SubHeading>On-demand</SubHeading>
        {byCat.ondemand.map((t) => (
          <ToggleRow key={t.key} label={t.label} description={t.description}
            checked={prefs.ai_toggles[t.key] !== false}
            onChange={(v) => toggleOne(t.key, v)} />
        ))}
        <SubHeading>Live routing</SubHeading>
        {byCat.routing.map((t) => (
          <ToggleRow key={t.key} label={t.label} description={t.description}
            checked={prefs.ai_toggles[t.key] !== false}
            onChange={(v) => toggleOne(t.key, v)} />
        ))}
      </Section>

      {/* Per-feature opt-out — separate from the AI master switch */}
      <FeatureUsageSection />


      {/* Appearance */}
      <Section title="Appearance" icon={Palette}>
        <div className="px-4 py-3">
          <div className="text-sm font-medium">Theme</div>
          <RadioGroup
            className="mt-3 grid grid-cols-3 gap-2"
            value={prefs.theme}
            onValueChange={(v) => update.mutate({ theme: v as any })}
          >
            {(["system", "light", "dark"] as const).map((v) => (
              <label key={v} className={cn(
                "flex cursor-pointer items-center justify-center gap-2 rounded-lg border p-2 text-sm capitalize",
                prefs.theme === v ? "border-primary bg-primary/5" : "border-border",
              )}>
                <RadioGroupItem value={v} id={`theme-${v}`} className="sr-only" />
                <Label htmlFor={`theme-${v}`} className="cursor-pointer">{v}</Label>
              </label>
            ))}
          </RadioGroup>
        </div>
      </Section>

      {/* Notifications */}
      <Section title="Alerts" icon={Bell}>
        <ToggleRow label="Sound" description="Play a sound for new alerts"
          checked={prefs.sound_enabled} onChange={(v) => update.mutate({ sound_enabled: v })} />
        <ToggleRow label="Haptics" description="Vibrate on important events (mobile)"
          checked={prefs.haptics_enabled} onChange={(v) => update.mutate({ haptics_enabled: v })} />
      </Section>

      {/* Account */}
      <Section title="Account" icon={User}>
        <Row leftIcon={User} title="Billing & wallet" onClick={undefined}
          trailing={<Link to="/coordinator/billing" className="text-sm text-primary">Open</Link>} />
      </Section>

      <MobileLayoutSheet open={layoutOpen} onOpenChange={setLayoutOpen} />
    </div>
  );
}

// ---------------- Building blocks ----------------

function Section({ title, icon: Icon, action, children }: { title: string; icon: any; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </div>
        {action}
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card divide-y">{children}</div>
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <div className="bg-muted/30 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>;
}

function Row({ leftIcon: Icon, title, subtitle, trailing, onClick }: {
  leftIcon?: any; title: string; subtitle?: string; trailing?: React.ReactNode; onClick?: () => void;
}) {
  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left", onClick && "hover:bg-muted/50 active:bg-muted")}>
      {Icon && (
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {trailing}
    </Comp>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-1 shrink-0" />
    </div>
  );
}

// ---------------- Per-feature opt-out ----------------

function FeatureUsageSection() {
  const { prefs, isEnabled } = useFeaturePrefs();
  const setPref = useSetFeaturePref();
  const listCostsFn = useServerFn(listAiFeatureCosts);
  const { data: costs } = useQuery<Array<{ feature_key: string; points_cost: number | string; enabled?: boolean; is_addon?: boolean }>>({
    queryKey: ["ai-feature-costs"],
    queryFn: () => listCostsFn() as any,
    staleTime: 5 * 60_000,
  });
  const pack = useReferencePack();

  // Only surface features the admin has marked as an add-on AND left enabled.
  const visibleKeys = new Set(
    (costs ?? []).filter((c) => c.is_addon === true && c.enabled !== false).map((c) => c.feature_key),
  );

  const groups: Record<string, typeof TOGGLEABLE_FEATURES> = {};
  for (const f of TOGGLEABLE_FEATURES) {
    (groups[f.group] ||= []).push(f);
  }
  const groupOrder: Array<keyof typeof groups> = ["assistant", "extraction", "ops", "flights", "routing"];
  const groupLabels: Record<string, string> = {
    assistant: "Assistant", extraction: "Trip extraction", ops: "Automation",
    flights: "Flights & vessels", routing: "Live routing",
  };

  function costLabel(key: string): string {
    const c = (costs ?? []).find((r) => r.feature_key === key);
    if (!c) return "Free";
    const pts = Number(c.points_cost);
    if (!pts || pts <= 0) return "Free";
    return `${formatPoints(pts, pack)} per use`;
  }

  return (
    <Section title="Feature usage & cost" icon={Wallet} action={
      <span className="text-[10px] text-muted-foreground">Turn off features you don't want to pay for</span>
    }>
      {groupOrder.map((g) => {
        const items = groups[g];
        if (!items?.length) return null;
        return (
          <div key={g as string}>
            <SubHeading>{groupLabels[g as string] ?? String(g)}</SubHeading>
            {items.map((f) => (
              <div key={f.key} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="text-xs text-muted-foreground">{f.description}</div>
                  <div className="mt-1 text-[11px] font-medium text-foreground/70">{costLabel(f.key)}</div>
                </div>
                <Switch
                  className="mt-1 shrink-0"
                  checked={isEnabled(f.key)}
                  onCheckedChange={(v) => setPref.mutate(
                    { feature_key: f.key, enabled: v },
                    { onSuccess: () => toast.success(v ? `${f.label} enabled` : `${f.label} disabled`) },
                  )}
                />
              </div>
            ))}
          </div>
        );
      })}
    </Section>
  );
}



function MobileLayoutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { prefs } = usePreferences();
  const update = useUpdatePreferences();
  const reset = useResetPreferences();
  const { data: features } = useFeatures();

  const resolved = useMemo(
    () => resolveMobileLayout(prefs.home_layout as any, features),
    [prefs.home_layout, features],
  );

  const visible = useMemo(() => tabsByFeatureVisible(features), [features]);

  // Local editable state seeded from resolved layout
  const [bottomIds, setBottomIds] = useState<string[]>(resolved.bottom.map((t) => t.id));
  const [hidden, setHidden] = useState<Set<string>>(new Set(prefs.home_layout?.hidden_tabs ?? []));
  const [defaultTab, setDefaultTab] = useState<string>(resolved.defaultTabId);

  // Re-seed when sheet re-opens
  useMemo(() => {
    if (open) {
      setBottomIds(resolved.bottom.map((t) => t.id));
      setHidden(new Set(prefs.home_layout?.hidden_tabs ?? []));
      setDefaultTab(resolved.defaultTabId);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const catalog = new Map(visible.map((t) => [t.id, t] as const));

  function move(id: string, dir: -1 | 1) {
    setBottomIds((prev) => {
      const i = prev.indexOf(id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  function promote(id: string) {
    if (bottomIds.includes(id)) return;
    if (bottomIds.length >= 3) {
      toast.info("Only 3 tabs fit in the bottom bar — remove one first.");
      return;
    }
    setBottomIds((p) => [...p, id]);
  }

  function demote(id: string) {
    setBottomIds((p) => p.filter((x) => x !== id));
  }

  function toggleHidden(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else { next.add(id); }
      return next;
    });
    // If hiding a bottom tab, also demote
    setBottomIds((p) => (hidden.has(id) ? p : p.filter((x) => x !== id)));
  }

  function save() {
    update.mutate(
      {
        home_layout: {
          tabs: bottomIds,
          hidden_tabs: Array.from(hidden),
          default_tab: defaultTab,
        },
      },
      {
        onSuccess: () => {
          toast.success("Home screen updated");
          onOpenChange(false);
        },
      },
    );
  }

  const inMore = visible.filter((t) => !bottomIds.includes(t.id) && !hidden.has(t.id));
  const hiddenList = visible.filter((t) => hidden.has(t.id));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl pb-safe">
        <div className="mx-auto -mt-2 mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <SheetHeader className="text-left">
          <SheetTitle>Customize home screen</SheetTitle>
          <SheetDescription>Choose which tabs appear in the bottom bar and which screen opens first.</SheetDescription>
        </SheetHeader>

        {/* Default landing tab */}
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open on launch</div>
          <select
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            value={defaultTab}
            onChange={(e) => setDefaultTab(e.target.value)}
          >
            {visible.filter((t) => !hidden.has(t.id)).map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Bottom bar preview */}
        <div className="mt-5">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bottom bar ({bottomIds.length}/3)</div>
          <div className="rounded-2xl border bg-card">
            {bottomIds.length === 0 && (
              <p className="p-4 text-xs text-muted-foreground">Empty — add up to 3 tabs from below.</p>
            )}
            {bottomIds.map((id, i) => {
              const t = catalog.get(id);
              if (!t) return null;
              return (
                <div key={id} className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <t.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 truncate text-sm font-medium">{t.label}</div>
                  <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(id, -1)} aria-label="Move up">
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" disabled={i === bottomIds.length - 1} onClick={() => move(id, 1)} aria-label="Move down">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => demote(id)}>Move to More</Button>
                </div>
              );
            })}
          </div>
        </div>

        {/* In More */}
        <div className="mt-5">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">In More menu</div>
          <div className="grid grid-cols-1 gap-1.5">
            {inMore.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
                  <t.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 truncate text-sm">{t.label}</div>
                <Button size="sm" variant="outline" onClick={() => promote(t.id)}>Pin to bar</Button>
                <Button size="icon" variant="ghost" onClick={() => toggleHidden(t.id)} aria-label="Hide">
                  <EyeOff className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Hidden */}
        {hiddenList.length > 0 && (
          <div className="mt-5">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hidden</div>
            <div className="grid grid-cols-1 gap-1.5">
              {hiddenList.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-3 py-2">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted opacity-70">
                    <t.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t.label}</div>
                  <Button size="sm" variant="ghost" onClick={() => toggleHidden(t.id)}><Eye className="mr-1 h-4 w-4" /> Show</Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Presets */}
        <div className="mt-6">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Presets</div>
          <div className="flex flex-wrap gap-2">
            <PresetChip label="Default" onClick={() => { setBottomIds(["home", "dispatch", "ai"]); setDefaultTab("home"); setHidden(new Set()); }} />
            <PresetChip label="Dispatcher-first" onClick={() => { setBottomIds(["dispatch", "pending", "drivers"]); setDefaultTab("dispatch"); setHidden(new Set()); }} />
            <PresetChip label="AI-first" onClick={() => { setBottomIds(["ai", "home", "dispatch"]); setDefaultTab("ai"); setHidden(new Set()); }} />
            <PresetChip label="Driver-first" onClick={() => { setBottomIds(["my_driving", "home", "dispatch"]); setDefaultTab("my_driving"); setHidden(new Set()); }} />
          </div>
        </div>

        <div className="sticky bottom-0 -mx-6 mt-6 flex items-center gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur">
          <Button variant="ghost" size="sm" onClick={() => reset.mutate("layout", { onSuccess: () => { toast.success("Layout reset"); onOpenChange(false); } })}>
            <RotateCcw className="mr-1 h-4 w-4" /> Reset
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={update.isPending}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PresetChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted">
      {label}
    </button>
  );
}
