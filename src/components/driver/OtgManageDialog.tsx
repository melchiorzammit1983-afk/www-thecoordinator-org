/**
 * Manage an ongoing driver "On The Go" trip.
 *
 * Lets the driver add passengers to the current stop, add another pickup
 * stop, (re)set the destination, or delete the trip while it's still in
 * `needs_review` state (before the coordinator finalizes it).
 *
 * The driver keeps using the normal trip card buttons (Arrived, Waiting,
 * Boarded, Complete) for the trip lifecycle itself — this dialog only
 * handles the OTG-specific extensions.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  otgAddStop, otgAddPassenger, otgSetDestination, otgDeleteJob,
} from "@/lib/driver-otg.functions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, UserPlus, Plus, Flag, Trash2 } from "lucide-react";
import { AddressAutocomplete } from "@/components/address/AddressAutocomplete";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  jobId: string;
  canDelete: boolean;
};

function useCurrentPos(open: boolean) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!open || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 3000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [open]);
  return pos;
}

export function OtgManageDialog({ open, onOpenChange, token, jobId, canDelete }: Props) {
  const qc = useQueryClient();
  const pos = useCurrentPos(open);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [markOnboard, setMarkOnboard] = useState(true);

  const [stopAddr, setStopAddr] = useState("");
  const [stopPlaceId, setStopPlaceId] = useState<string | undefined>();

  const [destAddr, setDestAddr] = useState("");
  const [destPlaceId, setDestPlaceId] = useState<string | undefined>();
  const [destLat, setDestLat] = useState<number | undefined>();
  const [destLng, setDestLng] = useState<number | undefined>();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["driver-manifest"] });

  const addPaxFn = useServerFn(otgAddPassenger);
  const addPax = useMutation({
    mutationFn: () => addPaxFn({
      data: {
        token, job_id: jobId,
        name: name.trim(), phone: phone.trim() || undefined, note: note.trim() || undefined,
        mark_onboard: markOnboard,
        lat: pos?.lat, lng: pos?.lng,
      },
    }),
    onSuccess: () => {
      toast.success(markOnboard ? "Passenger boarded" : "Passenger added");
      setName(""); setPhone(""); setNote("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not add passenger"),
  });

  const addStopFn = useServerFn(otgAddStop);
  const addStop = useMutation({
    mutationFn: () => addStopFn({
      data: {
        token, job_id: jobId,
        address: stopAddr.trim() || undefined,
        lat: pos?.lat, lng: pos?.lng,
      },
    }),
    onSuccess: () => {
      toast.success("Stop added");
      setStopAddr(""); setStopPlaceId(undefined);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not add stop"),
  });

  const setDestFn = useServerFn(otgSetDestination);
  const setDest = useMutation({
    mutationFn: () => setDestFn({
      data: {
        token, job_id: jobId,
        to_location: destAddr.trim(),
        dropoff_place_id: destPlaceId,
        dropoff_lat: destLat, dropoff_lng: destLng,
      },
    }),
    onSuccess: () => {
      toast.success("Destination set");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not set destination"),
  });

  const delFn = useServerFn(otgDeleteJob);
  const del = useMutation({
    mutationFn: () => delFn({ data: { token, job_id: jobId } }),
    onSuccess: () => {
      toast.success("Trip deleted");
      onOpenChange(false);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not delete trip"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage on-the-go trip</DialogTitle>
          <DialogDescription>
            Add passengers or extra pickup stops as you go. Set the
            destination anytime before you complete the trip.
          </DialogDescription>
        </DialogHeader>

        {/* Add passenger */}
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add passenger
          </div>
          <div>
            <Label htmlFor="otg-mp-name">Name *</Label>
            <Input id="otg-mp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <Label htmlFor="otg-mp-phone">Phone (optional)</Label>
            <Input id="otg-mp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+356…" />
          </div>
          <div>
            <Label htmlFor="otg-mp-note">Note (optional)</Label>
            <Textarea id="otg-mp-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bag colour" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={markOnboard} onChange={(e) => setMarkOnboard(e.target.checked)} />
            Mark as boarded now
          </label>
          <Button
            className="w-full"
            disabled={!name.trim() || addPax.isPending}
            onClick={() => addPax.mutate()}
          >
            {addPax.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><UserPlus className="h-4 w-4 mr-1.5" /> Add passenger</>)}
          </Button>
        </div>

        {/* Add stop */}
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add another pickup stop
          </div>
          <AddressAutocomplete
            value={stopAddr}
            onChange={(pick) => {
              setStopAddr(pick.address);
              setStopPlaceId(pick.place_id ?? undefined);
            }}
            placeholder="Address (leave blank to use current GPS)"
          />
          <Button
            variant="outline"
            className="w-full"
            disabled={addStop.isPending}
            onClick={() => addStop.mutate()}
          >
            {addStop.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Plus className="h-4 w-4 mr-1.5" /> Add stop</>)}
          </Button>
        </div>

        {/* Set / update destination */}
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Set or update destination
          </div>
          <AddressAutocomplete
            value={destAddr}
            onChange={(pick) => {
              setDestAddr(pick.address);
              setDestPlaceId(pick.place_id ?? undefined);
              setDestLat(pick.lat ?? undefined);
              setDestLng(pick.lng ?? undefined);
            }}
            placeholder="Final drop-off address"
          />
          <Button
            className="w-full"
            disabled={!destAddr.trim() || setDest.isPending}
            onClick={() => setDest.mutate()}
          >
            {setDest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Flag className="h-4 w-4 mr-1.5" /> Save destination</>)}
          </Button>
        </div>

        {/* Delete */}
        {canDelete && (
          <div className="rounded-md border border-destructive/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-destructive mb-2">
              Danger zone
            </div>
            <Button
              variant="destructive"
              className="w-full"
              disabled={del.isPending}
              onClick={() => {
                if (confirm("Delete this trip? This cannot be undone.")) del.mutate();
              }}
            >
              {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Trash2 className="h-4 w-4 mr-1.5" /> Delete trip</>)}
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1">
              Only available while the coordinator hasn't reviewed it yet.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
