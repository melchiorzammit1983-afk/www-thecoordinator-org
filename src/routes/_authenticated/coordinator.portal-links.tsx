import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import {
  listMagicLinks, generateMagicLink, revokeMagicLink, listDrivers, extendMagicLink,
} from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Trash2, Link2, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/coordinator/portal-links")({
  head: () => ({ meta: [{ title: "Portal Links — Coordinator" }] }),
  component: PortalLinksPage,
});

function PortalLinksPage() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold">Portal links</h1>
      <p className="text-sm text-muted-foreground mt-1">Passwordless URLs that let drivers see their manifest and clients see their bookings.</p>
      <Tabs defaultValue="driver" className="mt-6">
        <TabsList>
          <TabsTrigger value="driver">Drivers</TabsTrigger>
          <TabsTrigger value="client">Clients</TabsTrigger>
        </TabsList>
        <TabsContent value="driver" className="mt-4"><LinksPanel kind="driver" /></TabsContent>
        <TabsContent value="client" className="mt-4"><LinksPanel kind="client" /></TabsContent>
      </Tabs>
    </div>
  );
}

function LinksPanel({ kind }: { kind: "driver" | "client" }) {
  const listFn = useServerFn(listMagicLinks);
  const genFn = useServerFn(generateMagicLink);
  const revokeFn = useServerFn(revokeMagicLink);
  const driversFn = useServerFn(listDrivers);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["magic-links"], queryFn: () => listFn() as Promise<any[]> });
  const { data: drivers } = useQuery({ queryKey: ["drivers"], queryFn: () => driversFn() as Promise<any[]>, enabled: kind === "driver" });

  const [label, setLabel] = useState("");
  const [subjectId, setSubjectId] = useState<string>("__none__");
  const [ttl, setTtl] = useState<string>("24");

  const genMut = useMutation({
    mutationFn: () => genFn({ data: {
      kind, subject_id: subjectId === "__none__" ? null : subjectId,
      subject_label: label || (kind === "driver" ? "Driver portal" : "Client portal"),
      ttl_hours: Number(ttl),
    }}),
    onSuccess: () => { toast.success("Link generated"); setLabel(""); qc.invalidateQueries({ queryKey: ["magic-links"] }); },
    onError: (e: Error) => e.message === "insufficient_points" ? toast.error("Top-Up Required") : toast.error(e.message),
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { id } }),
    onSuccess: () => { toast.success("Revoked"); qc.invalidateQueries({ queryKey: ["magic-links"] }); },
  });
  const extendFn = useServerFn(extendMagicLink);
  const extendMut = useMutation({
    mutationFn: (v: { id: string; ttl_hours: number }) => extendFn({ data: v }),
    onSuccess: () => { toast.success("Extended"); qc.invalidateQueries({ queryKey: ["magic-links"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  function promptExtend(id: string) {
    const raw = prompt("Extend link by how many hours? (24 = 1 day, 168 = 7 days, 720 = 30 days, 8760 = 1 year)", "168");
    if (!raw) return;
    const hours = Math.max(1, Math.min(24 * 366, Number(raw) | 0));
    if (!hours) return;
    extendMut.mutate({ id, ttl_hours: hours });
  }

  const rows = (data ?? []).filter((r) => r.kind === kind);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          {kind === "driver" ? (
            <div className="space-y-1.5">
              <Label>Driver</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger><SelectValue placeholder="Pick driver" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">All / generic</SelectItem>
                  {drivers?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5"><Label>Client email/name</Label><Input value={label} onChange={e=>setLabel(e.target.value)} placeholder="john@example.com" /></div>
          )}
          {kind === "driver" && (
            <div className="space-y-1.5"><Label>Label</Label><Input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Optional label" /></div>
          )}
          <div className="space-y-1.5">
            <Label>Expires in</Label>
            <Select value={ttl} onValueChange={setTtl}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 hour</SelectItem>
                <SelectItem value="8">8 hours</SelectItem>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="72">3 days</SelectItem>
                <SelectItem value="168">7 days</SelectItem>
                <SelectItem value="720">30 days</SelectItem>
                <SelectItem value="2160">90 days</SelectItem>
                <SelectItem value="4380">6 months</SelectItem>
                <SelectItem value="8760">1 year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => genMut.mutate()} disabled={genMut.isPending}>
            <Link2 className="h-4 w-4 mr-1" /> Generate
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No links yet.</TableCell></TableRow>}
            {rows.map((r) => {
              const url = typeof window !== "undefined"
                ? `${window.location.origin}/m/${r.kind}/${r.token}`
                : `/m/${r.kind}/${r.token}`;
              const isDead = r.revoked_at || new Date(r.expires_at) < new Date();
              return (
                <TableRow key={r.id} className={isDead ? "opacity-50" : ""}>
                  <TableCell>{r.subject_label}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 items-center max-w-[320px]">
                      <code className="text-xs bg-muted px-2 py-1 rounded truncate">{url}</code>
                      <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(url); toast.success("Copied"); }}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.revoked_at ? <span className="text-destructive">Revoked</span>
                      : new Date(r.expires_at) < new Date() ? <span className="text-destructive">Expired</span>
                      : `in ${formatDistanceToNowStrict(new Date(r.expires_at))}`}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" title="Extend expiry"
                      onClick={() => promptExtend(r.id)}>
                      <Clock className="h-3.5 w-3.5" />
                    </Button>
                    {!isDead && <Button size="icon" variant="ghost" onClick={() => revokeMut.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
