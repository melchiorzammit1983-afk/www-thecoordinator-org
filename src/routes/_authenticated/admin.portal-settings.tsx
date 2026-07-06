import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { getPortalSettings, updatePortalSettings } from "@/lib/portal.functions";

export const Route = createFileRoute("/_authenticated/admin/portal-settings")({
  head: () => ({ meta: [{ title: "Portal Settings — Admin" }] }),
  component: AdminPortalSettings,
});

function AdminPortalSettings() {
  const getFn = useServerFn(getPortalSettings);
  const setFn = useServerFn(updatePortalSettings);
  const [s, setS] = useState<any>(null);
  useEffect(() => { getFn().then(setS); }, []);
  if (!s) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  async function save() {
    const r = await setFn({ data: {
      default_points_per_booking: Number(s.default_points_per_booking),
      default_seat_points: Number(s.default_seat_points),
      allow_bulk: !!s.allow_bulk,
      require_approval_within_hours: Number(s.require_approval_within_hours),
      max_link_duration_hours: Number(s.max_link_duration_hours),
      allow_coord_pax_chat: !!s.allow_coord_pax_chat,
    } });
    setS(r);
    toast.success("Saved");
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold">Portal settings</h1>
      <Card className="mt-6"><CardHeader><CardTitle className="text-base">Defaults</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Default points per booking</Label><Input type="number" value={s.default_points_per_booking} onChange={(e) => setS({ ...s, default_points_per_booking: e.target.value })} /></div>
          <div><Label>Default weekly seat points</Label><Input type="number" value={s.default_seat_points} onChange={(e) => setS({ ...s, default_seat_points: e.target.value })} /></div>
          <div><Label>Approval required within (hours of pickup)</Label><Input type="number" value={s.require_approval_within_hours} onChange={(e) => setS({ ...s, require_approval_within_hours: e.target.value })} /></div>
          <div><Label>Max link duration (hours)</Label><Input type="number" value={s.max_link_duration_hours} onChange={(e) => setS({ ...s, max_link_duration_hours: e.target.value })} /></div>
          <div className="flex items-center justify-between"><Label>Allow bulk CSV upload</Label><Switch checked={!!s.allow_bulk} onCheckedChange={(v) => setS({ ...s, allow_bulk: v })} /></div>
          <div className="flex items-center justify-between"><Label>Allow coordinator ↔ passenger chat</Label><Switch checked={!!s.allow_coord_pax_chat} onCheckedChange={(v) => setS({ ...s, allow_coord_pax_chat: v })} /></div>
          <Button onClick={save}>Save</Button>
        </CardContent>
      </Card>
    </div>
  );
}
