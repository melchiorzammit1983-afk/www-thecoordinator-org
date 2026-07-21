/**
 * Driver "On The Go" trip starter (v2).
 *
 * Simplified single-step form. The driver picks the coordinator, optionally
 * types a pickup label + destination, and taps Start. The trip is created
 * at `status = "en_route"` and immediately shows up on the manifest as a
 * normal trip — the driver then uses the same Arrived / Waiting / Boarded
 * / Complete buttons. Passengers and extra stops are added later from the
 * trip card (see `OtgManageDialog`).
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listOtgCoordinators, startOnTheGoTrip,
} from "@/lib/driver-otg.functions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin } from "lucide-react";
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
  const [coordinatorId, setCoordinatorId] = useState<string>("");
  const [pickupLabel, setPickupLabel] = useState("");
  const [destAddr, setDestAddr] = useState("");
  const [destPlaceId, setDestPlaceId] = useState<string | undefined>();
  const [destLat, setDestLat] = useState<number | undefined>();
  const [destLng, setDestLng] = useState<number | undefined>();

  useEffect(() => {
    if (!open) {
      setPickupLabel(""); setDestAddr(""); setDestPlaceId(undefined);
      setDestLat(undefined); setDestLng(undefined); setCoordinatorId("");
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
    if (coords && !coordinatorId) setCoordinatorId(coords.home_company_id);
  }, [coords, coordinatorId]);

  const startFn = useServerFn(startOnTheGoTrip);
  const startMut = useMutation({
    mutationFn: () => startFn({
      data: {
        token,
        coordinator_company_id: coordinatorId || undefined,
        lat: pos?.lat, lng: pos?.lng,
        pickup_label: pickupLabel.trim() || undefined,
        to_location: destAddr.trim() || undefined,
        dropoff_place_id: destPlaceId,
        dropoff_lat: destLat, dropoff_lng: destLng,
      },
    }),
    onSuccess: (res) => {
      toast.success("Trip started — use the trip card to mark Arrived, Waiting, Boarded and Complete.");
      onCreated?.(res.job_id);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not start trip"),
  });

  const multiCoord = (coords?.coordinators?.length ?? 0) > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start on-the-go trip</DialogTitle>
          <DialogDescription>
            Creates a live trip from your current location. Add passengers
            and extra pickup stops from the trip card once it's started.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loadingCoords ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : multiCoord ? (
            <div className="space-y-2">
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
            </div>
          ) : null}

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
              Leave blank to use your GPS location.
            </p>
          </div>

          <div>
            <Label>Destination (optional)</Label>
            <AddressAutocomplete
              value={destAddr}
              onChange={(pick) => {
                setDestAddr(pick.address);
                setDestPlaceId(pick.place_id ?? undefined);
                setDestLat(pick.lat ?? undefined);
                setDestLng(pick.lng ?? undefined);
              }}
              placeholder="Where are you heading? (can add later)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending || !coordinatorId}
            size="lg"
            className="min-w-[140px]"
          >
            {startMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start trip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
