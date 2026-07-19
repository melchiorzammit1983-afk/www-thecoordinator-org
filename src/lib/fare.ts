/**
 * Pure fare breakdown calculator. No I/O — takes rates + trip inputs and
 * returns line items suitable for a UI breakdown component.
 *
 * A service-area card, when provided, overrides the company base rates on a
 * per-field basis. Any override that changes the resulting cost is surfaced
 * as an "adjustment" line so the UI can show WHY the number differs from
 * the base quote.
 */

export type FareSettings = {
  currency?: string | null;
  price_per_km?: number | null;
  price_per_hour?: number | null;
  minimum_fare?: number | null;
  free_wait_minutes?: number | null;
  waiting_rate_per_minute?: number | null;
};

export type FareArea = {
  id?: string;
  name?: string | null;
  currency?: string | null;
  base_price?: number | null;
  price_per_km?: number | null;
  price_per_hour?: number | null;
  minimum_fare?: number | null;
  free_wait_minutes?: number | null;
  waiting_rate_per_minute?: number | null;
} | null | undefined;

export type FareInput = {
  km?: number;
  mins?: number;
  waitMins?: number;
  pax?: number;
  paxIncluded?: number;
  extraPerPax?: number;
  settings: FareSettings;
  area?: FareArea;
};

export type FareLine = {
  key: string;
  label: string;
  amount: number;
  /** Purely informational — e.g. inside the free wait window */
  muted?: boolean;
  /** Adjustment from an area/zone override vs base rates */
  adjustment?: boolean;
};

export type FareBreakdown = {
  currency: string;
  areaName: string | null;
  lines: FareLine[];
  fare: number;             // trip fare after minimum applied, before waiting
  waitCharge: number;
  total: number;
  minimumApplied: boolean;
  freeWaitMinutes: number;
  chargeableWaitMinutes: number;
};

const n = (v: unknown, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

export function computeFareBreakdown(input: FareInput): FareBreakdown {
  const {
    km = 0, mins = 0, waitMins = 0,
    pax = 1, paxIncluded = 1, extraPerPax = 0,
    settings, area,
  } = input;

  const currency = area?.currency ?? settings.currency ?? "EUR";
  const areaName = area?.name ?? null;

  // Base (company) rates
  const baseKm = n(settings.price_per_km);
  const baseHr = n(settings.price_per_hour);
  const baseMin = n(settings.minimum_fare);
  const baseFreeWait = n(settings.free_wait_minutes);
  const baseWaitRate = n(settings.waiting_rate_per_minute);

  // Effective (post-area) rates
  const basePrice = n(area?.base_price);
  const perKm = area?.price_per_km != null ? n(area.price_per_km) : baseKm;
  const perHr = area?.price_per_hour != null ? n(area.price_per_hour) : baseHr;
  const minFare = area?.minimum_fare != null ? n(area.minimum_fare) : baseMin;
  const freeWait = area?.free_wait_minutes != null ? n(area.free_wait_minutes) : baseFreeWait;
  const waitRate = area?.waiting_rate_per_minute != null ? n(area.waiting_rate_per_minute) : baseWaitRate;

  const distanceCost = km * perKm;
  const timeCost = (mins / 60) * perHr;
  const paxSurcharge = Math.max(0, pax - paxIncluded) * extraPerPax;

  const preMin = basePrice + distanceCost + timeCost + paxSurcharge;
  const fare = Math.max(preMin, minFare);
  const minimumApplied = fare > preMin && minFare > 0;

  const chargeableWait = Math.max(0, waitMins - freeWait);
  const waitCharge = chargeableWait * waitRate;

  const lines: FareLine[] = [];

  if (basePrice > 0) {
    lines.push({ key: "base", label: "Base fare", amount: basePrice });
  }

  lines.push({
    key: "km",
    label: `Distance · ${km.toFixed(1)} km × ${currency} ${perKm.toFixed(2)}`,
    amount: distanceCost,
    muted: distanceCost === 0,
  });

  lines.push({
    key: "hr",
    label: `Time · ${mins} min × ${currency} ${perHr.toFixed(2)}/hr`,
    amount: timeCost,
    muted: timeCost === 0,
  });

  if (paxSurcharge > 0) {
    lines.push({
      key: "pax",
      label: `Extra passengers · ${pax - paxIncluded} × ${currency} ${extraPerPax.toFixed(2)}`,
      amount: paxSurcharge,
    });
  }

  // Adjustment lines — informational only. The delta is already reflected in
  // the Distance / Time lines above (which use the effective post-area rate),
  // so these carry amount 0 to keep the visible line items summing to `fare`.
  if (area) {
    if (area.price_per_km != null && perKm !== baseKm && km > 0) {
      const delta = km * (perKm - baseKm);
      lines.push({
        key: "adj-km",
        label: `Zone adjustment · km rate (${area.name}) · ${delta >= 0 ? "+" : ""}${currency} ${delta.toFixed(2)} vs base`,
        amount: 0,
        adjustment: true,
        muted: true,
      });
    }
    if (area.price_per_hour != null && perHr !== baseHr && mins > 0) {
      const delta = (mins / 60) * (perHr - baseHr);
      lines.push({
        key: "adj-hr",
        label: `Zone adjustment · hourly rate (${area.name}) · ${delta >= 0 ? "+" : ""}${currency} ${delta.toFixed(2)} vs base`,
        amount: 0,
        adjustment: true,
        muted: true,
      });
    }
    if (basePrice > 0) {
      lines.push({
        key: "adj-base",
        label: `Zone flat base (${area.name})`,
        amount: 0,
        adjustment: true,
        muted: true,
      });
    }
  }


  if (minimumApplied) {
    lines.push({
      key: "min",
      label: `Minimum fare uplift (${currency} ${minFare.toFixed(2)})`,
      amount: fare - preMin,
      adjustment: true,
    });
  }

  lines.push({
    key: "wait",
    label:
      waitMins === 0
        ? "Waiting"
        : chargeableWait === 0
          ? `Waiting · ${waitMins} min (inside ${freeWait} min free window)`
          : `Waiting · ${chargeableWait} chargeable min × ${currency} ${waitRate.toFixed(2)}`,
    amount: waitCharge,
    muted: waitCharge === 0,
  });

  return {
    currency,
    areaName,
    lines,
    fare,
    waitCharge,
    total: fare + waitCharge,
    minimumApplied,
    freeWaitMinutes: freeWait,
    chargeableWaitMinutes: chargeableWait,
  };
}
