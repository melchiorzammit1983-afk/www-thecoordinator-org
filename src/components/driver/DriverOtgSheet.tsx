/**
 * Driver "On The Go" trip starter (v3 — one-tap).
 *
 * The driver taps a single big button. We grab their GPS, reverse-geocode
 * it server-side to a street/place name, and create the trip at
 * `status = "en_route"`. Extra pickup stops, passengers and the final
 * destination are added later from the trip card via `OtgManageDialog`.
 *
 * A coordinator picker appears only when the driver is linked to more
 * than one company — otherwise their home coordinator is used silently.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listOtgCoordinators, startOnTheGoTrip } from "@/lib/driver-otg.functions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, PlayCircle } from "lucide-react";

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

  useEffect(() => {
    if (!open) setCoordinatorId("");
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
      },
    }),
    onSuccess: (res) => {
      toast.success("Trip started — mark Arrived when you get to the pickup.");
      onCreated?.(res.job_id);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not start trip"),
  });

  const multiCoord = (coords?.coordinators?.length ?? 0) > 1;
  const canStart = !!coordinatorId && !!pos && !startMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start on-the-go trip</DialogTitle>
          <DialogDescription>
            Pins your current location as the pickup. You'll add passengers,
            extra stops and the destination from the trip card as you go.
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
            {pos
              ? `GPS locked (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)})`
              : "Locating GPS… allow location to continue."}
          </div>

          <Button
            onClick={() => startMut.mutate()}
            disabled={!canStart}
            size="lg"
            className="w-full h-14 text-base font-semibold"
          >
            {startMut.isPending
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : (<><PlayCircle className="h-5 w-5 mr-2" /> Start trip here</>)}
          </Button>

          <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
