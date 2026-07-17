import { useMemo, useState } from "react";
import { Copy, ExternalLink, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { displayLocation } from "@/lib/trip-display";

export type NewTripRow = {
  id: string;
  client_link_token?: string | null;
  from_location?: string | null;
  to_location?: string | null;
  pickup_display_name?: string | null;
  dropoff_display_name?: string | null;
  date?: string | null;
  time?: string | null;
  pickup_at?: string | null;
  from_flight?: string | null;
  to_flight?: string | null;
  clientcompanyname?: string | null;
  vehicle?: string | null;
  group_name?: string | null;
  _validation?: {
    warnings?: string[];
    labels?: { expected: number; inserted: number };
    pax?: { expected: number; inserted: number };
  } | null;
};

function trackUrl(token: string) {
  if (typeof window === "undefined") return `/t/${token}`;
  return `${window.location.origin}/t/${token}`;
}

function TripRow({ trip }: { trip: NewTripRow }) {
  const [copied, setCopied] = useState(false);
  const token = trip.client_link_token || "";
  const url = token ? trackUrl(token) : "";
  const paxCount = trip._validation?.pax?.inserted ?? 0;
  const labelCount = trip._validation?.labels?.inserted ?? 0;
  const warnings = trip._validation?.warnings ?? [];

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {displayLocation(trip.from_location, trip.pickup_display_name)}
            {trip.from_flight ? ` · ${trip.from_flight}` : ""}
            <span className="text-muted-foreground"> → </span>
            {displayLocation(trip.to_location, trip.dropoff_display_name)}
            {trip.to_flight ? ` · ${trip.to_flight}` : ""}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {trip.date}{trip.time ? ` · ${trip.time}` : ""}
            {trip.clientcompanyname ? ` · ${trip.clientcompanyname}` : ""}
            {trip.vehicle ? ` · ${trip.vehicle}` : ""}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="secondary" className="text-[10px]">{paxCount} pax</Badge>
          {labelCount > 0 && <Badge variant="outline" className="text-[10px]">{labelCount} labels</Badge>}
        </div>
      </div>

      {token ? (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
          <code className="text-[11px] truncate flex-1 text-muted-foreground">{url}</code>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" asChild>
            <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
          </Button>
        </div>
      ) : (
        <div className="text-xs text-destructive">No client link token was minted.</div>
      )}

      {warnings.length > 0 && (
        <ul className="text-[11px] text-amber-600 list-disc pl-4">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

export function NewTripsPreviewDialog({
  open,
  onOpenChange,
  title = "New trips created",
  description = "Verify each new trip and its client tracking link.",
  trips,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  description?: string;
  trips: NewTripRow[];
}) {
  const rows = useMemo(() => trips.filter(Boolean), [trips]);

  async function copyAll() {
    const lines = rows
      .filter((t) => t.client_link_token)
      .map((t) => `${displayLocation(t.from_location, t.pickup_display_name)} → ${displayLocation(t.to_location, t.dropoff_display_name)}: ${trackUrl(t.client_link_token as string)}`);
    if (!lines.length) return;
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success(`Copied ${lines.length} links`);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trips returned.</p>
          ) : (
            rows.map((t) => <TripRow key={t.id} trip={t} />)
          )}
        </div>
        <DialogFooter className="gap-2">
          {rows.length > 1 && (
            <Button variant="outline" onClick={copyAll}>Copy all links</Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
