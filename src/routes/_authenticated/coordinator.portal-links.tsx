import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import {
  listMagicLinks, generateMagicLink, revokeMagicLink, listDrivers, extendMagicLink,
  getMagicLinkPreview,
} from "@/lib/coordinator.functions";
import {
  listPortals, createPortal, updatePortal, rotatePortalToken, deletePortal,
  checkSlugAvailable, slugify,
} from "@/lib/portal.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Copy, Trash2, Link2, Clock, MessageCircle, Power, PowerOff, RotateCw,
  Image as ImageIcon, ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/coordinator/portal-links")({
  head: () => ({ meta: [{ title: "Portal Links — Coordinator" }] }),
  component: PortalLinksPage,
});

function PortalLinksPage() {
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold">Portal links</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Passwordless links that let drivers see their manifest, clients see their bookings, and hotels/agents/corporates run their own bookings dashboard.
      </p>
      <Tabs defaultValue="companies" className="mt-6">
        <TabsList>
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="driver">Drivers</TabsTrigger>
          <TabsTrigger value="client">Clients</TabsTrigger>
        </TabsList>
        <TabsContent value="companies" className="mt-4"><CompaniesPanel /></TabsContent>
        <TabsContent value="driver" className="mt-4"><LinksPanel kind="driver" /></TabsContent>
        <TabsContent value="client" className="mt-4"><LinksPanel kind="client" /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------- Companies (portals) ------------------------- */

const BRAND_DOMAIN = "thecoordinator.org";

function brandedUrl(slug: string | null | undefined) {
  if (!slug) return null;
  return `https://${slug}.${BRAND_DOMAIN}/portal`;
}
function rawTokenUrl(token: string) {
  if (typeof window === "undefined") return `/portal/${token}`;
  return `${window.location.origin}/portal/${token}`;
}

function CompaniesPanel() {
  const listFn = useServerFn(listPortals);
  const createFn = useServerFn(createPortal);
  const checkFn = useServerFn(checkSlugAvailable);
  const qc = useQueryClient();
  const { data: portals } = useQuery({ queryKey: ["portals"], queryFn: () => listFn() as Promise<any[]> });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [kind, setKind] = useState<"hotel" | "agent" | "corporate">("hotel");
  const [points, setPoints] = useState("3");
  const [expiryPreset, setExpiryPreset] = useState<string>("never");
  const [slugState, setSlugState] = useState<"idle" | "ok" | "taken" | "invalid" | "reserved" | "checking">("idle");
  const debounceRef = useRef<number | null>(null);

  const autoSlug = useMemo(() => (name ? slugify(name) : ""), [name]);
  const effectiveSlug = slugTouched ? slug : autoSlug;

  function onSlugChange(v: string) {
    setSlugTouched(true);
    const cleaned = v.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    setSlug(cleaned);
    triggerSlugCheck(cleaned);
  }
  function triggerSlugCheck(v: string) {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!v || v.length < 3) { setSlugState("idle"); return; }
    setSlugState("checking");
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await (checkFn({ data: { slug: v } }) as Promise<any>);
        if (r.ok) setSlugState("ok");
        else setSlugState(r.reason);
      } catch { setSlugState("idle"); }
    }, 350);
  }

  const create = useMutation({
    mutationFn: () => {
      const expiresAt = expiryToIso(expiryPreset);
      return createFn({ data: {
        name, kind, points_per_booking: Number(points) || 3,
        slug: effectiveSlug || undefined,
        link_expires_at: expiresAt,
      } });
    },
    onSuccess: () => {
      toast.success("Company portal created");
      setName(""); setSlug(""); setSlugTouched(false); setSlugState("idle");
      qc.invalidateQueries({ queryKey: ["portals"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        Send a company its own private dashboard where they can create bookings, chat with guests, and see their statements.
        Branded URLs look like <code className="bg-background px-1 rounded">yourhotel.{BRAND_DOMAIN}</code>.
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Company name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Grand Hotel Valletta" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Branded link</Label>
            <div className="flex items-center border rounded-md h-10 px-2 bg-background text-sm">
              <Input
                className="border-0 h-8 px-0 focus-visible:ring-0 flex-1 min-w-0"
                value={effectiveSlug}
                onChange={(e) => onSlugChange(e.target.value)}
                onFocus={() => setSlugTouched(true)}
                placeholder="grand-hotel"
              />
              <span className="text-muted-foreground text-xs whitespace-nowrap">.{BRAND_DOMAIN}</span>
            </div>
            <SlugHint state={slugState} slug={effectiveSlug} />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hotel">Hotel</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="corporate">Corporate</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Points / booking</Label>
            <Input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Link expiry</Label>
            <Select value={expiryPreset} onValueChange={setExpiryPreset}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 hour</SelectItem>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="168">7 days</SelectItem>
                <SelectItem value="720">30 days</SelectItem>
                <SelectItem value="never">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-6 flex justify-end">
            <Button
              onClick={() => create.mutate()}
              disabled={!name || create.isPending || slugState === "taken" || slugState === "invalid" || slugState === "reserved"}
            >
              <Link2 className="h-4 w-4 mr-1" /> Create company portal
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Branded URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!portals || portals.length === 0) && (
              <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                No company portals yet. Create one above.
              </TableCell></TableRow>
            )}
            {(portals ?? []).map((p) => (
              <CompanyRow key={p.id} portal={p} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SlugHint({ state, slug }: { state: string; slug: string }) {
  if (!slug || slug.length < 3) return <p className="text-[11px] text-muted-foreground">Auto-generated from name. 3–40 chars, letters, numbers, hyphens.</p>;
  if (state === "checking") return <p className="text-[11px] text-muted-foreground">Checking…</p>;
  if (state === "ok") return <p className="text-[11px] text-green-600">✓ Available</p>;
  if (state === "taken") return <p className="text-[11px] text-destructive">This URL is already taken.</p>;
  if (state === "invalid") return <p className="text-[11px] text-destructive">Only lowercase letters, numbers, and hyphens.</p>;
  if (state === "reserved") return <p className="text-[11px] text-destructive">This name is reserved.</p>;
  return null;
}

function CompanyRow({ portal }: { portal: any }) {
  const updateFn = useServerFn(updatePortal);
  const rotateFn = useServerFn(rotatePortalToken);
  const deleteFn = useServerFn(deletePortal);
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["portals"] });

  const branded = brandedUrl(portal.slug);
  const raw = rawTokenUrl(portal.magic_token);
  const shareUrl = branded || raw;

  const isExpired = portal.link_expires_at && new Date(portal.link_expires_at) < new Date();
  const status: "live" | "dormant" | "expired" | "disabled" =
    !portal.active ? "disabled" : isExpired ? "expired" : portal.link_enabled ? "live" : "dormant";

  const toggle = useMutation({
    mutationFn: () => updateFn({ data: { id: portal.id, patch: { link_enabled: !portal.link_enabled } } }),
    onSuccess: () => { toast.success(portal.link_enabled ? "Link dormant" : "Link revived"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rotate = useMutation({
    mutationFn: () => rotateFn({ data: { id: portal.id } }),
    onSuccess: () => { toast.success("Token rotated — old URL no longer works"); invalidate(); },
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id: portal.id } }),
    onSuccess: () => { toast.success("Deleted"); invalidate(); },
  });
  const extend = useMutation({
    mutationFn: (hoursOrNever: number | null) => updateFn({ data: { id: portal.id, patch: {
      link_expires_at: hoursOrNever === null ? null : new Date(Date.now() + hoursOrNever * 3600_000).toISOString(),
    } } }),
    onSuccess: () => { toast.success("Expiry updated"); invalidate(); },
  });

  function promptExpiry() {
    const raw = prompt(
      "Expire in how many hours? (24 = 1 day, 168 = 7 days, 720 = 30 days, or type 'never')",
      "168",
    );
    if (raw === null) return;
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "never" || trimmed === "") { extend.mutate(null); return; }
    const hours = Math.max(1, Math.min(24 * 366, Number(trimmed) | 0));
    if (!hours) return;
    extend.mutate(hours);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    toast.success(branded ? "Branded URL copied" : "Link copied");
  }

  function shareOnWhatsApp() {
    const lines = [
      `🏨 ${portal.name} — your booking portal`,
      `Create bookings, chat with guests, and see your statements.`,
      ``,
      `Open: ${shareUrl}`,
    ];
    if (branded && raw !== shareUrl) lines.push(`(Backup link: ${raw})`);
    const text = encodeURIComponent(lines.join("\n"));
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
  }

  return (
    <TableRow className={status === "disabled" || status === "expired" ? "opacity-60" : ""}>
      <TableCell>
        <div className="flex items-center gap-2">
          {portal.logo_url ? (
            <img src={portal.logo_url} alt="" className="h-8 w-8 rounded object-contain bg-background border" />
          ) : (
            <div className="h-8 w-8 rounded bg-primary/10 grid place-items-center text-[10px] font-semibold text-primary">
              {portal.name?.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-medium truncate">{portal.name}</div>
            <div className="text-[11px] text-muted-foreground capitalize">{portal.kind} · {Number(portal.points_per_booking ?? 3)} pts/booking</div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1 max-w-[340px]">
          <code className="text-xs bg-muted px-2 py-1 rounded truncate flex-1">
            {branded ? `${portal.slug}.${BRAND_DOMAIN}` : "(no slug)"}
          </code>
          <Button size="icon" variant="ghost" title="Copy link" onClick={copyLink}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <a href={shareUrl} target="_blank" rel="noopener" title="Open link">
            <Button size="icon" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /></Button>
          </a>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell className="text-xs">
        {isExpired ? <span className="text-destructive">Expired</span>
          : portal.link_expires_at ? <span title={new Date(portal.link_expires_at).toLocaleString()}>in {formatDistanceToNowStrict(new Date(portal.link_expires_at))}</span>
          : <span className="text-muted-foreground">Never</span>}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button size="icon" variant="ghost" title="Share on WhatsApp" onClick={shareOnWhatsApp}>
          <MessageCircle className="h-3.5 w-3.5" />
        </Button>
        <LogoUploadButton portalId={portal.id} onDone={invalidate} />
        <Button size="icon" variant="ghost" title="Set expiry" onClick={promptExpiry}>
          <Clock className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost"
          title={portal.link_enabled ? "Make dormant" : "Revive link"}
          onClick={() => toggle.mutate()}>
          {portal.link_enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
        </Button>
        <Button size="icon" variant="ghost" title="Rotate token"
          onClick={() => { if (confirm("Rotate the link? The old URL will stop working.")) rotate.mutate(); }}>
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" title="Delete"
          onClick={() => { if (confirm("Delete this company portal? All bookings and chats will be removed.")) del.mutate(); }}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: "live" | "dormant" | "expired" | "disabled" }) {
  const map = {
    live: { label: "Live", cls: "bg-green-500/20 text-green-700" },
    dormant: { label: "Dormant", cls: "bg-slate-500/20 text-slate-700" },
    expired: { label: "Expired", cls: "bg-red-500/20 text-red-700" },
    disabled: { label: "Off", cls: "bg-slate-500/20 text-slate-700" },
  } as const;
  const c = map[status];
  return <Badge className={c.cls}>{c.label}</Badge>;
}

function LogoUploadButton({ portalId, onDone }: { portalId: string; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const updateFn = useServerFn(updatePortal);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Max 2MB"); return; }
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${portalId}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("portal-logos").upload(path, file, { upsert: true, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("portal-logos").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      const url = signed?.signedUrl;
      if (!url) throw new Error("No signed URL");
      await updateFn({ data: { id: portalId, patch: { logo_url: url } } });
      toast.success("Logo updated");
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      <Button size="icon" variant="ghost" title="Upload logo" disabled={busy}
        onClick={() => inputRef.current?.click()}>
        <ImageIcon className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

function expiryToIso(preset: string): string | null {
  if (preset === "never") return null;
  const hours = Number(preset);
  if (!hours) return null;
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/* ------------------------- Drivers & Clients (unchanged) ------------------------- */

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

  const previewFn = useServerFn(getMagicLinkPreview);
  async function shareOnWhatsApp(id: string, url: string, label: string) {
    try {
      const preview = kind === "driver"
        ? await (previewFn({ data: { id } }) as Promise<any>)
        : null;
      const lines: string[] = [];
      lines.push(kind === "driver"
        ? `🚐 ${preview?.company?.name ?? "Crew transport"} — driver manifest`
        : `🚐 Client booking portal`);
      lines.push(`For: ${label}`);
      if (preview && preview.jobs?.length) {
        const totalPax = Object.values(preview.paxByJob as Record<string, number>)
          .reduce((a, b) => a + b, 0);
        lines.push(`Upcoming: ${preview.jobs.length} trip${preview.jobs.length === 1 ? "" : "s"} · ${totalPax} pax`);
        lines.push("");
        for (const j of preview.jobs.slice(0, 5)) {
          const when = j.pickup_at
            ? new Date(j.pickup_at).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            : `${j.date}${j.time ? " " + j.time.slice(0,5) : ""}`;
          const from = [j.from_location, j.from_flight].filter(Boolean).join(" ");
          const to = [j.to_location, j.to_flight].filter(Boolean).join(" ");
          const n = preview.paxByJob[j.id] ?? 0;
          lines.push(`• ${when} — ${from || "?"} → ${to || "?"} (${n} pax)`);
        }
        if (preview.jobs.length > 5) lines.push(`…and ${preview.jobs.length - 5} more`);
        lines.push("");
      }
      lines.push(`Open: ${url}`);
      const text = encodeURIComponent(lines.join("\n"));
      window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e.message ?? "Could not build preview");
    }
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
                    {!isDead && (
                      <Button size="icon" variant="ghost" title="Share on WhatsApp"
                        onClick={() => shareOnWhatsApp(r.id, url, r.subject_label)}>
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
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
