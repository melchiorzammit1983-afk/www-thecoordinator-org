// Shared address input with Google Places (New) autocomplete.
//
// Every address input across the app must use this component — see
// AGENTS.md. It debounces typing, calls our server function (which proxies
// through the Lovable Google Maps connector gateway), and lets the user pick
// a suggestion or fall back to free text. On selection the parent receives
// the cleaned address plus place_id + lat/lng for future routing use.

import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, Loader2, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { placesAutocomplete, placesDetails, resolveAddresses } from "@/lib/places.functions";
import { useAddressSettings, toBias } from "@/hooks/use-address-settings";

export type AddressPick = {
  address: string;
  place_id: string | null;
  lat: number | null;
  lng: number | null;
  display_name?: string | null;
};

type Suggestion = {
  place_id: string;
  text: string;
  main: string;
  secondary: string;
};

type Props = {
  value: string;
  onChange: (v: AddressPick) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  inputClassName?: string;
  maxLength?: number;
  onBlur?: () => void;
  // When true, don't show the "verified" checkmark badge.
  hideBadge?: boolean;
  // If the parent already has a locked-in place_id (e.g. after selection),
  // we skip the suggestions dropdown until the user edits again.
  placeId?: string | null;
};

function makeSessionToken(): string {
  const s = () => Math.random().toString(36).slice(2, 10);
  return `${s()}-${s()}-${Date.now().toString(36)}`;
}

export function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  disabled,
  required,
  id,
  className,
  inputClassName,
  maxLength = 255,
  onBlur,
  hideBadge,
  placeId,
}: Props) {
  const { settings } = useAddressSettings();
  const bias = React.useMemo(() => toBias(settings), [settings]);

  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Suggestion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);
  const sessionRef = React.useRef<string>(makeSessionToken());
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const autocompleteFn = useServerFn(placesAutocomplete);
  const detailsFn = useServerFn(placesDetails);
  const resolveFn = useServerFn(resolveAddresses);

  // Debounced fetch. Cancel stale responses via a rev counter.
  const revRef = React.useRef(0);
  React.useEffect(() => {
    // If the field currently reflects a picked place, don't re-suggest.
    if (!open) return;
    const q = value.trim();
    if (q.length < 2) { setItems([]); setLoading(false); return; }
    const rev = ++revRef.current;
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await autocompleteFn({
          data: { input: q, session_token: sessionRef.current, bias },
        });
        if (rev !== revRef.current) return;
        setItems(res.items ?? []);
        setActive(0);
      } catch (e: any) {
        if (rev !== revRef.current) return;
        setError(e?.message === "places_unavailable"
          ? "Address lookup offline — you can still type manually."
          : "Address lookup failed — type manually or try again.");
        setItems([]);
      } finally {
        if (rev === revRef.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value, open, bias, autocompleteFn]);

  // Close on outside click.
  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function pick(s: Suggestion) {
    setOpen(false);
    // Optimistically populate with the display text so the input is never blank.
    // s.main is the hotel/POI name when Google returns structured formatting.
    onChange({
      address: s.text,
      place_id: s.place_id,
      lat: null,
      lng: null,
      display_name: s.main || null,
    });
    try {
      const det = await detailsFn({
        data: { place_id: s.place_id, session_token: sessionRef.current },
      });
      onChange({
        address: det.address || s.text,
        place_id: det.place_id,
        lat: det.lat,
        lng: det.lng,
        display_name: det.display_name ?? s.main ?? null,
      });
    } catch {
      /* keep the optimistic pick — coords just aren't stored */
    } finally {
      // Start a new session for the next query.
      sessionRef.current = makeSessionToken();
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault(); pick(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const verified = !!placeId && placeId.length > 4;

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          id={id}
          value={value}
          disabled={disabled}
          required={required}
          maxLength={maxLength}
          placeholder={placeholder ?? "Type a hotel, address, airport…"}
          className={cn("pl-7", verified && !hideBadge && "pr-8", inputClassName)}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            // Any edit clears the picked place_id — parent gets pure text.
            onChange({ address: next, place_id: null, lat: null, lng: null });
            setOpen(true);
          }}
          onKeyDown={onKey}
          onBlur={onBlur}
          autoComplete="off"
        />
        {verified && !hideBadge && (
          <CheckCircle2
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500"
            aria-label="Verified address"
          />
        )}
        {loading && (
          <Loader2 className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && (items.length > 0 || error) && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          {error ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{error}</div>
          ) : (
            <ul className="max-h-64 overflow-auto py-1">
              {items.map((s, i) => (
                <li key={s.place_id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(s)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left text-sm",
                      i === active ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.main || s.text}</div>
                      {s.secondary && (
                        <div className="truncate text-xs text-muted-foreground">{s.secondary}</div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
