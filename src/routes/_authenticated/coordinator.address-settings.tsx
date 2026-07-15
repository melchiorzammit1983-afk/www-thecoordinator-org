import { createFileRoute } from "@tanstack/react-router";
import { MapPin, RotateCcw, Radar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAddressSettings, DEFAULT_ADDRESS_SETTINGS } from "@/hooks/use-address-settings";
import { AddressAutocomplete } from "@/components/address/AddressAutocomplete";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyGpsSettings, updateMyGpsSettings } from "@/lib/coordinator.functions";

const DEFAULT_ARRIVAL_RADIUS_M = 150;


export const Route = createFileRoute("/_authenticated/coordinator/address-settings")({
  head: () => ({
    meta: [
      { title: "Address & map settings — Coordinator" },
      { name: "description", content: "Tune Google Places autocomplete used across every address field." },
    ],
  }),
  component: AddressSettingsPage,
});

function AddressSettingsPage() {
  const { settings, save, reset } = useAddressSettings();
  const [preview, setPreview] = useState("");
  const [previewPlaceId, setPreviewPlaceId] = useState<string | null>(null);

  // Company-scoped GPS arrival radius (persisted to companies.arrival_radius_m).
  const qc = useQueryClient();
  const getGps = useServerFn(getMyGpsSettings);
  const updateGps = useServerFn(updateMyGpsSettings);
  const { data: gps } = useQuery({
    queryKey: ["my-gps-settings"],
    queryFn: () => getGps(),
    staleTime: 30_000,
  });
  const [radius, setRadius] = useState<number>(DEFAULT_ARRIVAL_RADIUS_M);
  useEffect(() => {
    if (gps?.arrival_radius_m != null) setRadius(gps.arrival_radius_m);
  }, [gps?.arrival_radius_m]);
  const saveRadius = useMutation({
    mutationFn: (m: number) => updateGps({ data: { arrival_radius_m: m } }),
    onSuccess: () => {
      toast.success("GPS arrival radius saved");
      qc.invalidateQueries({ queryKey: ["my-gps-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold sm:text-2xl">Address & map settings</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Applies to every address input across the app — booking forms, dispatch, bulk paste.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { reset(); toast.success("Reset to defaults"); }}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Suggestion bias</CardTitle>
          <CardDescription>
            Google will still return results worldwide, but places inside your bias circle rank first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="region">Region code</Label>
              <Input id="region" maxLength={4} value={settings.region}
                onChange={(e) => save({ region: e.target.value.toUpperCase().slice(0, 4) })} />
              <p className="text-[11px] text-muted-foreground">ISO country (MT, IT, GB…).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lang">Language</Label>
              <Input id="lang" maxLength={8} value={settings.language}
                onChange={(e) => save({ language: e.target.value.slice(0, 8) })} />
              <p className="text-[11px] text-muted-foreground">BCP-47 (en, en-GB, it…).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lat">Center latitude</Label>
              <Input id="lat" type="number" step="0.0001" value={settings.bias_lat}
                onChange={(e) => save({ bias_lat: Number(e.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lng">Center longitude</Label>
              <Input id="lng" type="number" step="0.0001" value={settings.bias_lng}
                onChange={(e) => save({ bias_lng: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Bias radius</Label>
              <span className="text-xs text-muted-foreground">{settings.bias_radius_km} km</span>
            </div>
            <Slider
              min={5} max={200} step={5}
              value={[settings.bias_radius_km]}
              onValueChange={(v) => save({ bias_radius_km: v[0] ?? 60 })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Behaviour</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            label="Auto-fix bulk paste"
            hint="When you paste trips, unclear hotels/addresses are replaced with Google's top match and flagged so you can undo."
            checked={settings.auto_fix_bulk}
            onChange={(v) => save({ auto_fix_bulk: v })}
          />
          <ToggleRow
            label="Show mini map preview"
            hint="Render a small preview under a selected address (uses map load credits)."
            checked={settings.show_map_preview}
            onChange={(v) => save({ show_map_preview: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Radar className="h-4 w-4" /> Driver arrival radius
          </CardTitle>
          <CardDescription>
            How close a driver must be to the pickup point (in metres) before "Arrived at Pickup"
            is stamped as GPS-verified. Bigger radius = more forgiving for hotels, malls, or venues
            where the geocoded point is off. Drivers can still tap arrived if GPS fails — this only
            controls the verified stamp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Radius</Label>
            <span className="text-sm font-medium">{radius} m</span>
          </div>
          <Slider
            min={25}
            max={1000}
            step={25}
            value={[radius]}
            onValueChange={(v) => setRadius(v[0] ?? DEFAULT_ARRIVAL_RADIUS_M)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => saveRadius.mutate(radius)}
              disabled={saveRadius.isPending || radius === (gps?.arrival_radius_m ?? DEFAULT_ARRIVAL_RADIUS_M)}
            >
              {saveRadius.isPending ? "Saving…" : "Save radius"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRadius(DEFAULT_ARRIVAL_RADIUS_M);
                saveRadius.mutate(DEFAULT_ARRIVAL_RADIUS_M);
              }}
              disabled={saveRadius.isPending}
            >
              Reset to {DEFAULT_ARRIVAL_RADIUS_M} m
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tip: if drivers keep getting "outside radius" at a big hotel or airport, raise this to
            300–500 m. If the pickup is at the wrong spot on the map, the driver can also tap
            "Pickup is here — use my GPS" on the trip card to snap the coordinates.
          </p>
        </CardContent>
      </Card>



      <Card>
        <CardHeader>
          <CardTitle className="text-base">Try it</CardTitle>
          <CardDescription>Type a hotel or landmark and watch suggestions apply your bias.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <AddressAutocomplete
            value={preview}
            placeId={previewPlaceId}
            onChange={(v) => { setPreview(v.address); setPreviewPlaceId(v.place_id); }}
            placeholder='Try "Hilton", "Cerviola", "airport"…'
          />
          {previewPlaceId && (
            <p className="text-[11px] text-emerald-600">Locked to place_id — future editions clear it.</p>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Defaults: {DEFAULT_ADDRESS_SETTINGS.region}, {DEFAULT_ADDRESS_SETTINGS.bias_radius_km}km around Malta.
        Settings save automatically to this browser.
      </p>
    </div>
  );
}

function ToggleRow({
  label, hint, checked, onChange,
}: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
