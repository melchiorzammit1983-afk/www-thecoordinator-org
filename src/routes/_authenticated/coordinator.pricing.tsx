/**
 * Coordinator pricing settings. Four tabs:
 *   - Base rates: currency, per-km, per-hour, minimum fare.
 *   - Waiting time: free window + rate per minute (applies across the company).
 *   - Service areas: per-area rate cards (base, per-km, per-hour, minimum,
 *     optional area-specific waiting policy).
 *   - Driver defaults: what the system pays drivers by default (per-km,
 *     per-hour, waiting share, commission %). Per-driver overrides live on
 *     the Drivers page.
 *
 * All writes go through server functions scoped to the caller's owned company.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  getPricingSettings, updatePricingSettings,
  listServiceAreas, upsertServiceArea, deleteServiceArea,
} from "@/lib/pricing.functions";
import { Calculator } from "lucide-react";
import { computeFareBreakdown } from "@/lib/fare";
import { FareBreakdownView } from "@/components/pricing/FareBreakdown";


export const Route = createFileRoute("/_authenticated/coordinator/pricing")({
  head: () => ({ meta: [{ title: "Pricing — Coordinator" }] }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set how the system quotes trips, charges for waiting time, and pays your drivers.
          Areas override the base rates; a driver's own rates override the defaults.
        </p>
      </header>
      <Tabs defaultValue="rates">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="rates">Base rates</TabsTrigger>
          <TabsTrigger value="wait">Waiting time</TabsTrigger>
          <TabsTrigger value="areas">Service areas</TabsTrigger>
          <TabsTrigger value="drivers">Driver defaults</TabsTrigger>
          <TabsTrigger value="preview">Price preview</TabsTrigger>
        </TabsList>
        <TabsContent value="rates" className="mt-4"><BaseRatesTab /></TabsContent>
        <TabsContent value="wait" className="mt-4"><WaitingTab /></TabsContent>
        <TabsContent value="areas" className="mt-4"><AreasTab /></TabsContent>
        <TabsContent value="drivers" className="mt-4"><DriverDefaultsTab /></TabsContent>
        <TabsContent value="preview" className="mt-4"><PricePreviewTab /></TabsContent>
      </Tabs>

    </div>
  );
}

// ---------- shared settings hook ----------
function useSettings() {
  const getFn = useServerFn(getPricingSettings);
  const q = useQuery({ queryKey: ["pricing", "settings"], queryFn: () => getFn() as Promise<any> });
  const qc = useQueryClient();
  const setFn = useServerFn(updatePricingSettings);
  const save = useMutation({
    mutationFn: (patch: any) => setFn({ data: patch }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["pricing", "settings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: q.data ?? {}, save };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumInput({ value, onChange, step = "0.01" }: { value: number | null | undefined; onChange: (v: number) => void; step?: string }) {
  return (
    <Input
      type="number"
      min={0}
      step={step}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
    />
  );
}

// ---------- Base rates ----------
function BaseRatesTab() {
  const { data, save } = useSettings();
  const [form, setForm] = useState<any>({});
  useEffect(() => { setForm({
    currency: data.currency ?? "EUR",
    price_per_km: data.price_per_km ?? 0,
    price_per_hour: data.price_per_hour ?? 0,
    minimum_fare: data.minimum_fare ?? 0,
  }); }, [data]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Base transport rates</CardTitle>
        <CardDescription>Used for AI quotes and any trip that doesn't fall inside a service area.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Currency" hint="3-letter code, e.g. EUR, USD, GBP.">
          <Input maxLength={3} value={form.currency ?? ""} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Minimum fare">
          <NumInput value={form.minimum_fare} onChange={(v) => setForm({ ...form, minimum_fare: v })} />
        </Field>
        <Field label={`Price per km (${form.currency ?? ""})`}>
          <NumInput value={form.price_per_km} onChange={(v) => setForm({ ...form, price_per_km: v })} />
        </Field>
        <Field label={`Price per hour (${form.currency ?? ""})`} hint="Used for hourly hires and long waits.">
          <NumInput value={form.price_per_hour} onChange={(v) => setForm({ ...form, price_per_hour: v })} />
        </Field>
        <div className="sm:col-span-2 flex justify-end">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            <Save className="h-4 w-4 mr-1" /> Save rates
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Waiting time ----------
function WaitingTab() {
  const { data, save } = useSettings();
  const [form, setForm] = useState<any>({});
  useEffect(() => { setForm({
    free_wait_minutes: data.free_wait_minutes ?? 5,
    waiting_rate_per_minute: data.waiting_rate_per_minute ?? 0,
  }); }, [data]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Waiting time policy</CardTitle>
        <CardDescription>
          Free window starts from the trip pickup time (not the driver's arrival).
          After the free window, the driver bills each additional minute at this rate.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Free wait (minutes)">
          <NumInput step="1" value={form.free_wait_minutes} onChange={(v) => setForm({ ...form, free_wait_minutes: Math.round(v) })} />
        </Field>
        <Field label={`Rate per minute (${data.currency ?? "EUR"})`}>
          <NumInput value={form.waiting_rate_per_minute} onChange={(v) => setForm({ ...form, waiting_rate_per_minute: v })} />
        </Field>
        <div className="sm:col-span-2 flex justify-end">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            <Save className="h-4 w-4 mr-1" /> Save waiting policy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Service areas ----------
function AreasTab() {
  const { data: settings } = useSettings();
  const currency = settings.currency ?? "EUR";
  const listFn = useServerFn(listServiceAreas);
  const upsertFn = useServerFn(upsertServiceArea);
  const delFn = useServerFn(deleteServiceArea);
  const qc = useQueryClient();

  const areasQ = useQuery({ queryKey: ["pricing", "areas"], queryFn: () => listFn() as Promise<any[]> });
  const upsert = useMutation({
    mutationFn: (row: any) => upsertFn({ data: row }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pricing", "areas"] }); toast.success("Area saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pricing", "areas"] }); toast.success("Area removed"); },
  });

  const [draft, setDraft] = useState<any | null>(null);

  function startNew() {
    setDraft({
      name: "", currency: null, base_price: 0, price_per_km: 0, price_per_hour: 0,
      minimum_fare: 0, free_wait_minutes: null, waiting_rate_per_minute: null,
      notes: "", active: true, sort_order: (areasQ.data?.length ?? 0),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Areas like <em>Airport</em>, <em>North coast</em>, or <em>City centre</em>. When a trip's pickup or dropoff is in an area,
          the system quotes from that area's card instead of the base rates.
        </p>
        <Button size="sm" onClick={startNew}><Plus className="h-4 w-4 mr-1" /> New area</Button>
      </div>

      {draft && (
        <AreaEditor
          draft={draft}
          currency={currency}
          onCancel={() => setDraft(null)}
          onSave={(row: any) => { upsert.mutate(row); setDraft(null); }}
        />
      )}

      <div className="grid gap-3">
        {(areasQ.data ?? []).length === 0 && !draft && (
          <p className="text-sm text-muted-foreground italic">No service areas yet.</p>
        )}
        {(areasQ.data ?? []).map((a) => (
          <AreaCard key={a.id} area={a} currency={currency}
            onEdit={() => setDraft(a)}
            onDelete={() => { if (confirm(`Delete "${a.name}"?`)) del.mutate(a.id); }} />
        ))}
      </div>
    </div>
  );
}

function AreaCard({ area, currency, onEdit, onDelete }: any) {
  const cur = area.currency ?? currency;
  return (
    <Card>
      <CardContent className="p-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-semibold">{area.name}</div>
            {!area.active && <Badge variant="secondary">Inactive</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {cur} {Number(area.base_price).toFixed(2)} base · {cur} {Number(area.price_per_km).toFixed(2)}/km ·
            {" "}{cur} {Number(area.price_per_hour).toFixed(2)}/hr · min {cur} {Number(area.minimum_fare).toFixed(2)}
          </div>
          {(area.free_wait_minutes != null || area.waiting_rate_per_minute != null) && (
            <div className="text-xs text-muted-foreground mt-1">
              Waiting: {area.free_wait_minutes ?? "—"} min free, {cur} {Number(area.waiting_rate_per_minute ?? 0).toFixed(2)}/min
            </div>
          )}
          {area.notes && <div className="text-xs mt-2">{area.notes}</div>}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AreaEditor({ draft, currency, onCancel, onSave }: any) {
  const [f, setF] = useState<any>(draft);
  useEffect(() => setF(draft), [draft]);
  const cur = f.currency ?? currency;
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">{f.id ? "Edit area" : "New area"}</CardTitle>
        <CardDescription>Leave a field at 0 to skip that pricing component.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={`Currency (default: ${currency})`}>
          <Input maxLength={3} placeholder={currency}
            value={f.currency ?? ""} onChange={(e) => setF({ ...f, currency: e.target.value ? e.target.value.toUpperCase() : null })} />
        </Field>
        <Field label={`Base price (${cur})`}><NumInput value={f.base_price} onChange={(v) => setF({ ...f, base_price: v })} /></Field>
        <Field label={`Minimum fare (${cur})`}><NumInput value={f.minimum_fare} onChange={(v) => setF({ ...f, minimum_fare: v })} /></Field>
        <Field label={`Per km (${cur})`}><NumInput value={f.price_per_km} onChange={(v) => setF({ ...f, price_per_km: v })} /></Field>
        <Field label={`Per hour (${cur})`}><NumInput value={f.price_per_hour} onChange={(v) => setF({ ...f, price_per_hour: v })} /></Field>
        <Field label="Area free wait (min)" hint="Blank = use company default.">
          <NumInput step="1"
            value={f.free_wait_minutes ?? undefined}
            onChange={(v) => setF({ ...f, free_wait_minutes: Number.isFinite(v) ? Math.round(v) : null })} />
        </Field>
        <Field label={`Area waiting rate (${cur}/min)`} hint="Blank = use company default.">
          <NumInput
            value={f.waiting_rate_per_minute ?? undefined}
            onChange={(v) => setF({ ...f, waiting_rate_per_minute: Number.isFinite(v) ? v : null })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes (optional)">
            <Textarea rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!f.active} onCheckedChange={(v) => setF({ ...f, active: v })} />
            Active
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button onClick={() => onSave(f)} disabled={!f.name.trim()}><Save className="h-4 w-4 mr-1" /> Save area</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Driver defaults ----------
function DriverDefaultsTab() {
  const { data, save } = useSettings();
  const [form, setForm] = useState<any>({});
  useEffect(() => { setForm({
    default_driver_pay_per_km: data.default_driver_pay_per_km ?? 0,
    default_driver_pay_per_hour: data.default_driver_pay_per_hour ?? 0,
    default_driver_wait_share_pct: data.default_driver_wait_share_pct ?? 100,
    default_driver_commission_pct: data.default_driver_commission_pct ?? 0,
  }); }, [data]);
  const cur = data.currency ?? "EUR";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Driver defaults</CardTitle>
        <CardDescription>
          Applied to every driver unless they have their own values on the Drivers page.
          Commission is the % you keep from the trip price; the driver takes the rest.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={`Driver pay per km (${cur})`}>
          <NumInput value={form.default_driver_pay_per_km} onChange={(v) => setForm({ ...form, default_driver_pay_per_km: v })} />
        </Field>
        <Field label={`Driver pay per hour (${cur})`}>
          <NumInput value={form.default_driver_pay_per_hour} onChange={(v) => setForm({ ...form, default_driver_pay_per_hour: v })} />
        </Field>
        <Field label="Driver waiting share (%)" hint="What share of waiting-time charges the driver keeps.">
          <NumInput step="1" value={form.default_driver_wait_share_pct} onChange={(v) => setForm({ ...form, default_driver_wait_share_pct: v })} />
        </Field>
        <Field label="Coordinator commission (%)" hint="Kept from the trip price before paying the driver.">
          <NumInput step="1" value={form.default_driver_commission_pct} onChange={(v) => setForm({ ...form, default_driver_commission_pct: v })} />
        </Field>
        <div className="sm:col-span-2 flex justify-end">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            <Save className="h-4 w-4 mr-1" /> Save driver defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Price preview ----------
function PricePreviewTab() {
  const { data: settings } = useSettings();
  const listFn = useServerFn(listServiceAreas);
  const areasQ = useQuery({ queryKey: ["pricing", "areas"], queryFn: () => listFn() as Promise<any[]> });

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [km, setKm] = useState<number>(0);
  const [mins, setMins] = useState<number>(0);
  const [pax, setPax] = useState<number>(1);
  const [waitMins, setWaitMins] = useState<number>(0);
  const [areaId, setAreaId] = useState<string>("");
  const [paxIncluded, setPaxIncluded] = useState<number>(4);
  const [extraPerPax, setExtraPerPax] = useState<number>(0);

  const area = (areasQ.data ?? []).find((a) => a.id === areaId);
  const currency = area?.currency ?? settings.currency ?? "EUR";
  const basePrice = Number(area?.base_price ?? 0);
  const pricePerKm = Number(area?.price_per_km ?? settings.price_per_km ?? 0);
  const pricePerHour = Number(area?.price_per_hour ?? settings.price_per_hour ?? 0);
  const minimumFare = Number(area?.minimum_fare ?? settings.minimum_fare ?? 0);
  const freeWait = Number(area?.free_wait_minutes ?? settings.free_wait_minutes ?? 0);
  const waitRate = Number(area?.waiting_rate_per_minute ?? settings.waiting_rate_per_minute ?? 0);

  const distanceCost = km * pricePerKm;
  const timeCost = (mins / 60) * pricePerHour;
  const paxSurcharge = Math.max(0, pax - paxIncluded) * extraPerPax;
  const preMin = basePrice + distanceCost + timeCost + paxSurcharge;
  const fare = Math.max(preMin, minimumFare);
  const minApplied = fare > preMin;
  const chargeableWait = Math.max(0, waitMins - freeWait);
  const waitCharge = chargeableWait * waitRate;
  const total = fare + waitCharge;

  const commissionPct = Number(settings.default_driver_commission_pct ?? 0);
  const driverShare = Number(settings.default_driver_wait_share_pct ?? 100);
  const driverFromFare = fare * (1 - commissionPct / 100);
  const driverFromWait = waitCharge * (driverShare / 100);
  const driverTotal = driverFromFare + driverFromWait;

  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4" /> Try a trip
          </CardTitle>
          <CardDescription>
            Nothing is saved — enter a route, passengers, and expected waiting time to see the exact fare
            using your current rates.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="From (optional)">
            <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Pickup location" />
          </Field>
          <Field label="To (optional)">
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Dropoff location" />
          </Field>
          <Field label="Service area" hint="Optional — overrides base rates.">
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
            >
              <option value="">Base rates (no area)</option>
              {(areasQ.data ?? []).filter((a) => a.active).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Passengers">
            <NumInput step="1" value={pax} onChange={(v) => setPax(Math.max(1, Math.round(v)))} />
          </Field>
          <Field label="Distance (km)">
            <NumInput step="0.1" value={km} onChange={setKm} />
          </Field>
          <Field label="Driving time (min)">
            <NumInput step="1" value={mins} onChange={(v) => setMins(Math.max(0, Math.round(v)))} />
          </Field>
          <Field label="Waiting time (min)" hint={`Free window: ${freeWait} min from pickup.`}>
            <NumInput step="1" value={waitMins} onChange={(v) => setWaitMins(Math.max(0, Math.round(v)))} />
          </Field>
          <div />
          <Field label="Included passengers" hint="No surcharge up to this count.">
            <NumInput step="1" value={paxIncluded} onChange={(v) => setPaxIncluded(Math.max(1, Math.round(v)))} />
          </Field>
          <Field label={`Extra per additional passenger (${currency})`}>
            <NumInput value={extraPerPax} onChange={setExtraPerPax} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quote</CardTitle>
          <CardDescription>
            {area ? <>Using area <strong>{area.name}</strong></> : <>Using company base rates</>}
            {(from || to) && <> · {from || "?"} → {to || "?"}</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-3xl font-semibold tabular-nums">{fmt(total)}</div>

          <div className="rounded-md border divide-y text-sm">
            <PreviewRow label="Base price" value={fmt(basePrice)} muted={basePrice === 0} />
            <PreviewRow label={`Distance (${km.toFixed(1)} km × ${fmt(pricePerKm)})`} value={fmt(distanceCost)} muted={distanceCost === 0} />
            <PreviewRow label={`Time (${mins} min × ${fmt(pricePerHour)}/hr)`} value={fmt(timeCost)} muted={timeCost === 0} />
            {paxSurcharge > 0 && (
              <PreviewRow label={`Passenger surcharge (${pax - paxIncluded} × ${fmt(extraPerPax)})`} value={fmt(paxSurcharge)} />
            )}
            <PreviewRow
              label={minApplied ? `Fare (minimum ${fmt(minimumFare)} applied)` : "Fare"}
              value={fmt(fare)}
              strong
            />
            <PreviewRow
              label={
                waitMins === 0
                  ? "Waiting"
                  : chargeableWait === 0
                    ? `Waiting (${waitMins} min — inside free window)`
                    : `Waiting (${chargeableWait} chargeable min × ${fmt(waitRate)})`
              }
              value={fmt(waitCharge)}
              muted={waitCharge === 0}
            />
            <PreviewRow label="Total" value={fmt(total)} strong />
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Driver payout preview
            </div>
            <div className="rounded-md border divide-y text-sm">
              <PreviewRow
                label={`From fare (${(100 - commissionPct).toFixed(0)}% after ${commissionPct}% commission)`}
                value={fmt(driverFromFare)}
              />
              <PreviewRow label={`From waiting (${driverShare}% share)`} value={fmt(driverFromWait)} muted={driverFromWait === 0} />
              <PreviewRow label="Driver total" value={fmt(driverTotal)} strong />
              <PreviewRow label="You keep" value={fmt(total - driverTotal)} strong />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Uses company defaults. A driver with per-driver overrides will earn different amounts.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PreviewRow({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${muted ? "text-muted-foreground" : ""} ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
