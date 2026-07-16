/**
 * Utilities for working with Google encoded polylines.
 *
 * Decodes the Routes API `encodedPolyline` string into lat/lng pairs and
 * measures how far a point is from the nearest segment of that path.
 * Used by the driver's live navigation to detect when the driver has
 * deviated from the planned route and needs an automatic recalculation.
 *
 * Encoding algorithm reference:
 *   https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

export type LatLng = { lat: number; lng: number };

/** Decodes a Google encoded polyline into an array of {lat, lng}. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Haversine distance in meters between two lat/lng points. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Perpendicular distance (meters) from `p` to the polyline `path`. Uses a
 * local equirectangular projection anchored at `p` — accurate to within a
 * few percent at typical driving speeds and paths, and cheap enough to run
 * on every GPS ping.
 */
export function distanceToPathMeters(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineMeters(p, path[0]);

  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(p.lat));
  const project = (q: LatLng): [number, number] => [
    toRad(q.lng - p.lng) * R * cosLat,
    toRad(q.lat - p.lat) * R,
  ];

  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = project(path[i]);
    const [bx, by] = project(path[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.sqrt(cx * cx + cy * cy);
    if (d < best) best = d;
  }
  return best;
}
