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
  enabled = true,
  unlockedUntilMs = 0,
}: {
  speedMps: number | null | undefined;
  thresholdKmh?: number;
  /** Company-level Safety Mode master switch. */
  enabled?: boolean;
  /** Epoch ms until which the driver has temporarily unlocked the UI. */
  unlockedUntilMs?: number;
}): SafetyModeResult {
  return useMemo(() => {
    const normalizedSpeedMps = normalizeSpeedMps(speedMps);
    const speedKmh = normalizedSpeedMps == null
      ? null
      : Math.round(normalizedSpeedMps * 3.6);
    const thresholdMps = thresholdKmh / 3.6;
    const nowMs = Date.now();
    const unlocked = unlockedUntilMs > nowMs;
    const shouldEngage = enabled
      && !unlocked
      && normalizedSpeedMps != null
      && normalizedSpeedMps >= thresholdMps;

    return {
      isSafetyMode: shouldEngage,
      speedKmh,
      speedMps: normalizedSpeedMps,
    };
  }, [speedMps, thresholdKmh, enabled, unlockedUntilMs]);
}
