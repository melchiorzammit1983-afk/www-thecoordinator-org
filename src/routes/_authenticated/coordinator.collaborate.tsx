import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Handshake, Trash2 } from "lucide-react";
import {
  createConnectionInvite, listMyInvites, revokeInvite,
  redeemConnectionInvite, listConnections,
  updateConnectionPermissions, revokeConnection,
} from "@/lib/collab.functions";

export const Route = createFileRoute("/_authenticated/coordinator/collaborate")({
  component: CollaboratePage,
});

const PERMS: { key: string; label: string }[] = [
  { key: "view_jobs", label: "View jobs" },
  { key: "edit_jobs", label: "Edit jobs" },
  { key: "create_jobs", label: "Create jobs" },
  { key: "view_drivers", label: "View drivers" },
  { key: "assign_drivers", label: "Assign drivers" },
  { key: "view_pax", label: "View passengers" },
  { key: "edit_pax", label: "Edit passengers" },
  { key: "view_chat", label: "View chat" },
  { key: "post_chat", label: "Post chat" },
];

function CollaboratePage() {
  const qc = useQueryClient();
  const listConn = useServerFn(listConnections);
  const listInv = useServerFn(listMyInvites);
  const create = useServerFn(createConnectionInvite);
  const revoke = useServerFn(revokeInvite);
  const redeem = useServerFn(redeemConnectionInvite);
  const updatePerms = useServerFn(updateConnectionPermissions);
  const revokeConn = useServerFn(revokeConnection);

  const connections = useQuery({ queryKey: ["collab", "connections"], queryFn: () => listConn() });
  const invites = useQuery({ queryKey: ["collab", "invites"], queryFn: () => listInv() });

  const [code, setCode] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"sync" | "provider">("provider");
  const [ttl, setTtl] = useState(7);
  const [perms, setPerms] = useState<Record<string, boolean>>({
    view_jobs: true, view_drivers: true, view_pax: true, view_chat: true,
  });

  const createMut = useMutation({
    mutationFn: async () => await create({ data: { mode, permissions: perms, ttlDays: ttl } }),
    onSuccess: () => {
      toast.success("Invite created");
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["collab"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const redeemMut = useMutation({
    mutationFn: async () => await redeem({ data: { code: code.trim().toUpperCase() } }),
    onSuccess: () => { toast.success("Connected"); setCode(""); qc.invalidateQueries({ queryKey: ["collab"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  function copyCode(c: string) {
    const url = `${window.location.origin}/coordinator/collaborate?code=${c}`;
    navigator.clipboard.writeText(`${c}\n${url}`);
    toast.success("Code + link copied");
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Handshake className="h-5 w-5" /> Collaborate</h1>
          <p className="text-sm text-muted-foreground">Connect with other coordinators — share a workspace or dispatch jobs to them.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button>New invite</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create connection invite</DialogTitle>
              <DialogDescription>Choose what another coordinator can see or do when they connect with your company.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Mode</Label>
                <Select value={mode} onValueChange={(v: any) => setMode(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="provider">Provider — they run jobs you dispatch</SelectItem>
                    <SelectItem value="sync">Sync — shared workspace with permissions you pick</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Expires in (days)</Label>
                <Input type="number" min={1} max={90} value={ttl} onChange={(e) => setTtl(Number(e.target.value) || 7)} />
              </div>
              {mode === "sync" && (
                <div>
                  <Label>What the partner can do</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {PERMS.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={!!perms[p.key]}
                          onCheckedChange={(v) => setPerms((s) => ({ ...s, [p.key]: !!v }))}
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                  
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>Create invite</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Redeem a code</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="Paste code (e.g. AB4X8YQP)" value={code} onChange={(e) => setCode(e.target.value)} className="uppercase" />
          <Button onClick={() => redeemMut.mutate()} disabled={!code || redeemMut.isPending}>Connect</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">My invites</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(invites.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No invites yet.</p>}
          {(invites.data ?? []).map((inv: any) => {
            const expired = new Date(inv.expires_at) < new Date();
            const used = !!inv.used_at;
            return (
              <div key={inv.id} className="flex items-center gap-3 border rounded-md p-3">
                <code className="font-mono text-lg tracking-wider">{inv.code}</code>
                <Badge variant="outline">{inv.mode}</Badge>
                {used ? <Badge className="bg-green-600">Used</Badge> : expired ? <Badge variant="destructive">Expired</Badge> : <Badge variant="secondary">Active</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">Expires {new Date(inv.expires_at).toLocaleString()}</span>
                {!used && !expired && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => copyCode(inv.code)}><Copy className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await revoke({ data: { id: inv.id } }); qc.invalidateQueries({ queryKey: ["collab"] }); }}><Trash2 className="h-4 w-4" /></Button>
                  </>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Connections</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(connections.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No connections yet.</p>}
          {(connections.data ?? []).map((conn: any) => (
            <div key={conn.id} className="border rounded-md p-3">
              <div className="flex items-center gap-3">
                <div className="font-medium">{conn.other?.name ?? "Unknown"}</div>
                <Badge variant="outline">{conn.mode}</Badge>
                <Badge variant={conn.status === "active" ? "default" : "secondary"}>{conn.status}</Badge>
                {conn.i_am_owner && <Badge variant="secondary">You invited</Badge>}
                <div className="ml-auto flex gap-2">
                  {conn.i_am_owner && conn.mode === "sync" && (
                    <PermsEditor
                      value={conn.permissions ?? {}}
                      onSave={async (v) => { await updatePerms({ data: { id: conn.id, permissions: v } }); qc.invalidateQueries({ queryKey: ["collab"] }); toast.success("Permissions updated"); }}
                    />
                  )}
                  <Button size="sm" variant="destructive" onClick={async () => { if (confirm("Revoke this connection?")) { await revokeConn({ data: { id: conn.id } }); qc.invalidateQueries({ queryKey: ["collab"] }); } }}>Revoke</Button>
                </div>
              </div>
              {conn.mode === "sync" && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {PERMS.filter((p) => (conn.permissions ?? {})[p.key]).map((p) => (
                    <Badge key={p.key} variant="secondary">{p.label}</Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PermsEditor({ value, onSave }: { value: Record<string, boolean>; onSave: (v: Record<string, boolean>) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<Record<string, boolean>>(value);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setPerms(value); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Edit permissions</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit permissions</DialogTitle>
          <DialogDescription>Control what this connected company can access in shared trip flows.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {PERMS.map((p) => (
            <label key={p.key} className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!perms[p.key]} onCheckedChange={(v) => setPerms((s) => ({ ...s, [p.key]: !!v }))} />
              {p.label}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={async () => { await onSave(perms); setOpen(false); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
