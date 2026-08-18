import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Copy, Link2, MessageCircle, Trash2 } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import {
  extendMagicLink,
  generateMagicLink,
  getMagicLinkPreview,
  listDrivers,
  listMagicLinks,
  revokeMagicLink,
} from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DriverRow = Database["public"]["Tables"]["drivers"]["Row"];
type MagicLinkRow = Database["public"]["Tables"]["magic_links"]["Row"];
type DriverPreview = {
  company: { name: string };
  jobs: Array<{ id: string }>;
  paxByJob: Record<string, number>;
};

export function DriverAccessPanel() {
  const listFn = useServerFn(listMagicLinks);
  const genFn = useServerFn(generateMagicLink);
  const revokeFn = useServerFn(revokeMagicLink);
  const extendFn = useServerFn(extendMagicLink);
  const previewFn = useServerFn(getMagicLinkPreview);
  const driversFn = useServerFn(listDrivers);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["magic-links"],
    queryFn: () => listFn() as Promise<MagicLinkRow[]>,
  });
  const { data: drivers } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => driversFn() as Promise<DriverRow[]>,
  });
  const [label, setLabel] = useState("");
  const [subjectId, setSubjectId] = useState("__none__");
  const [ttl, setTtl] = useState("24");

  const refresh = () => qc.invalidateQueries({ queryKey: ["magic-links"] });
  const generate = useMutation({
    mutationFn: () =>
      genFn({
        data: {
          kind: "driver",
          subject_id: subjectId === "__none__" ? null : subjectId,
          subject_label: label || "Driver portal",
          ttl_hours: Number(ttl),
        },
      }),
    onSuccess: () => {
      toast.success("Driver App link generated");
      setLabel("");
      refresh();
    },
    onError: (error: Error) =>
      toast.error(error.message === "insufficient_points" ? "Top-Up Required" : error.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Driver App link revoked");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const extend = useMutation({
    mutationFn: (input: { id: string; ttl_hours: number }) => extendFn({ data: input }),
    onSuccess: () => {
      toast.success("Driver App link extended");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function promptExtend(id: string) {
    const raw = prompt("Extend link by how many hours? (24, 168, 720, or 8760)", "168");
    if (!raw) return;
    const hours = Math.max(1, Math.min(24 * 366, Number(raw) | 0));
    if (hours) extend.mutate({ id, ttl_hours: hours });
  }

  async function shareOnWhatsApp(id: string, url: string, subjectLabel: string) {
    try {
      const preview = await (previewFn({ data: { id } }) as Promise<DriverPreview>);
      const lines = [
        `🚐 ${preview?.company?.name ?? "Crew transport"} — Driver App`,
        `For: ${subjectLabel}`,
      ];
      if (preview?.jobs?.length) {
        const totalPax = Object.values(preview.paxByJob as Record<string, number>).reduce(
          (sum, value) => sum + value,
          0,
        );
        lines.push(
          `Upcoming: ${preview.jobs.length} trip${preview.jobs.length === 1 ? "" : "s"} · ${totalPax} pax`,
        );
      }
      lines.push("", `Open: ${url}`);
      window.open(
        `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`,
        "_blank",
        "noopener",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build Driver App preview");
    }
  }

  const rows = (data ?? []).filter((row) => row.kind === "driver");
  return (
    <section className="mt-8 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Driver App Access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create and manage the secure link a driver uses to open their Driver App.
        </p>
      </div>
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Driver</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick driver" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All / generic</SelectItem>
                {(drivers ?? []).map((driver) => (
                  <SelectItem key={driver.id} value={driver.id}>
                    {driver.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional label"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Expires in</Label>
            <Select value={ttl} onValueChange={setTtl}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8">8 hours</SelectItem>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="168">7 days</SelectItem>
                <SelectItem value="720">30 days</SelectItem>
                <SelectItem value="2160">90 days</SelectItem>
                <SelectItem value="4380">6 months</SelectItem>
                <SelectItem value="8760">1 year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            <Link2 className="mr-1 h-4 w-4" /> Generate Driver App link
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Driver / label</TableHead>
              <TableHead>Secure link</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No Driver App links yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
              const url =
                typeof window === "undefined"
                  ? `/m/driver/${row.token}`
                  : `${window.location.origin}/m/driver/${row.token}`;
              const inactive = !!row.revoked_at || new Date(row.expires_at) < new Date();
              return (
                <TableRow key={row.id} className={inactive ? "opacity-50" : ""}>
                  <TableCell>{row.subject_label}</TableCell>
                  <TableCell>
                    <div className="flex max-w-[360px] items-center gap-1">
                      <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                        {url}
                      </code>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Copy link"
                        onClick={() => {
                          navigator.clipboard.writeText(url);
                          toast.success("Copied");
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.revoked_at ? (
                      <span className="text-destructive">Revoked</span>
                    ) : new Date(row.expires_at) < new Date() ? (
                      <span className="text-destructive">Expired</span>
                    ) : (
                      `in ${formatDistanceToNowStrict(new Date(row.expires_at))}`
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {!inactive && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Share on WhatsApp"
                        onClick={() =>
                          shareOnWhatsApp(row.id, url, row.subject_label ?? "Driver portal")
                        }
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Extend expiry"
                      onClick={() => promptExtend(row.id)}
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </Button>
                    {!inactive && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Revoke link"
                        onClick={() => revoke.mutate(row.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
