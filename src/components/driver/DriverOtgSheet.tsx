/**
 * Driver "On The Go" trip wizard.
 *
 * Walks a driver through: pick coordinator → start (uses geolocation) →
 * add passengers at the current stop → either add another stop or finish
 * by entering the destination. Each step calls the driver-otg server fns.
 *
 * All actions are additive: they create a new job with `created_by_driver=true`
 * and `needs_review=true` so the coordinator can review/finalize afterwards.
 * Existing driver flows are untouched.
 */
import { useState, useEffect, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listOtgCoordinators, startOnTheGoTrip, otgAddStop,
  otgAddPassenger, otgSetDestination,
} from "@/lib/driver-otg.functions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, UserPlus, Plus, Flag, ChevronRight } from "lucide-react";
import { AddressAutocomplete } from "@/components/address/AddressAutocomplete";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onCreated?: (jobId: string) => void;
};

type Coord = { lat: number; lng: number } | null;

function usePosition(open: boolean): Coord {
  const [pos, setPos] = useState<Coord>(null);
  useEffect(() => {
    if (!open) return;
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 3000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [open]);
  return pos;
}

export function DriverOtgSheet({ open, onOpenChange, token, onCreated }: Props) {
  const pos = usePosition(open);
  const [step, setStep] = useState<"pick" | "start" | "collect" | "finish">("pick");
  const [coordinatorId, setCoordinatorId] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [pickupLabel, setPickupLabel] = useState("");
  const [stopIndex, setStopIndex] = useState(0);

  // reset when dialog reopens
  useEffect(() => {
    if (!open) {
      setStep("pick"); setJobId(null); setStopIndex(0); setPickupLabel("");
      setCoordinatorId("");
    }
  }, [open]);

  const listFn = useServerFn(listOtgCoordinators);
  const { data: coords, isLoading: loadingCoords } = useQuery({
    enabled: open,
    queryKey: ["otg-coords", token],
    queryFn: () => listFn({ data: { token } }),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (coords && !coordinatorId) {
      setCoordinatorId(coords.home_company_id);
      if (coords.coordinators.length === 1) setStep("start");
    }
  }, [coords, coordinatorId]);

  const startFn = useServerFn(startOnTheGoTrip);
  const startMut = useMutation({
    mutationFn: () => startFn({
      data: {
        token,
        coordinator_company_id: coordinatorId || undefined,
        lat: pos?.lat, lng: pos?.lng,
        pickup_label: pickupLabel || undefined,
      },
    }),
    onSuccess: (res) => {
      setJobId(res.job_id);
      setStopIndex(0);
      setStep("collect");
      toast.success("Trip started — passengers appear on the coordinator dashboard");
      onCreated?.(res.job_id);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not start trip"),
  });

  const addStopFn = useServerFn(otgAddStop);
  const addStopMut = useMutation({
    mutationFn: (address: string) => addStopFn({
      data: { token, job_id: jobId!, lat: pos?.lat, lng: pos?.lng, address: address || undefined },
    }),
    onSuccess: (res) => {
      setStopIndex(res.stop_index);
      toast.success(`Stop ${res.stop_index + 1} added`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not add stop"),
  });

  const setDestFn = useServerFn(otgSetDestination);
  const setDestMut = useMutation({
    mutationFn: (payload: { to: string; place_id?: string; lat?: number; lng?: number }) =>
      setDestFn({
        data: {
          token, job_id: jobId!,
          to_location: payload.to,
          dropoff_place_id: payload.place_id,
          dropoff_lat: payload.lat, dropoff_lng: payload.lng,
        },
      }),
    onSuccess: () => {
      toast.success("Destination set — drive safe. Coordinator will finalize.");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not set destination"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>On The Go</DialogTitle>
          <DialogDescription>
            Create a trip from your current location. Add passengers as they board.
          </DialogDescription>
        </DialogHeader>

        {step === "pick" && (
          <div className="space-y-4">
            {loadingCoords ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <Label>Which coordinator is this for?</Label>
                <RadioGroup value={coordinatorId} onValueChange={setCoordinatorId} className="space-y-2">
                  {(coords?.coordinators ?? []).map((c) => (
                    <label key={c.id} className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
                      <RadioGroupItem value={c.id} />
                      <span className="text-sm font-medium">{c.name}</span>
                      {c.id === coords?.home_company_id && (
                        <Badge variant="outline" className="ml-auto text-[10px]">Home</Badge>
                      )}
                    </label>
                  ))}
                </RadioGroup>
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!coordinatorId} onClick={() => setStep("start")}>
                Continue <ChevronRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "start" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {pos ? `GPS ready (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)})` : "Locating GPS…"}
            </div>
            <div>
              <Label>Pickup label (optional)</Label>
              <Input
                value={pickupLabel}
                onChange={(e) => setPickupLabel(e.target.value)}
                placeholder="e.g. Hotel Excelsior main entrance"
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Leave blank to use your GPS location. You can rename it later.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("pick")}>Back</Button>
              <Button
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending}
                size="lg"
                className="min-w-[140px]"
              >
                {startMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start trip"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "collect" && jobId && (
          <CollectStep
            token={token}
            jobId={jobId}
            stopIndex={stopIndex}
            pos={pos}
            onAddStop={(addr) => addStopMut.mutate(addr)}
            addingStop={addStopMut.isPending}
            onFinish={() => setStep("finish")}
          />
        )}

        {step === "finish" && jobId && (
          <FinishStep
            onCancel={() => setStep("collect")}
            onSubmit={(payload) => setDestMut.mutate(payload)}
            submitting={setDestMut.isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CollectStep({
  token, jobId, stopIndex, pos, onAddStop, addingStop, onFinish,
}: {
  token: string; jobId: string; stopIndex: number; pos: Coord;
  onAddStop: (address: string) => void; addingStop: boolean; onFinish: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [markOnboard, setMarkOnboard] = useState(true);
  const [added, setAdded] = useState<string[]>([]);
  const [stopAddr, setStopAddr] = useState("");
  const addPaxFn = useServerFn(otgAddPassenger);

  const addPaxMut = useMutation({
    mutationFn: () => addPaxFn({
      data: {
        token, job_id: jobId,
        name: name.trim(), phone: phone.trim() || undefined, note: note.trim() || undefined,
        mark_onboard: markOnboard,
        lat: pos?.lat, lng: pos?.lng,
      },
    }),
    onSuccess: () => {
      setAdded((a) => [...a, name.trim()]);
      setName(""); setPhone(""); setNote("");
      toast.success(markOnboard ? "Passenger boarded" : "Passenger added");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not add passenger"),
  });

  const submitAddStop = useCallback(() => {
    onAddStop(stopAddr);
    setStopAddr("");
    setAdded([]);
  }, [onAddStop, stopAddr]);

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/40 p-3 text-sm">
        <div className="font-medium">Stop {stopIndex + 1}</div>
        {added.length > 0 && (
          <div className="text-xs text-muted-foreground mt-1">
            Added: {added.join(", ")}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <Label htmlFor="otg-pax-name">Passenger name *</Label>
          <Input id="otg-pax-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div>
          <Label htmlFor="otg-pax-phone">Phone (optional)</Label>
          <Input id="otg-pax-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+356…" />
        </div>
        <div>
          <Label htmlFor="otg-pax-note">Note (optional)</Label>
          <Textarea id="otg-pax-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bag colour, allergies" rows={2} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={markOnboard} onChange={(e) => setMarkOnboard(e.target.checked)} />
          Mark as boarded now
        </label>
        <Button
          className="w-full"
          disabled={!name.trim() || addPaxMut.isPending}
          onClick={() => addPaxMut.mutate()}
        >
          {addPaxMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><UserPlus className="h-4 w-4 mr-1.5" /> Add passenger</>)}
        </Button>
      </div>

      <div className="border-t pt-3 space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Next stop</Label>
        <div className="flex gap-2">
          <Input value={stopAddr} onChange={(e) => setStopAddr(e.target.value)} placeholder="Another pickup address (optional)" />
          <Button variant="outline" onClick={submitAddStop} disabled={addingStop}>
            {addingStop ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Stop</>}
          </Button>
        </div>
        <Button variant="default" size="lg" className="w-full mt-2" onClick={onFinish} disabled={added.length === 0 && stopIndex === 0}>
          <Flag className="h-4 w-4 mr-1.5" /> Finish pickups → set destination
        </Button>
      </div>
    </div>
  );
}

function FinishStep({
  onCancel, onSubmit, submitting,
}: {
  onCancel: () => void;
  onSubmit: (p: { to: string; place_id?: string; lat?: number; lng?: number }) => void;
  submitting: boolean;
}) {
  const [addr, setAddr] = useState("");
  const [placeId, setPlaceId] = useState<string | undefined>();
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  return (
    <div className="space-y-4">
      <div>
        <Label>Destination</Label>
        <AddressAutocomplete
          value={addr}
          onChange={(pick) => {
            setAddr(pick.address);
            setPlaceId(pick.place_id ?? undefined);
            setLat(pick.lat ?? undefined);
            setLng(pick.lng ?? undefined);
          }}
          placeholder="Where are you dropping them off?"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        After you set the destination the trip continues like any other — mark
        it complete when you arrive. The coordinator will fill in the client
        name and confirm the fare.
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Back</Button>
        <Button
          disabled={!addr.trim() || submitting}
          onClick={() => onSubmit({ to: addr.trim(), place_id: placeId, lat, lng })}
          size="lg"
          className="min-w-[140px]"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & drive"}
        </Button>
      </DialogFooter>
    </div>
  );
}
