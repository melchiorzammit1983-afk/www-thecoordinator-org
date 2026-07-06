import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  listPortals, updatePortal, listPortalBookings, acceptPortalBooking, rejectPortalBooking,
  listChangeRequests, decideChangeRequest, sendPortalMessage, listPortalThreadMessages,
  generatePortalStatement,
} from "@/lib/portal.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/coordinator/portals/$id")({
  head: () => ({ meta: [{ title: "Portal — Manage" }] }),
  component: PortalDetail,
});

function PortalDetail() {
  const { id } = Route.useParams();
  const listFn = useServerFn(listPortals);
  const { data: all } = useQuery({ queryKey: ["portals"], queryFn: () => listFn() as Promise<any[]> });
  const portal = (all ?? []).find((p) => p.id === id);
  if (!portal) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold">{portal.name}</h1>
      <p className="text-sm text-muted-foreground capitalize">{portal.kind}</p>

      <Tabs defaultValue="bookings" className="mt-6">
        <TabsList>
          <TabsTrigger value="bookings">Inbox</TabsTrigger>
          <TabsTrigger value="requests">Change requests</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
        </TabsList>
        <TabsContent value="bookings" className="mt-4"><BookingsInbox portalId={id} /></TabsContent>
        <TabsContent value="requests" className="mt-4"><ChangeRequestsPanel /></TabsContent>
        <TabsContent value="statement" className="mt-4"><StatementPanel portalId={id} /></TabsContent>
        <TabsContent value="branding" className="mt-4"><BrandingPanel portal={portal} /></TabsContent>
      </Tabs>
    </div>
  );
}

function BookingsInbox({ portalId }: { portalId: string }) {
  const listFn = useServerFn(listPortalBookings);
  const acceptFn = useServerFn(acceptPortalBooking);
  const rejectFn = useServerFn(rejectPortalBooking);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["portal-bookings", portalId], queryFn: () => listFn({ data: { portal_id: portalId } }) as Promise<any[]> });

  const acc = useMutation({
    mutationFn: (id: string) => acceptFn({ data: { booking_id: id } }),
    onSuccess: () => { toast.success("Accepted — job created & points spent"); qc.invalidateQueries({ queryKey: ["portal-bookings", portalId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const rej = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { booking_id: id } }),
    onSuccess: () => { toast.success("Rejected"); qc.invalidateQueries({ queryKey: ["portal-bookings", portalId] }); },
  });

  return (
    <div className="space-y-2">
      {(data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No bookings yet.</p>}
      {(data ?? []).map((b) => (
        <Card key={b.id}>
          <CardContent className="p-4 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-medium">{b.payload?.name} {b.payload?.surname} <span className="text-xs text-muted-foreground">· {b.payload?.pax_count ?? 1} pax</span></div>
              <div className="text-sm">{b.payload?.from_location} → {b.payload?.to_location}</div>
              <div className="text-xs mt-1">{b.payload?.pickup_at ? new Date(b.payload.pickup_at).toLocaleString() : "—"} · {b.payload?.room_number ? `Room ${b.payload.room_number} · ` : ""}{b.payload?.flight_number ?? ""}</div>
              <div className="text-xs text-muted-foreground mt-1">Booked by: {b.created_by_name || b.created_by_email || "hotel staff"}</div>
              {b.payload?.notes && <div className="text-xs mt-1 italic">"{b.payload.notes}"</div>}
              <Badge className="mt-2" variant="secondary">{b.status.replace("_", " ")}</Badge>
            </div>
            {b.status === "pending" && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => acc.mutate(b.id)} disabled={acc.isPending}>Accept</Button>
                <Button size="sm" variant="outline" onClick={() => rej.mutate(b.id)} disabled={rej.isPending}>Reject</Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChangeRequestsPanel() {
  const listFn = useServerFn(listChangeRequests);
  const decideFn = useServerFn(decideChangeRequest);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["portal-crs"], queryFn: () => listFn() as Promise<any[]> });
  const mut = useMutation({
    mutationFn: (v: { id: string; decision: "approved" | "rejected" }) => decideFn({ data: v }),
    onSuccess: () => { toast.success("Decision recorded"); qc.invalidateQueries({ queryKey: ["portal-crs"] }); },
  });
  return (
    <div className="space-y-2">
      {(data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No pending change requests.</p>}
      {(data ?? []).map((cr) => (
        <Card key={cr.id}><CardContent className="p-4 flex justify-between items-start gap-3">
          <div>
            <div className="font-medium capitalize">{cr.kind} · {cr.portal_bookings?.portal_companies?.name}</div>
            <pre className="text-xs mt-1 bg-muted p-2 rounded">{JSON.stringify(cr.requested_changes, null, 2)}</pre>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => mut.mutate({ id: cr.id, decision: "approved" })}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => mut.mutate({ id: cr.id, decision: "rejected" })}>Reject</Button>
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}

function StatementPanel({ portalId }: { portalId: string }) {
  const [start, setStart] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [stmt, setStmt] = useState<any>(null);
  const genFn = useServerFn(generatePortalStatement);
  async function generate() {
    const r = await genFn({ data: { portal_id: portalId, period_start: new Date(start).toISOString(), period_end: new Date(end + "T23:59:59").toISOString() } });
    setStmt(r);
  }
  function downloadCsv() {
    if (!stmt?.rows) return;
    const header = "date,guest,from,to,status,agreed_price\n";
    const rows = stmt.rows.map((r: any) => [
      new Date(r.created_at).toISOString(), `${r.payload?.name ?? ""} ${r.payload?.surname ?? ""}`,
      r.payload?.from_location, r.payload?.to_location, r.status, r.agreed_price ?? "",
    ].map((v: any) => `"${String(v ?? "").replace(/"/g, "''")}"`).join(",")).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `statement_${start}_${end}.csv`; a.click();
  }
  return (
    <Card><CardHeader><CardTitle className="text-base">Statement</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-end">
          <div><Label>From</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          <Button onClick={generate}>Generate</Button>
          {stmt && <Button variant="outline" onClick={downloadCsv}>Download CSV</Button>}
        </div>
        {stmt && (
          <div className="text-sm">
            <div>Bookings: <b>{stmt.statement.totals.bookings_count}</b></div>
            <div>Accepted: <b>{stmt.statement.totals.accepted}</b></div>
            <div>Cancelled: <b>{stmt.statement.totals.cancelled}</b></div>
            <div>Revenue: <b>€{Number(stmt.statement.totals.revenue).toFixed(2)}</b></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BrandingPanel({ portal }: { portal: any }) {
  const updateFn = useServerFn(updatePortal);
  const [name, setName] = useState(portal.display_name_for_passenger ?? portal.name);
  const [color, setColor] = useState(portal.brand_color ?? "#0f172a");
  const [logoUrl, setLogoUrl] = useState(portal.logo_url ?? "");
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    const path = `${portal.id}/logo.${file.name.split(".").pop() || "png"}`;
    const { error } = await supabase.storage.from("portal-logos").upload(path, file, { upsert: true });
    if (error) { toast.error(error.message); setUploading(false); return; }
    const { data } = supabase.storage.from("portal-logos").getPublicUrl(path);
    setLogoUrl(data.publicUrl);
    setUploading(false);
    toast.success("Uploaded — remember to save");
  }
  async function save() {
    await updateFn({ data: { id: portal.id, patch: { display_name_for_passenger: name, brand_color: color, logo_url: logoUrl || null } } });
    toast.success("Branding saved");
  }
  return (
    <Card><CardHeader><CardTitle className="text-base">Passenger-facing branding</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div><Label>Display name (shown to guests)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Brand color</Label><Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-24" /></div>
        <div>
          <Label>Logo</Label>
          <div className="flex items-center gap-2">
            {logoUrl && <img src={logoUrl} alt="" className="h-12 w-12 rounded object-contain bg-white border" />}
            <Input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} disabled={uploading} />
          </div>
        </div>
        <Button onClick={save}>Save branding</Button>
      </CardContent>
    </Card>
  );
}
