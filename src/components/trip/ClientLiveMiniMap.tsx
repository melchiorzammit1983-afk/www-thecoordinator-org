import { MapPin, Navigation } from "lucide-react";

type Props = {
  lat: number;
  lng: number;
  paxName?: string | null;
  capturedAt: string;
  label?: string | null;
};

function ageLabel(ts: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

export function ClientLiveMiniMap({ lat, lng, paxName, capturedAt, label }: Props) {
  const embedSrc = `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  return (
    <div className="mx-4 mb-3 rounded-xl overflow-hidden border-2 border-emerald-500/50 bg-card shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/30">
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-400">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
          </span>
          <MapPin className="h-3.5 w-3.5" />
          Live · {label ?? paxName ?? "Passenger"} · {ageLabel(capturedAt)}
        </div>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1"
        >
          <Navigation className="h-3 w-3" /> Open
        </a>
      </div>
      <iframe
        key={`${lat.toFixed(5)},${lng.toFixed(5)}`}
        title="Client live location"
        src={embedSrc}
        className="w-full h-40 border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
