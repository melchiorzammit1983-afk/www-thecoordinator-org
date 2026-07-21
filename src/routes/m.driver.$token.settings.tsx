import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getDriverSettings, saveDriverProfile, saveVehicles, saveSchedule,
  upsertException, deleteException, closeEarlyToday,
} from "@/lib/driver-settings.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Trash2, Star, Clock } from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const Route = createFileRoute("/m/driver/$token/settings")({
  component: DriverSettingsPage,
});

type Vehicle = {
  id?: string;
  name: string;
  plate?: string | null;
  seats: number;
  default_price_eur?: number | null;
  per_km_eur?: number | null;
  is_default?: boolean;
};

type Window = { id?: string; weekday: number; start_time: string; end_time: string };

function DriverSettingsPage() {
  const { token } = useParams({ from: "/m/driver/$token/settings" });
  const qc = useQueryClient();
  const load = useServerFn(getDriverSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["driver-settings", token],
    queryFn: () => load({ data: { token } }),
  });

  if (isLoading || !data) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const needsOnboarding = !data.onboarded;

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-3 py-2 flex items-center gap-2">
        <Link to="/m/driver/$token" params={{ token }} className="p-2 -ml-2">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="font-semibold">Settings</div>
          {needsOnboarding && <div className="text-[11px] text-amber-600">Finish onboarding — set your vehicle & hours</div>}
        </div>
      </header>

      <div className="p-3 space-y-3 max-w-lg mx-auto">
        <DisplayPrefsCard token={token} />
        <Tabs defaultValue={needsOnboarding ? "vehicles" : "profile"}>

          <TabsList className="w-full grid grid-cols-4 h-11">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
            <TabsTrigger value="hours">Hours</TabsTrigger>
            <TabsTrigger value="today">Today</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-3">
            <ProfileTab token={token} driver={data.driver} onSaved={() => qc.invalidateQueries({ queryKey: ["driver-settings", token] })} />
          </TabsContent>
          <TabsContent value="vehicles" className="mt-3">
            <VehiclesTab token={token} vehicles={data.vehicles as Vehicle[]} onSaved={() => qc.invalidateQueries({ queryKey: ["driver-settings", token] })} />
          </TabsContent>
          <TabsContent value="hours" className="mt-3">
            <HoursTab token={token} schedule={data.schedule} windows={data.windows as Window[]} onSaved={() => qc.invalidateQueries({ queryKey: ["driver-settings", token] })} />
          </TabsContent>
          <TabsContent value="today" className="mt-3">
            <TodayTab token={token} exceptions={data.exceptions as any[]} onSaved={() => qc.invalidateQueries({ queryKey: ["driver-settings", token] })} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────
function ProfileTab({ token, driver, onSaved }: { token: string; driver: any; onSaved: () => void }) {
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [email, setEmail] = useState(driver?.email ?? "");
  const [note, setNote] = useState(driver?.availability_note ?? "");
  const save = useServerFn(saveDriverProfile);
  const mut = useMutation({
    mutationFn: () => save({ data: { token, name, phone, email: email || null, availability_note: note || null } }),
    onSuccess: () => { toast.success("Profile saved"); onSaved(); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1"><Label>Your name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="space-y-1"><Label>Email (optional)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-1"><Label>Note for coordinator</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Prefer airport runs" /></div>
        <Button className="w-full h-11" onClick={() => mut.mutate()} disabled={mut.isPending}>Save profile</Button>
      </CardContent>
    </Card>
  );
}

// ── Vehicles ────────────────────────────────────────────────────────────
function VehiclesTab({ token, vehicles: initial, onSaved }: { token: string; vehicles: Vehicle[]; onSaved: () => void }) {
  const [items, setItems] = useState<Vehicle[]>(initial.length ? initial : [{ name: "", seats: 4, is_default: true }]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const save = useServerFn(saveVehicles);
  const mut = useMutation({
    mutationFn: () => save({ data: { token, vehicles: items, delete_ids: deleteIds } }),
    onSuccess: () => { toast.success("Vehicles saved"); setDeleteIds([]); onSaved(); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  function update(i: number, patch: Partial<Vehicle>) {
    setItems((prev) => prev.map((v, idx) => idx === i ? { ...v, ...patch } : v));
  }
  function setDefault(i: number) {
    setItems((prev) => prev.map((v, idx) => ({ ...v, is_default: idx === i })));
  }
  function remove(i: number) {
    const v = items[i];
    if (v.id) setDeleteIds((d) => [...d, v.id!]);
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      {items.map((v, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Input placeholder="Vehicle name (e.g. Mercedes V-class)" value={v.name} onChange={(e) => update(i, { name: e.target.value })} />
              <Button size="icon" variant={v.is_default ? "default" : "outline"} onClick={() => setDefault(i)} title="Default vehicle">
                <Star className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => remove(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Plate</Label><Input value={v.plate ?? ""} onChange={(e) => update(i, { plate: e.target.value })} /></div>
              <div><Label className="text-xs">Seats</Label><Input type="number" value={v.seats} onChange={(e) => update(i, { seats: parseInt(e.target.value || "4", 10) })} /></div>
              <div><Label className="text-xs">Default price €</Label><Input type="number" step="0.01" value={v.default_price_eur ?? ""} onChange={(e) => update(i, { default_price_eur: e.target.value ? parseFloat(e.target.value) : null })} /></div>
              <div><Label className="text-xs">Per km €</Label><Input type="number" step="0.01" value={v.per_km_eur ?? ""} onChange={(e) => update(i, { per_km_eur: e.target.value ? parseFloat(e.target.value) : null })} /></div>
            </div>
            {v.is_default && <Badge variant="secondary" className="text-[10px]">Default — used to preset trip prices</Badge>}
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" className="w-full" onClick={() => setItems((p) => [...p, { name: "", seats: 4 }])}>
        <Plus className="h-4 w-4 mr-2" />Add vehicle
      </Button>
      <Button className="w-full h-11" onClick={() => mut.mutate()} disabled={mut.isPending || items.some((v) => !v.name.trim())}>Save vehicles</Button>
    </div>
  );
}

// ── Hours ───────────────────────────────────────────────────────────────
function HoursTab({ token, schedule, windows: initial, onSaved }: { token: string; schedule: any; windows: Window[]; onSaved: () => void }) {
  const [alwaysOpen, setAlwaysOpen] = useState<boolean>(!!schedule.always_open);
  const [tz] = useState<string>(schedule.timezone || "Europe/Malta");
  const [windows, setWindows] = useState<Window[]>(initial);
  const save = useServerFn(saveSchedule);
  const mut = useMutation({
    mutationFn: () => save({ data: { token, timezone: tz, always_open: alwaysOpen, windows } }),
    onSuccess: () => { toast.success("Hours saved"); onSaved(); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const grouped = useMemo(() => {
    const g: Record<number, Window[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const w of windows) g[w.weekday]?.push(w);
    return g;
  }, [windows]);

  function addWindow(day: number) {
    setWindows((prev) => [...prev, { weekday: day, start_time: "08:00", end_time: "18:00" }]);
  }
  function updateWindow(day: number, i: number, patch: Partial<Window>) {
    setWindows((prev) => {
      const flat = [...prev];
      const idxs = flat.map((w, idx) => w.weekday === day ? idx : -1).filter((x) => x >= 0);
      const target = idxs[i];
      if (target === undefined) return prev;
      flat[target] = { ...flat[target], ...patch };
      return flat;
    });
  }
  function removeWindow(day: number, i: number) {
    setWindows((prev) => {
      const flat = [...prev];
      const idxs = flat.map((w, idx) => w.weekday === day ? idx : -1).filter((x) => x >= 0);
      const target = idxs[i];
      if (target === undefined) return prev;
      flat.splice(target, 1);
      return flat;
    });
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between p-2 rounded border">
          <div>
            <div className="font-medium text-sm">Always available</div>
            <div className="text-[11px] text-muted-foreground">Ignores the weekly hours below</div>
          </div>
          <Switch checked={alwaysOpen} onCheckedChange={setAlwaysOpen} />
        </div>

        {!alwaysOpen && WEEKDAYS.map((label, day) => (
          <div key={day} className="border rounded p-2 space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{label}</div>
              <Button size="sm" variant="ghost" onClick={() => addWindow(day)}><Plus className="h-4 w-4" /></Button>
            </div>
            {grouped[day].length === 0 && <div className="text-[11px] text-muted-foreground">Closed</div>}
            {grouped[day].map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input type="time" value={w.start_time.slice(0,5)} onChange={(e) => updateWindow(day, i, { start_time: e.target.value })} />
                <span className="text-xs">→</span>
                <Input type="time" value={w.end_time.slice(0,5)} onChange={(e) => updateWindow(day, i, { end_time: e.target.value })} />
                <Button size="icon" variant="ghost" onClick={() => removeWindow(day, i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
          </div>
        ))}
        <Button className="w-full h-11" onClick={() => mut.mutate()} disabled={mut.isPending}>Save hours</Button>
      </CardContent>
    </Card>
  );
}

// ── Today (exceptions + close early) ────────────────────────────────────
function TodayTab({ token, exceptions, onSaved }: { token: string; exceptions: any[]; onSaved: () => void }) {
  const [reopen, setReopen] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [isOpen, setIsOpen] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const closeFn = useServerFn(closeEarlyToday);
  const upFn = useServerFn(upsertException);
  const delFn = useServerFn(deleteException);

  const closeMut = useMutation({
    mutationFn: (payload: { reopen_time?: string | null; note?: string | null }) => closeFn({ data: { token, ...payload } }),
    onSuccess: () => { toast.success("Applied"); setReopen(""); setNote(""); onSaved(); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const addMut = useMutation({
    mutationFn: () => upFn({ data: { token, date, is_open: isOpen, start_time: isOpen ? `${start}:00` : null, end_time: isOpen ? `${end}:00` : null, note: note || null } }),
    onSuccess: () => { toast.success("Exception saved"); setNote(""); onSaved(); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { token, id } }),
    onSuccess: () => { toast.success("Removed"); onSaved(); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" />Close early today</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Reopen at (optional)</Label><Input type="time" value={reopen} onChange={(e) => setReopen(e.target.value)} /></div>
            <div><Label className="text-xs">Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Doctor visit" /></div>
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" className="flex-1" onClick={() => closeMut.mutate({ reopen_time: null, note: note || null })} disabled={closeMut.isPending}>Close all day</Button>
            <Button className="flex-1" onClick={() => closeMut.mutate({ reopen_time: reopen || null, note: note || null })} disabled={closeMut.isPending || !reopen}>Close until {reopen || "…"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Add a date exception</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="flex items-center gap-2 pt-5"><Switch checked={isOpen} onCheckedChange={setIsOpen} /><span className="text-sm">{isOpen ? "Open" : "Closed"}</span></div>
          </div>
          {isOpen && (
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">From</Label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div><Label className="text-xs">To</Label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            </div>
          )}
          <Button className="w-full" onClick={() => addMut.mutate()} disabled={addMut.isPending}>Save exception</Button>
        </CardContent>
      </Card>

      {exceptions.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Upcoming exceptions</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {exceptions.map((e: any) => (
              <div key={e.id} className="flex items-center gap-2 text-sm">
                <div className="flex-1">
                  <div className="font-medium">{e.date} — {e.is_open ? `Open ${e.start_time?.slice(0,5)}–${e.end_time?.slice(0,5)}` : "Closed"}</div>
                  {e.note && <div className="text-[11px] text-muted-foreground">{e.note}</div>}
                </div>
                <Button size="icon" variant="ghost" onClick={() => delMut.mutate(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
