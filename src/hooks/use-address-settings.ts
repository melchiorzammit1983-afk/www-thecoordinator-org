// User preferences for the Google Places autocomplete used across every
// address input. Persisted per-browser in localStorage — no server round
// trip on read, so components stay snappy.

import { useCallback, useEffect, useState } from "react";

export type AddressSettings = {
  region: string;         // ISO 3166-1 alpha-2 (e.g. "MT")
  language: string;       // BCP-47 (e.g. "en")
  bias_lat: number;
  bias_lng: number;
  bias_radius_km: number; // 5–200
  auto_fix_bulk: boolean; // auto-accept top match on bulk paste
  show_map_preview: boolean;
};

export const DEFAULT_ADDRESS_SETTINGS: AddressSettings = {
  region: "MT",
  language: "en",
  bias_lat: 35.9375,
  bias_lng: 14.3754,
  bias_radius_km: 60,
  auto_fix_bulk: true,
  show_map_preview: false,
};

const STORAGE_KEY = "address_settings.v1";

function read(): AddressSettings {
  if (typeof window === "undefined") return DEFAULT_ADDRESS_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ADDRESS_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ADDRESS_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_ADDRESS_SETTINGS;
  }
}

export function useAddressSettings() {
  const [settings, setSettings] = useState<AddressSettings>(DEFAULT_ADDRESS_SETTINGS);
  // Populate after mount to avoid SSR hydration mismatch.
  useEffect(() => { setSettings(read()); }, []);

  const save = useCallback((next: Partial<AddressSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch { /* quota */ }
      return merged;
    });
  }, []);

  const reset = useCallback(() => {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* quota */ }
    setSettings(DEFAULT_ADDRESS_SETTINGS);
  }, []);

  return { settings, save, reset };
}

export function toBias(settings: AddressSettings) {
  return {
    lat: settings.bias_lat,
    lng: settings.bias_lng,
    radius_m: Math.round(settings.bias_radius_km * 1000),
    region: settings.region,
    language: settings.language,
  };
}
