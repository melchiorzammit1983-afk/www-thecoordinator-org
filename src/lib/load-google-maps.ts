// Shared browser-side Google Maps JS API loader for the passenger tracker
// and HR portal's single-trip map views. Mirrors the loader pattern already
// used by the coordinator's DriverLiveMap, kept as its own small module so
// this doesn't have to import from a coordinator-only component.
const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;

type GMaps = any;
let mapsLoader: Promise<GMaps> | null = null;

export function loadGoogleMaps(): Promise<GMaps> {
  if (typeof window === "undefined") return Promise.reject(new Error("no_window"));
  if ((window as any).google?.maps) return Promise.resolve((window as any).google.maps);
  if (mapsLoader) return mapsLoader;
  if (!BROWSER_KEY) return Promise.reject(new Error("missing_browser_key"));

  mapsLoader = new Promise<GMaps>((resolve, reject) => {
    const cbName = `__lovable_gmaps_cb_${Math.random().toString(36).slice(2)}`;
    (window as any)[cbName] = () => {
      try { resolve((window as any).google.maps); }
      finally { delete (window as any)[cbName]; }
    };
    const s = document.createElement("script");
    const params = new URLSearchParams({ key: BROWSER_KEY, loading: "async", callback: cbName });
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => { mapsLoader = null; reject(new Error("gmaps_load_failed")); };
    document.head.appendChild(s);
  });
  return mapsLoader;
}
