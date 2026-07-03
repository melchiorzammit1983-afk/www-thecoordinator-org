## Change

Suppress the "Driver status updated" signal (left stripe + dot next to the time) on trip cards that have no driver assigned yet.

## Where

`src/routes/_authenticated/coordinator.calendar.tsx`, in `TripCard`:

- Line 1221: `const driverStatusNew = !!sig?.driver_status_new;`
- Line 1306: `{driverStatusNew && <span className="signal-stripe-driver" ... />}`
- Line 1349: `{driverStatusNew && <span className="signal-dot-driver" ... />}`

## How

Gate the flag on the trip actually having a driver:

```tsx
const driverStatusNew = !!sig?.driver_status_new && !!job.driver_id;
```

That single change removes both the stripe and the dot from unassigned cards without touching any other visual, and the signal reappears the moment a driver is assigned.

No server/data changes.
