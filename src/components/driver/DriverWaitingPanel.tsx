import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Clock, Play, StopCircle, Plus, Trash2, Receipt, CheckCircle2, XCircle } from "lucide-react";
import {
  startWaitSession, stopWaitSession, addTripAdjustment, deleteTripAdjustment, getDriverJobPricing,
  getWaitProposalsForDriver, respondWaitProposal,
} from "@/lib/coordinator-public.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type Props = {
  token: string;
  jobId: string;
  status: string | null;
  fromLocation: string | null;
  toLocation: string | null;
};

const AIRPORT_RE = /\b(airport|arrivals?|MLA|luqa|terminal)\b/i;

function fmtHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
              : `${m}:${String(ss).padStart(2, "0")}`;
}

function money(n: number, currency = "EUR") {
  return new Intl.NumberFormat("en-MT", { style: "currency", currency }).format(n);
}

export function DriverWaitingPanel({ token, jobId, status, fromLocation, toLocation }: Props) {
  const qc = useQueryClient();
  const key = ["driver-pricing", token, jobId];
  const propKey = ["driver-wait-proposals", token, jobId];
  const pricingFn = useServerFn(getDriverJobPricing);
  const startFn = useServerFn(startWaitSession);
  const stopFn = useServerFn(stopWaitSession);
  const addFn = useServerFn(addTripAdjustment);
  const delFn = useServerFn(deleteTripAdjustment);
  const proposalsFn = useServerFn(getWaitProposalsForDriver);
  const respondFn = useServerFn(respondWaitProposal);

  const active = status === "arrived" || status === "in_progress";
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => pricingFn({ data: { token, job_id: jobId } }),
    refetchInterval: 5_000,
    enabled: active || status === "completed",
  });
  const { data: proposals } = useQuery({
    queryKey: propKey,
    queryFn: () => proposalsFn({ data: { token, job_id: jobId } }),
    refetchInterval: 10_000,
    enabled: active || status === "completed",
  });

  const openWait = (data as any)?.open_wait as null | { id: string; started_at: string; free_ends_at: string | null };
  const adjustments = ((data as any)?.adjustments ?? []) as any[];
  const total = Number((data as any)?.total ?? 0);
  const currency = ((data as any)?.currency ?? "EUR") as string;
  const freeWaitMinutes: number = Number((data as any)?.free_wait_minutes ?? 5);
  const ratePerMinute: number = Number((data as any)?.waiting_rate_per_minute ?? 0);
  const serverLiveCharge: number = Number((data as any)?.live_charge ?? 0);
  const pendingProposals = ((proposals ?? []) as any[]).filter((p: any) => p.status === "pending");
  const canManageAdjustments = active || status === "completed";

  // Live-ticking elapsed while a session is open
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!openWait) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [openWait]);
  const elapsedSec = openWait ? Math.floor((nowMs - new Date(openWait.started_at).getTime()) / 1000) : 0;

  // Live charge computed client-side (mirrors server calculation, updates every second)
  const liveCharge = useMemo(() => {
    if (!openWait || ratePerMinute === 0) return serverLiveCharge;
    const elapsedMs = nowMs - new Date(openWait.started_at).getTime();
    let chargeableMs: number;
    if (openWait.free_ends_at) {
      chargeableMs = Math.max(0, nowMs - new Date(openWait.free_ends_at).getTime());
    } else {
      chargeableMs = Math.max(0, elapsedMs - freeWaitMinutes * 60000);
    }
    return Math.round((chargeableMs / 60000) * ratePerMinute * 100) / 100;
  }, [nowMs, openWait, ratePerMinute, freeWaitMinutes, serverLiveCharge]);

  // Free-window remaining (ms until free_ends_at, or 0 if already elapsed)
  const freeRemainingMs = useMemo(() => {
    if (!openWait?.free_ends_at) return null;
    const rem = new Date(openWait.free_ends_at).getTime() - nowMs;
    return rem > 0 ? rem : 0;
  }, [nowMs, openWait]);
  const inFreeWindow = freeRemainingMs !== null && freeRemainingMs > 0;

  // Stop-waiting sheet
  const [stopOpen, setStopOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  // Add-charge sheet
  const [chargeOpen, setChargeOpen] = useState<null | "extra_stop" | "toll" | "other">(null);
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeLabel, setChargeLabel] = useState("");
  const [chargeNote, setChargeNote] = useState("");

  const startMut = useMutation({
    mutationFn: (source: "manual" | "auto_stopped" | "auto_airport") =>
      startFn({ data: { token, job_id: jobId, source } }),
    onSuccess: () => { toast.success("Waiting timer started"); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const stopMut = useMutation({
    mutationFn: () => stopFn({ data: {
      token, job_id: jobId,
      agreed_amount: Number(amount || 0),
      note: note.trim() || undefined,
    }}),
    onSuccess: () => {
      toast.success("Waiting time saved");
      setStopOpen(false); setAmount(""); setNote("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const addMut = useMutation({
    mutationFn: () => addFn({ data: {
      token, job_id: jobId,
      kind: chargeOpen!,
      amount: Number(chargeAmount || 0),
      label: chargeLabel.trim() || undefined,
      note: chargeNote.trim() || undefined,
    }}),
    onSuccess: () => {
      toast.success("Charge added");
      setChargeOpen(null); setChargeAmount(""); setChargeLabel(""); setChargeNote("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { token, job_id: jobId, adjustment_id: id } }),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const respondMut = useMutation({
    mutationFn: ({ proposalId, accept, driverNote }: { proposalId: string; accept: boolean; driverNote?: string }) =>
      respondFn({ data: { token, job_id: jobId, proposal_id: proposalId, accept, driver_note: driverNote } }),
    onSuccess: (_, vars) => {
      toast.success(vars.accept ? "Proposal accepted" : "Proposal rejected");
      qc.invalidateQueries({ queryKey: propKey });
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-suggest: airport arrivals >60 min after status becomes 'arrived'
  const airportTimer = useRef<number | null>(null);
  const snoozeUntil = useRef<number>(0);
  const isAirport = useMemo(
    () => AIRPORT_RE.test(fromLocation ?? "") || AIRPORT_RE.test(toLocation ?? ""),
    [fromLocation, toLocation],
  );
  useEffect(() => {
    if (airportTimer.current) { clearTimeout(airportTimer.current); airportTimer.current = null; }
    if (!isAirport || status !== "arrived" || openWait) return;
    airportTimer.current = window.setTimeout(() => {
      if (Date.now() < snoozeUntil.current) return;
      toast.info("You've been at the airport for a while — start the waiting timer?", {
        duration: 20_000,
        action: { label: "Start", onClick: () => startMut.mutate("auto_airport") },
        onDismiss: () => { snoozeUntil.current = Date.now() + 10 * 60_000; },
      });
    }, 60 * 60_000);
    return () => { if (airportTimer.current) clearTimeout(airportTimer.current); };
  }, [isAirport, status, openWait, startMut]);

  // Auto-suggest: car stopped for 5+ min (speed < 3 km/h). Uses its own light watcher.
  const stoppedSinceRef = useRef<number | null>(null);
  const stoppedPromptedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!active || openWait || typeof navigator === "undefined" || !navigator.geolocation) return;
    stoppedSinceRef.current = null;
    stoppedPromptedRef.current = false;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const kmh = (pos.coords.speed ?? 0) * 3.6;
        if (kmh < 3) {
          if (stoppedSinceRef.current == null) stoppedSinceRef.current = Date.now();
          const stoppedFor = Date.now() - (stoppedSinceRef.current ?? Date.now());
          if (stoppedFor >= 5 * 60_000 && !stoppedPromptedRef.current && Date.now() >= snoozeUntil.current) {
            stoppedPromptedRef.current = true;
            toast.info("You've been stopped for 5 min — start the waiting timer?", {
              duration: 20_000,
              action: { label: "Start", onClick: () => startMut.mutate("auto_stopped") },
              onDismiss: () => { snoozeUntil.current = Date.now() + 10 * 60_000; stoppedPromptedRef.current = false; },
            });
          }
        } else {
          stoppedSinceRef.current = null;
          stoppedPromptedRef.current = false;
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => { try { navigator.geolocation.clearWatch(id); } catch { /* noop */ } };
  }, [active, openWait, startMut]);

  if (!canManageAdjustments && !adjustments.length && !pendingProposals.length) return null;

  return (
    <section className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-amber-900 text-sm font-semibold">
          <Clock className="h-4 w-4" /> Waiting time & charges
        </div>
        {openWait && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 text-white text-xs px-2.5 py-1 font-mono">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            {fmtHMS(elapsedSec)}
          </div>
        )}
      </div>

      {/* Free-window / live-charge indicator */}
      {openWait && (
        <div className="flex items-center gap-2 flex-wrap">
          {inFreeWindow ? (
            <span className="text-xs rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 font-medium">
              Free window — {fmtHMS(Math.floor((freeRemainingMs ?? 0) / 1000))} remaining
            </span>
          ) : (
            <span className="text-xs rounded-full bg-rose-100 text-rose-700 px-2.5 py-1 font-medium">
              Chargeable
            </span>
          )}
          {ratePerMinute > 0 && (
            <span className="text-xs font-mono text-amber-900">
              Est. {money(liveCharge, currency)}
            </span>
          )}
        </div>
      )}

      {/* Coordinator proposals */}
      {pendingProposals.length > 0 && (
        <div className="space-y-2">
          {pendingProposals.map((p: any) => (
            <div key={p.id} className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm space-y-1.5">
              <div className="font-semibold text-blue-900">Coordinator proposes {money(Number(p.proposed_amount), currency)}</div>
              {p.note && <div className="text-xs text-blue-700 italic">"{p.note}"</div>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8"
                  onClick={() => respondMut.mutate({ proposalId: p.id, accept: true })}
                  disabled={respondMut.isPending}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Accept
                </Button>
                <Button size="sm" variant="outline" className="h-8 border-rose-300 text-rose-700 hover:bg-rose-50"
                  onClick={() => respondMut.mutate({ proposalId: p.id, accept: false })}
                  disabled={respondMut.isPending}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {canManageAdjustments && (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            {(active || (status === "completed" && openWait)) && (
              openWait ? (
                <Button className="flex-1 bg-amber-600 hover:bg-amber-700" onClick={() => {
                  setAmount(liveCharge > 0 ? liveCharge.toFixed(2) : "");
                  setNote(""); setStopOpen(true);
                }}>
                  <StopCircle className="h-4 w-4 mr-2" /> Stop waiting
                </Button>
              ) : (
                <Button className="flex-1 bg-amber-500 hover:bg-amber-600 text-white" onClick={() => startMut.mutate("manual")} disabled={startMut.isPending}>
                  <Play className="h-4 w-4 mr-2" /> Start waiting
                </Button>
              )
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className={active ? "" : "w-full"}>
                  <Plus className="h-4 w-4 mr-1" /> Add charge
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setChargeAmount(""); setChargeLabel(""); setChargeNote(""); setChargeOpen("extra_stop"); }}>Extra stop</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setChargeAmount(""); setChargeLabel(""); setChargeNote(""); setChargeOpen("toll"); }}>Toll</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setChargeAmount(""); setChargeLabel(""); setChargeNote(""); setChargeOpen("other"); }}>Other</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {status === "completed" && (
            <p className="text-xs text-amber-900/80">
              Trip finished — you can still add or remove non-waiting charges here.
            </p>
          )}
        </div>
      )}

      {adjustments.length > 0 && (
        <ul className="text-sm divide-y divide-amber-200/70 bg-white/70 rounded-xl">
          {adjustments.map((a) => {
            const canDelete = canManageAdjustments && a.kind !== "waiting";
            return (
              <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-slate-800 truncate">
                    <span className="font-medium capitalize">{a.kind.replace("_", " ")}</span>
                    {a.label && <span className="text-slate-500"> — {a.label}</span>}
                  </div>
                  {a.driver_note && <div className="text-xs text-slate-500 truncate">{a.driver_note}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="font-mono text-sm">{money(Number(a.amount), a.currency ?? "EUR")}</div>
                  {canDelete && (
                    <button className="text-slate-400 hover:text-rose-600" onClick={() => delMut.mutate(a.id)} aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          <li className="flex items-center justify-between px-3 py-2 text-sm bg-amber-100/60 rounded-b-xl">
            <div className="flex items-center gap-1.5 text-slate-700"><Receipt className="h-4 w-4" /> Trip total</div>
            <div className="font-semibold font-mono">{money(total, currency)}</div>
          </li>
        </ul>
      )}

      {/* Stop-waiting sheet */}
      <Dialog open={stopOpen} onOpenChange={setStopOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop waiting</DialogTitle>
            <DialogDescription>
              {ratePerMinute > 0
                ? "Calculated charge is pre-filled. You can adjust the agreed amount before saving."
                : "Enter the waiting charge you agreed with the coordinator."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">Waited <span className="font-mono font-semibold">{fmtHMS(elapsedSec)}</span></div>
            {ratePerMinute > 0 && (
              <div className="text-xs text-slate-500">
                Calculated: <span className="font-mono font-medium text-slate-700">{money(liveCharge, currency)}</span>
                {" "}({freeWaitMinutes > 0 ? `after ${freeWaitMinutes} min free` : "no free window"}, {money(ratePerMinute, currency)}/min)
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="wait-amount">Agreed charge ({currency}) *</Label>
              <Input id="wait-amount" type="number" min={0} step="0.01" inputMode="decimal"
                value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 15.00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wait-note">Note (optional)</Label>
              <Textarea id="wait-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                placeholder="e.g. Flight delayed, agreed with Anna" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStopOpen(false)}>Cancel</Button>
            <Button onClick={() => stopMut.mutate()} disabled={stopMut.isPending || amount === ""}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add-charge sheet */}
      <Dialog open={chargeOpen !== null} onOpenChange={(v) => { if (!v) setChargeOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {chargeOpen?.replace("_", " ")}</DialogTitle>
            <DialogDescription>This will be added to the trip statement.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="chg-amount">Amount ({currency}) *</Label>
              <Input id="chg-amount" type="number" min={0} step="0.01" inputMode="decimal"
                value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chg-label">Short label (optional)</Label>
              <Input id="chg-label" value={chargeLabel} onChange={(e) => setChargeLabel(e.target.value)} maxLength={80} placeholder="e.g. Mriehel detour" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chg-note">Note (optional)</Label>
              <Textarea id="chg-note" value={chargeNote} onChange={(e) => setChargeNote(e.target.value)} maxLength={500} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChargeOpen(null)}>Cancel</Button>
            <Button onClick={() => addMut.mutate()} disabled={addMut.isPending || chargeAmount === ""}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
