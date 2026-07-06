import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, Link2, Power, PowerOff, RotateCw, Trash2 } from "lucide-react";
import {
  listPortals, createPortal, updatePortal, rotatePortalToken, deletePortal,
} from "@/lib/portal.functions";

export const Route = createFileRoute("/_authenticated/coordinator/portals")({
  head: () => ({ meta: [{ title: "Company Portals — Coordinator" }] }),
  component: PortalsPage,
});

function PortalsPage() {
  const listFn = useServerFn(listPortals);
  const createFn = useServerFn(createPortal);
  const qc = useQueryClient();
  const { data: portals } = useQuery({ queryKey: ["portals"], queryFn: () => listFn() as Promise<any[]> });

  const [name, setName] = useState("");
  const [kind, setKind] = useState<"hotel" | "agent" | "corporate">("hotel");
  const [points, setPoints] = useState("3");

  const mut = useMutation({
    mutationFn: () => createFn({ data: { name, kind, points_per_booking: Number(points) || 3 } }),
    onSuccess: () => { toast.success("Portal created"); setName(""); qc.invalidateQueries({ queryKey: ["portals"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold">Company Portals</h1>
      <p className="text-sm text-muted-foreground mt-1">Give hotels, agents, and corporate clients a private link so they can book, track, and chat — you stay in control of dispatch.</p>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">New portal</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Grand Hotel Valletta" /></div>
          <div><Label>Kind</Label>
            <select className="w-full h-10 border rounded px-2 bg-background" value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="hotel">Hotel</option>
              <option value="agent">Agent</option>
              <option value="corporate">Corporate</option>
            </select>
          </div>
          <div><Label>Points per booking</Label><Input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} /></div>
          <div className="flex items-end"><Button onClick={() => mut.mutate()} disabled={!name || mut.isPending} className="w-full">Create</Button></div>
        </CardContent>
      </Card>

      <div className="mt-6 space-y-3">
        {(portals ?? []).length === 0 && <p className="text-sm text-muted-foreground">No portals yet.</p>}
        {(portals ?? []).map((p) => <PortalRow key={p.id} portal={p} onChange={() => qc.invalidateQueries({ queryKey: ["portals"] })} />)}
      </div>
    </div>
  );
}

function PortalRow({ portal, onChange }: { portal: any; onChange: () => void }) {
  const updateFn = useServerFn(updatePortal);
  const rotateFn = useServerFn(rotatePortalToken);
  const deleteFn = useServerFn(deletePortal);
  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/portal/${portal.magic_token}`;

  async function toggle() { await updateFn({ data: { id: portal.id, patch: { link_enabled: !portal.link_enabled } } }); onChange(); }
  async function rotate() { if (!confirm("Rotate the link? The old URL will stop working.")) return; await rotateFn({ data: { id: portal.id } }); onChange(); toast.success("Rotated"); }
  async function del() { if (!confirm("Delete this portal? All bookings/chats will be deleted.")) return; await deleteFn({ data: { id: portal.id } }); onChange(); }
  async function copy() { await navigator.clipboard.writeText(link); toast.success("Link copied"); }

  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium">{portal.name} <span className="text-xs text-muted-foreground capitalize">· {portal.kind}</span></div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <Badge variant={portal.link_enabled ? "default" : "secondary"}>{portal.link_enabled ? "Link ON" : "Link OFF"}</Badge>
            {portal.link_expires_at && <span>Expires {new Date(portal.link_expires_at).toLocaleString()}</span>}
            <span>· {Number(portal.points_per_booking)} pts / booking</span>
          </div>
          <div className="text-xs mt-2 flex items-center gap-2">
            <Link2 className="h-3 w-3" />
            <code className="truncate max-w-[400px]">{link}</code>
            <button onClick={copy} className="p-1 hover:bg-muted rounded"><Copy className="h-3 w-3" /></button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/coordinator/portals/$id" params={{ id: portal.id }} className="text-sm underline">Manage →</Link>
          <Button size="sm" variant="outline" onClick={toggle}>{portal.link_enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}</Button>
          <Button size="sm" variant="outline" onClick={rotate}><RotateCw className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={del}><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
