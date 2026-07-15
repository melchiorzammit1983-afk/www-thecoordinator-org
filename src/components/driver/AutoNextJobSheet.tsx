import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Navigation, MapPin, Clock } from "lucide-react";
import { formatMaltaTime } from "@/lib/time";
import { displayLocation } from "@/lib/trip-display";

export function AutoNextJobSheet({
  job,
  onDismiss,
  onOpenTrip,
}: {
  job:
    | {
        id: string;
        pickup_at?: string | null;
        from_location?: string | null;
        to_location?: string | null;
        from_display_name?: string | null;
        to_display_name?: string | null;
        name?: string | null;
        surname?: string | null;
      }
    | null;
  onDismiss: () => void;
  onOpenTrip: () => void;
}) {
  const open = !!job;
  if (!job) return null;

  const from = displayLocation(job.from_location, job.from_display_name);
  const to = displayLocation(job.to_location, job.to_display_name);
  const navHref = from
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(from)}&travelmode=driving`
    : null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onDismiss()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="text-base">✅ Trip completed · Next up</SheetTitle>
          <SheetDescription className="text-xs">
            Your next assigned trip is ready.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-2 text-sm">
          {(job.name || job.surname) && (
            <div className="font-medium">
              {job.name} {job.surname}
            </div>
          )}
          {job.pickup_at && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Pickup at {formatMaltaTime(job.pickup_at)}
            </div>
          )}
          {from && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-primary" />
              <div className="text-xs">
                <div className="text-muted-foreground">From</div>
                <div className="font-medium">{from}</div>
              </div>
            </div>
          )}
          {to && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-emerald-600" />
              <div className="text-xs">
                <div className="text-muted-foreground">To</div>
                <div className="font-medium">{to}</div>
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          {navHref && (
            <Button asChild className="flex-1">
              <a href={navHref} target="_blank" rel="noopener noreferrer">
                <Navigation className="h-4 w-4 mr-1.5" /> Start navigation
              </a>
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={onOpenTrip}>
            Open trip
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-xs text-muted-foreground"
          onClick={onDismiss}
        >
          Dismiss (snooze 15 min)
        </Button>
      </SheetContent>
    </Sheet>
  );
}
