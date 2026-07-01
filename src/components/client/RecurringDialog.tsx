import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createRecurringBookings } from "@/lib/coordinator-public.functions";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RecurringDialog({ token, defaultName }: { token: string; defaultName?: string }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<Set<number>>(new Set());
  const [time, setTime] = useState("08:00");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [name, setName] = useState(defaultName?.split(" ")[0] ?? "");
  const [surname, setSurname] = useState(defaultName?.split(" ").slice(1).join(" ") ?? "");
  const [room, setRoom] = useState("");

  const qc = useQueryClient();
  const fn = useServerFn(createRecurringBookings);
  const mut = useMutation({
    mutationFn: () => fn({ data: {
      token, weekdays: Array.from(days), time,
      from_location: from, to_location: to,
      name, surname, room_number: room || undefined,
    } }),
    onSuccess: (r: { created: number }) => {
      toast.success(`Created ${r.created} recurring booking${r.created === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["client-portal", token] });
      setOpen(false);
      setDays(new Set());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (d: number) => {
    const next = new Set(days);
    next.has(d) ? next.delete(d) : next.add(d);
    setDays(next);
  };
  const canSubmit = days.size > 0 && from && to && name && surname && time;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="w-full">Setup recurring trip</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recurring trip</DialogTitle>
          <DialogDescription>Generates bookings for selected weekdays over the next 7 days.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Days</Label>
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {DAYS.map((d, i) => (
                <label key={d} className={`px-2.5 py-1.5 rounded border text-xs flex items-center gap-1.5 cursor-pointer ${days.has(i) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                  <Checkbox className="hidden" checked={days.has(i)} onCheckedChange={() => toggle(i)} />
                  <span onClick={() => toggle(i)}>{d}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label>Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Room</Label><Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Optional" /></div>
          </div>
          <div className="grid gap-1.5"><Label>From</Label><Input value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>To</Label><Input value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Surname</Label><Input value={surname} onChange={(e) => setSurname(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!canSubmit || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Creating…" : "Create bookings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
