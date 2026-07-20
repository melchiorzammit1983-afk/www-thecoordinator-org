/**
 * EUR-equivalent formatting for point costs.
 *
 * `refPack` is the point pack currently flagged `is_reference_rate = true`
 * (there is at most one, enforced by a unique index). If none exists we
 * gracefully fall back to points-only display — never guess a rate.
 */

export type ReferencePack = { points: number; price: number | string } | null;

export function eurPerPoint(pack: ReferencePack): number | null {
  if (!pack || !pack.points || Number(pack.points) <= 0) return null;
  const p = Number(pack.price);
  const n = Number(pack.points);
  if (!Number.isFinite(p) || !Number.isFinite(n) || n <= 0) return null;
  return p / n;
}

export function formatEur(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  if (amount < 0.01) return "≈ €" + amount.toFixed(3);
  return "≈ €" + amount.toFixed(2);
}

/** Format a point cost, optionally appending "≈ €0.15" from a reference pack. */
export function formatPoints(points: number, pack: ReferencePack): string {
  const pts = `${Number(points).toFixed(Number.isInteger(points) ? 0 : 2)} pt${Math.abs(points) === 1 ? "" : "s"}`;
  const rate = eurPerPoint(pack);
  if (rate == null) return pts;
  return `${pts} (${formatEur(points * rate)})`;
}
