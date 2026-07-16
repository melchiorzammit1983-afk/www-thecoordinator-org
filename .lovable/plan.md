# Fix "Refresh ETA — Traffic: request_denied"

## Root cause
`_computeTripLiveStatus` in `src/lib/coordinator.functions.ts` (lines ~2170-2228) still calls the **legacy Distance Matrix API** through the connector gateway:

```
GET /google_maps/maps/api/distancematrix/json
```

Per the Google Maps connector rules, this legacy endpoint is deprecated and removed from the connector — requests now come back with `REQUEST_DENIED`, which surfaces in the UI as **"Traffic: request_denied"**. The replacement is Routes API v2 (`routes/distanceMatrix/v2:computeRouteMatrix`), same one already used successfully in `src/lib/trip-map.functions.ts` for live ETA.

## Change
Rewrite only the TRAFFIC block inside `_computeTripLiveStatus` to call:

```
POST https://connector-gateway.lovable.dev/google_maps/routes/distanceMatrix/v2:computeRouteMatrix
Headers: Authorization: Bearer LOVABLE_API_KEY
         X-Connection-Api-Key: GOOGLE_MAPS_API_KEY
         Content-Type: application/json
         X-Goog-FieldMask: originIndex,destinationIndex,duration,staticDuration,distanceMeters,condition
Body: {
  origins: [{ waypoint: { address: from_location } }],
  destinations: [{ waypoint: { address: to_location } }],
  travelMode: "DRIVE",
  routingPreference: "TRAFFIC_AWARE",
  departureTime: <ISO string if pickup in the future, else omit>
}
```

Response is a stream of JSON objects (one per origin×destination). Parse the first element and map:
- `duration` (seconds string like `"1234s"`) → `duration_seconds` (traffic-aware)
- `staticDuration` → `free_seconds`
- `distanceMeters` → format `distance_text` ("12.3 km" / "789 m")
- Derive `duration_text` from `duration_seconds` ("23 min", "1 h 5 min")
- Keep existing `delay_minutes`, `severity`, `leave_by_at` derivation unchanged.
- On non-OK HTTP status, surface `reason: routes_${status}` and log the body (same pattern as `refreshLiveEta`).

## Out of scope
No UI changes, no schema changes, no changes to flight lookup, no changes to metering, no changes to `refreshLiveEta` (already correct). Only the traffic block in `_computeTripLiveStatus` is touched.

## Verify
After the edit, click **Refresh ETA** on a trip row; expect a green toast with duration/distance instead of the red "Traffic: request_denied".
