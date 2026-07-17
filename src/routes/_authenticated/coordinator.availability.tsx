import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Clock, Plus, Trash2, CalendarOff, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getMySchedule, saveMySchedule, getMyPolicy, savePolicy,
  type Schedule, type Policy,
} from "@/lib/availability.functions";
import { IfFeature } from "@/components/billing/IfFeature";
import { HelpLink } from "@/components/help/HelpLink";

export const Route = createFileRoute("/_authenticated/coordinator/availability")({
  component: AvailabilityPage,
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function AvailabilityPage() {
  return (
    <IfFeature feature="availability_autoforward">
      <AvailabilityInner />
    </IfFeature>
  );
}

function AvailabilityInner() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([]);
  const [ownerType, setOwnerType] = useState<"company" | "driver">("company");
  const [ownerId, setOwnerId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) return;
      const { data: c } = await supabase.from("companies").select("id").eq("owner_user_id", u.user.id).maybeSingle();
      if (c?.id) {
        setCompanyId(c.id);
        setOwnerId(c.id);
        const { data: dr } = await supabase.from("drivers").select("id, name").eq("company_id", c.id).order("name");
        setDrivers(dr ?? []);
      }
    })();
  }, []);

  if (!companyId) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" /> Availability & Auto-forwarding
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Set opening hours for the company and each driver. When you're closed
            (or nobody responds in time), trips jump to the next available partner.
          </p>
          <HelpLink slug="availability-autoforward" className="mt-2" />
        </div>
      </div>

      <PolicyCard companyId={companyId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Whose hours?
          </CardTitle>
          <CardDescription>
            Switch between the company's default hours and any driver's individual hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[11px] uppercase text-muted-foreground">Owner</Label>
            <Select
              value={ownerType === "company" ? "company" : `driver:${ownerId ?? ""}`}
              onValueChange={(v) => {
                if (v === "company") { setOwnerType("company"); setOwnerId(companyId); }
                else { setOwnerType("driver"); setOwnerId(v.replace("driver:", "")); }
              }}
            >
              <SelectTrigger className="min-w-[240px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="company">Company (default hours)</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={`driver:${d.id}`}>Driver: {d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {ownerId && (
        <ScheduleEditor
          key={`${ownerType}:${ownerId}`}
          companyId={companyId}
          ownerType={ownerType}
          ownerId={ownerId}
        />
      )}
    </div>
  );
}

/* ------------------- Policy ------------------- */

function PolicyCard({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyPolicy);
  const saveFn = useServerFn(savePolicy);
  const q = useQuery({
    queryKey: ["availability-policy", companyId],
    queryFn: () => getFn({ data: { company_id: companyId } }),
  });
  const [state, setState] = useState<Policy | null>(null);
  useEffect(() => { if (q.data) setState(q.data); }, [q.data]);
  const mut = useMutation({
    mutationFn: (p: Policy) => saveFn({ data: p }) as Promise<{ ok: true }>,
    onSuccess: () => { toast.success("Policy saved"); qc.invalidateQueries({ queryKey: ["availability-policy"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!state) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Forwarding policy</CardTitle>
        <CardDescription>
          How trips move when you're off-hours or nobody responds. A small point
          fee applies per successful forward (see Billing).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Enable auto-forwarding</Label>
            <p className="text-xs text-muted-foreground">Off: trips stay with the assigned executor even when closed.</p>
          </div>
          <Switch checked={state.forwarding_enabled} onCheckedChange={(v) => setState({ ...state, forwarding_enabled: v })} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Off-hours behavior</Label>
            <Select value={state.off_hours_mode} onValueChange={(v: any) => setState({ ...state, off_hours_mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto_forward">Auto-forward immediately</SelectItem>
                <SelectItem value="notify_then_forward">Notify me first, then forward</SelectItem>
                <SelectItem value="manual_pick">Never auto — I'll pick a partner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Notify timeout (minutes)</Label>
            <Input type="number" min={2} max={60} value={state.notify_timeout_min}
              onChange={(e) => setState({ ...state, notify_timeout_min: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label>Unanswered timeout (minutes)</Label>
            <Input type="number" min={2} max={60} value={state.unanswered_timeout_min}
              onChange={(e) => setState({ ...state, unanswered_timeout_min: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label>Max forward hops</Label>
            <Input type="number" min={1} max={20} value={state.max_forward_hops}
              onChange={(e) => setState({ ...state, max_forward_hops: Number(e.target.value) })} />
          </div>
        </div>
        <div className="pt-2">
          <Button onClick={() => mut.mutate(state)} disabled={mut.isPending}>
            {mut.isPending ? "Saving…" : "Save policy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------- Schedule editor ------------------- */

type Draft = {
  timezone: string;
  always_open: boolean;
  windows: { weekday: number; start_time: string; end_time: string }[];
  exceptions: { date: string; is_open: boolean; start_time: string | null; end_time: string | null; note: string | null }[];
};

function ScheduleEditor({ companyId, ownerType, ownerId }: {
  companyId: string; ownerType: "company" | "driver"; ownerId: string;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getMySchedule);
  const saveFn = useServerFn(saveMySchedule);
  const q = useQuery({
    queryKey: ["availability-schedule", ownerType, ownerId],
    queryFn: () => getFn({ data: { owner_type: ownerType, owner_id: ownerId } }),
  });

  const defaultTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [draft, setDraft] = useState<Draft>({
    timezone: defaultTz,
    always_open: false,
    windows: [{ weekday: 1, start_time: "08:00", end_time: "18:00" }],
    exceptions: [],
  });

  useEffect(() => {
    if (q.data === undefined) return;
    if (q.data === null) {
      setDraft({
        timezone: defaultTz,
        always_open: false,
        windows: [{ weekday: 1, start_time: "08:00", end_time: "18:00" }],
        exceptions: [],
      });
      return;
    }
    const s: Schedule = q.data;
    setDraft({
      timezone: s.timezone,
      always_open: s.always_open,
      windows: s.windows.map((w) => ({ weekday: w.weekday, start_time: w.start_time.slice(0, 5), end_time: w.end_time.slice(0, 5) })),
      exceptions: s.exceptions.map((e) => ({
        date: e.date,
        is_open: e.is_open,
        start_time: e.start_time?.slice(0, 5) ?? null,
        end_time: e.end_time?.slice(0, 5) ?? null,
        note: e.note ?? null,
      })),
    });
  }, [q.data, defaultTz]);

  const mut = useMutation({
    mutationFn: () => saveFn({
      data: {
        owner_type: ownerType,
        owner_id: ownerId,
        company_id: companyId,
        timezone: draft.timezone,
        always_open: draft.always_open,
        windows: draft.windows,
        exceptions: draft.exceptions,
      },
    }) as Promise<{ ok: true }>,
    onSuccess: () => { toast.success("Hours saved"); qc.invalidateQueries({ queryKey: ["availability-schedule"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Weekly hours</CardTitle>
        <CardDescription>
          Add one or more time windows per day. Overnight? Add two rows (e.g. 22:00–24:00 and 00:00–06:00 next day).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label>Timezone</Label>
            <Input value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} className="min-w-[220px]" />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch checked={draft.always_open} onCheckedChange={(v) => setDraft({ ...draft, always_open: v })} />
            <Label>24/7 — always open</Label>
          </div>
        </div>

        {!draft.always_open && (
          <div className="space-y-2">
            {WEEKDAYS.map((label, wd) => {
              const rows = draft.windows.map((w, i) => ({ w, i })).filter((r) => r.w.weekday === wd);
              return (
                <div key={wd} className="border rounded-md p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{label}</div>
                    <Button
                      variant="ghost" size="sm" className="h-7"
                      onClick={() => setDraft({
                        ...draft,
                        windows: [...draft.windows, { weekday: wd, start_time: "09:00", end_time: "17:00" }],
                      })}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add window
                    </Button>
                  </div>
                  {rows.length === 0 && <div className="text-xs text-muted-foreground mt-1">Closed</div>}
                  <div className="space-y-2 mt-2">
                    {rows.map(({ w, i }) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input type="time" value={w.start_time}
                          onChange={(e) => {
                            const arr = [...draft.windows];
                            arr[i] = { ...w, start_time: e.target.value };
                            setDraft({ ...draft, windows: arr });
                          }} className="w-32" />
                        <span className="text-muted-foreground">→</span>
                        <Input type="time" value={w.end_time}
                          onChange={(e) => {
                            const arr = [...draft.windows];
                            arr[i] = { ...w, end_time: e.target.value };
                            setDraft({ ...draft, windows: arr });
                          }} className="w-32" />
                        <Button variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => setDraft({ ...draft, windows: draft.windows.filter((_, idx) => idx !== i) })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-2 space-y-2 border-t">
          <div className="flex items-center justify-between pt-3">
            <div className="text-sm font-medium flex items-center gap-2">
              <CalendarOff className="h-4 w-4" /> Holidays & one-off exceptions
            </div>
            <Button variant="outline" size="sm"
              onClick={() => setDraft({
                ...draft,
                exceptions: [
                  ...draft.exceptions,
                  { date: new Date().toISOString().slice(0, 10), is_open: false, start_time: null, end_time: null, note: null },
                ],
              })}>
              <Plus className="h-3 w-3 mr-1" /> Add exception
            </Button>
          </div>
          {draft.exceptions.length === 0 && (
            <div className="text-xs text-muted-foreground">No exceptions set. Weekly hours apply every day.</div>
          )}
          {draft.exceptions.map((e, idx) => (
            <div key={idx} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Input type="date" value={e.date} className="w-40"
                  onChange={(ev) => {
                    const arr = [...draft.exceptions]; arr[idx] = { ...e, date: ev.target.value }; setDraft({ ...draft, exceptions: arr });
                  }} />
                <Switch checked={e.is_open} onCheckedChange={(v) => {
                  const arr = [...draft.exceptions]; arr[idx] = { ...e, is_open: v }; setDraft({ ...draft, exceptions: arr });
                }} />
                <Badge variant={e.is_open ? "default" : "destructive"}>{e.is_open ? "Open" : "Closed"}</Badge>
                {e.is_open && (
                  <>
                    <Input type="time" value={e.start_time ?? "09:00"} className="w-28"
                      onChange={(ev) => {
                        const arr = [...draft.exceptions]; arr[idx] = { ...e, start_time: ev.target.value }; setDraft({ ...draft, exceptions: arr });
                      }} />
                    <span>→</span>
                    <Input type="time" value={e.end_time ?? "17:00"} className="w-28"
                      onChange={(ev) => {
                        const arr = [...draft.exceptions]; arr[idx] = { ...e, end_time: ev.target.value }; setDraft({ ...draft, exceptions: arr });
                      }} />
                  </>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 ml-auto"
                  onClick={() => setDraft({ ...draft, exceptions: draft.exceptions.filter((_, i) => i !== idx) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea placeholder="Optional note (e.g. Christmas)" value={e.note ?? ""} rows={1} maxLength={200}
                onChange={(ev) => {
                  const arr = [...draft.exceptions]; arr[idx] = { ...e, note: ev.target.value || null }; setDraft({ ...draft, exceptions: arr });
                }} />
            </div>
          ))}
        </div>

        <div className="pt-2">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Saving…" : "Save hours"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
