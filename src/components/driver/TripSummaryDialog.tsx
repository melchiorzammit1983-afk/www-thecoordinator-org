import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/mobile/ResponsiveDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Timer, Clock, Receipt, Wallet, FileText } from "lucide-react";
import {
  driverFinalizeTrip, getDriverTripSummaryPrefill,
} from "@/lib/coordinator-public.functions";

import { displayLocation } from "@/lib/trip-display";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  job: {
    id: string;
    from_location: string;
    to_location: string;
    pickup_display_name?: string | null;
    dropoff_display_name?: string | null;
    pickup_at: string | null;
    date?: string;
    time?: string;
  } | null;
};

const CURRENCIES = ["EUR", "USD", "GBP"];

function fmtDuration(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function TripSummaryDialog({ open, onOpenChange, token, job }: Props) {
  const qc = useQueryClient();
  const prefillFn = useServerFn(getDriverTripSummaryPrefill);
  const finalizeFn = useServerFn(driverFinalizeTrip);

  const { data: prefill } = useQuery({
    queryKey: ["driver-trip-summary-prefill", job?.id],
    queryFn: () => prefillFn({ data: { token, job_id: job!.id } }) as Promise<{
      pickup_at: string | null; driver_started_at: string | null; created_at: string | null;
      from_location: string; to_location: string;
    }>,
    enabled: !!(open && job?.id),
  });

  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [method, setMethod] = useState<"cash" | "invoice" | null>(null);
  const [km, setKm] = useState("");
  const [note, setNote] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    if (!open) return;
    setPrice(""); setKm(""); setNote("");
    setCurrency("EUR"); setMethod(null);
  }, [open, job?.id]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open]);

  const startedAt = prefill?.driver_started_at ?? prefill?.pickup_at ?? prefill?.created_at ?? null;
  const liveMinutes = useMemo(() => {
    if (!startedAt) return null;
    const ms = new Date(startedAt).getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.round((nowTick - ms) / 60_000));
  }, [startedAt, nowTick]);

  const mut = useMutation({
    mutationFn: () => finalizeFn({
      data: {
        token,
        job_id: job!.id,
        price_amount: price.trim() === "" ? null : Number(price.replace(",", ".")),
        price_currency: currency,
        payment_method: method,
        driver_reported_km: km.trim() === "" ? null : Number(km.replace(",", ".")),
        note: note.trim() || undefined,
      },
    }),
    onSuccess: () => {
      toast.success("Trip finished");
      qc.invalidateQueries({ queryKey: ["driver-manifest", token] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSave = (() => {
    if (price.trim() === "") return true; // driver can skip price entirely
    const n = Number(price.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return false;
    return method !== null;
  })();

  if (!job) return null;
  return (
    <ResponsiveDialog open={open} onOpenChange={(v) => { if (!mut.isPending) onOpenChange(v); }}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Finish trip
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Confirm what you did on this trip. The coordinator will see the price — the client will not.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {/* Summary card */}
        <div className="rounded-lg border p-3 bg-muted/40 text-sm space-y-1.5">
          <div className="font-medium leading-tight">{displayLocation(job.from_location, job.pickup_display_name)} → {displayLocation(job.to_location, job.dropoff_display_name)}</div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Started
              <span className="text-foreground font-medium ml-auto">{fmtTime(startedAt)}</span>
            </div>
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" /> Duration
              <span className="text-foreground font-medium ml-auto">{fmtDuration(liveMinutes)}</span>
            </div>
          </div>
        </div>

        {/* Price */}
        <div className="space-y-2">
          <Label className="text-sm inline-flex items-center gap-1.5">
            <Receipt className="h-4 w-4" /> Trip price
            <span className="text-[10px] text-muted-foreground font-normal">(coordinator-only)</span>
          </Label>
          <div className="flex gap-2">
            <Input
              type="number" inputMode="decimal" min={0} step="0.01"
              placeholder="e.g. 45.00" value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="flex-1"
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={currency} onChange={(e) => setCurrency(e.target.value)}
              aria-label="Currency"
            >
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Leave empty if the coordinator will price this trip.
          </p>
        </div>

        {/* Payment method */}
        <div className="space-y-2">
          <Label className="text-sm">How is it paid?</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMethod("cash")}
              className={`rounded-lg border p-3 text-left transition ${
                method === "cash" ? "border-emerald-500 bg-emerald-500/10" : "hover:bg-muted"
              }`}
            >
              <div className="inline-flex items-center gap-2 font-medium text-sm">
                <Wallet className="h-4 w-4" /> Paid by client
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">On the spot / cash</div>
            </button>
            <button
              type="button"
              onClick={() => setMethod("invoice")}
              className={`rounded-lg border p-3 text-left transition ${
                method === "invoice" ? "border-primary bg-primary/10" : "hover:bg-muted"
              }`}
            >
              <div className="inline-flex items-center gap-2 font-medium text-sm">
                <FileText className="h-4 w-4" /> Invoice to company
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Bill the trip creator</div>
            </button>
          </div>
        </div>

        {/* Optional extras */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Distance (km, optional)</Label>
            <Input type="number" min={0} step="0.1" value={km} onChange={(e) => setKm(e.target.value)} placeholder="e.g. 32" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Note to coordinator (optional)</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Waited 20 min, tunnel closed, extras…" />
        </div>

        {method && (
          <Badge
            variant="outline"
            className={method === "cash"
              ? "border-emerald-500/60 text-emerald-700 dark:text-emerald-400"
              : "border-primary/60 text-primary"}
          >
            {method === "cash" ? "Will mark as PAID" : "Will bill the trip creator"}
          </Badge>
        )}

        <ResponsiveDialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!canSave || mut.isPending}
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {mut.isPending ? "Saving…" : "Finish trip"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
