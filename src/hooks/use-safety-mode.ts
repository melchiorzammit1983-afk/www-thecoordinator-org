import { useMemo } from "react";

export type SafetyModeResult = {
  isSafetyMode: boolean;
  speedKmh: number | null;
  speedMps: number | null;
};

function normalizeSpeedMps(speedMps: number | null | undefined): number | null {
  // Treat zero and negative values as "not moving / no usable speed data" so
  // Safety Mode fails open when the vehicle is stopped or iOS reports `-1`.
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps <= 0) return null;
  return speedMps;
}

export function useSafetyMode({
  speedMps,
  thresholdKmh = 10,
}: {
  speedMps: number | null | undefined;
  thresholdKmh?: number;
}): SafetyModeResult {
  return useMemo(() => {
    const normalizedSpeedMps = normalizeSpeedMps(speedMps);
    const speedKmh = normalizedSpeedMps == null
      ? null
      : Math.round(normalizedSpeedMps * 3.6);
    const thresholdMps = thresholdKmh / 3.6;

    return {
      isSafetyMode: normalizedSpeedMps != null && normalizedSpeedMps >= thresholdMps,
      speedKmh,
      speedMps: normalizedSpeedMps,
    };
  }, [speedMps, thresholdKmh]);
}
