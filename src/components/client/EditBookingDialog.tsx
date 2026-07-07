import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { updateClientBooking } from "@/lib/coordinator-public.functions";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription,
  ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/mobile/ResponsiveDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "@/components/address/AddressAutocomplete";

export function EditBookingDialog({
  open, onOpenChange, token, booking,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  token: string;
  booking: { id: string; from_location: string; to_location: string; date: string | null; time: string | null; pickup_at: string | null } | null;
}) {
  const [from, setFrom] = useState(booking?.from_location ?? "");
  const [fromPlaceId, setFromPlaceId] = useState<string | null>(null);
  const [to, setTo] = useState(booking?.to_location ?? "");
  const [toPlaceId, setToPlaceId] = useState<string | null>(null);
  const [date, setDate] = useState(booking?.date ?? "");
  const [time, setTime] = useState((booking?.time ?? "").slice(0, 5));

  const qc = useQueryClient();
  const fn = useServerFn(updateClientBooking);
  const mut = useMutation({
    mutationFn: async () => {
      if (!booking) throw new Error("no booking");
      const changes: Record<string, string> = {};
      if (from !== booking.from_location) changes.from_location = from;
      if (to !== booking.to_location) changes.to_location = to;
      if (date && date !== booking.date) changes.date = date;
      if (time && time !== (booking.time ?? "").slice(0, 5)) changes.time = time;
      if (date && time) {
        const [hh, mm] = time.split(":").map(Number);
        const [y, m, d] = date.split("-").map(Number);
        changes.pickup_at = new Date(y, m - 1, d, hh, mm).toISOString();
      }
      if (Object.keys(changes).length === 0) throw new Error("No changes");
      return fn({ data: { token, booking_id: booking.id, changes } });
    },
    onSuccess: (r) => {
      toast.success(r.mode === "pending"
        ? "Changes requested within 2 hours require coordinator approval."
        : "Booking updated.");
      qc.invalidateQueries({ queryKey: ["client-portal", token] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit booking</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Changes made within 2 hours of pickup need coordinator approval.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>From</Label>
            <AddressAutocomplete
              value={from}
              placeId={fromPlaceId}
              onChange={(v) => { setFrom(v.address); setFromPlaceId(v.place_id); }}
              placeholder="Pickup location"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>To</Label>
            <AddressAutocomplete
              value={to}
              placeId={toPlaceId}
              onChange={(v) => { setTo(v.address); setToPlaceId(v.place_id); }}
              placeholder="Drop-off location"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Saving…" : "Save changes"}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
