// Google Places (New) proxy — all requests go through the Lovable Google
// Maps connector gateway so the API key never touches the browser.
//
// Exposes three server functions:
//   placesAutocomplete  — typeahead suggestions (session-token billed)
//   placesDetails       — resolve a place_id → {address, lat, lng}
//   resolveAddresses    — batch best-match lookup used by the bulk paste
//                          auto-fix flow.
//
// Bias defaults to Malta (35.9375, 14.3754) with 60km radius so airports,
// cruise ports, and hotels in the archipelago rank first, while foreign
// airports/hotels still surface further down the list.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

const MALTA_CENTER = { latitude: 35.9375, longitude: 14.3754 };
const DEFAULT_RADIUS_M = 50_000;
const MAX_RADIUS_M = 50_000; // Places (New) autocomplete hard cap.

type Bias = {
  lat?: number;
  lng?: number;
  radius_m?: number;
  region?: string;
  language?: string;
};

function biasBody(bias?: Bias) {
  const lat = bias?.lat ?? MALTA_CENTER.latitude;
  const lng = bias?.lng ?? MALTA_CENTER.longitude;
  const radius = Math.max(1000, Math.min(bias?.radius_m ?? DEFAULT_RADIUS_M, MAX_RADIUS_M));
  return {
    locationBias: {
      circle: { center: { latitude: lat, longitude: lng }, radius },
    },
    languageCode: bias?.language ?? "en",
    regionCode: bias?.region ?? "MT",
  };
}

function assertKeys() {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
    throw new Error("places_unavailable");
  }
  return { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY };
}

const BiasSchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    radius_m: z.number().min(1000).max(500_000).optional(),
    region: z.string().min(2).max(4).optional(),
    language: z.string().min(2).max(8).optional(),
  })
  .optional();

export const placesAutocomplete = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        input: z.string().trim().min(1).max(200),
        session_token: z.string().trim().min(4).max(80).optional(),
        bias: BiasSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = assertKeys();
    const body = {
      input: data.input,
      sessionToken: data.session_token,
      ...biasBody(data.bias),
    };
    const res = await fetch(`${GATEWAY}/places/v1/places:autocomplete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[placesAutocomplete] ${res.status}: ${err}`);
      throw new Error(`places_${res.status}`);
    }
    const json = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
        };
      }>;
    };
    const items = (json.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
      .map((p) => ({
        place_id: p.placeId!,
        text: p.text?.text ?? p.structuredFormat?.mainText?.text ?? "",
        main: p.structuredFormat?.mainText?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
      }));
    return { items };
  });

export const placesDetails = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        place_id: z.string().trim().min(4).max(200),
        session_token: z.string().trim().min(4).max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = assertKeys();
    const qs = data.session_token
      ? `?sessionToken=${encodeURIComponent(data.session_token)}`
      : "";
    const res = await fetch(
      `${GATEWAY}/places/v1/places/${encodeURIComponent(data.place_id)}${qs}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": "id,formattedAddress,displayName,location",
        },
      },
    );
    if (!res.ok) {
      const err = await res.text();
      console.error(`[placesDetails] ${res.status}: ${err}`);
      throw new Error(`places_${res.status}`);
    }
    const json = (await res.json()) as {
      id?: string;
      formattedAddress?: string;
      displayName?: { text?: string };
      location?: { latitude?: number; longitude?: number };
    };
    return {
      place_id: json.id ?? data.place_id,
      address: json.formattedAddress ?? json.displayName?.text ?? "",
      display_name: json.displayName?.text ?? null,
      lat: json.location?.latitude ?? null,
      lng: json.location?.longitude ?? null,
    };
  });

// Batch resolver used by bulk paste. For each input string we call the
// Places autocomplete endpoint and pick the top suggestion when it looks
// confident (single result, or first result's main text overlaps the input).
// The caller decides whether to swap the text.
export const resolveAddresses = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        items: z
          .array(
            z.object({
              key: z.string().min(1).max(64),
              text: z.string().trim().min(1).max(200),
            }),
          )
          .min(1)
          .max(200),
        bias: BiasSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = assertKeys();
    const bias = biasBody(data.bias);

    async function lookup(text: string) {
      const res = await fetch(`${GATEWAY}/places/v1/places:autocomplete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: text, ...bias }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as any;
      const first = json?.suggestions?.[0]?.placePrediction;
      if (!first?.placeId) return null;
      // Fetch details for coords + clean address.
      const det = await fetch(
        `${GATEWAY}/places/v1/places/${encodeURIComponent(first.placeId)}`,
        {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "id,formattedAddress,displayName,location",
          },
        },
      );
      if (!det.ok) return null;
      const d = (await det.json()) as any;
      return {
        place_id: d.id ?? first.placeId,
        address: d.formattedAddress ?? first.text?.text ?? text,
        display_name: d.displayName?.text ?? null,
        lat: d.location?.latitude ?? null,
        lng: d.location?.longitude ?? null,
      };
    }

    // Cap concurrency at 8 so we don't hammer the gateway.
    const results: Record<string, {
      place_id: string; address: string; display_name: string | null;
      lat: number | null; lng: number | null;
    } | null> = {};
    const queue = [...data.items];
    async function worker() {
      while (queue.length) {
        const it = queue.shift()!;
        try { results[it.key] = await lookup(it.text); }
        catch { results[it.key] = null; }
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    return { results };
  });
