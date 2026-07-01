import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { updateClientBooking } from "@/lib/coordinator-public.functions";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EditBookingDialog({
  open, onOpenChange, token, booking,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  token: string;
  booking: { id: string; from_location: string; to_location: string; date: string | null; time: string | null; pickup_at: string | null } | null;
}) {
  const [from, setFrom] = useState(booking?.from_location ?? "");
  const [to, setTo] = useState(booking?.to_location ?? "");
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit booking</DialogTitle>
          <DialogDescription>Changes made within 2 hours of pickup need coordinator approval.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>From</Label><Input value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>To</Label><Input value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
