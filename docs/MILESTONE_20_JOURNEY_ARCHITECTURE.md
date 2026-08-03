# Milestone 20 — Booking Journey Architecture

## Endpoint classification

Every new booking endpoint has two separate values:

- `from_location` / `to_location`: the physical place.
- `from_location_type` / `to_location_type`: the validated operational role.

Endpoint roles are currently `airport`, `port`, and `local`. Place-provider metadata is used when available; manually entered or unclassified places default to `local`. A coordinator may override the endpoint role without changing the selected place. The server validates the pair before resolving a journey, and free-text matching is never used for classification.

## Shared Booking Journey Resolver

`src/lib/journey-resolver.ts` contains the pure Booking Journey Engine. It accepts only the validated endpoint-type pair and returns:

- Journey Type
- Primary transport
- Optional connection type
- Tracking kind (`flight`, `vessel`, or none)

The resolver does not query schedules or Ships, calculate pickup times, create links, write Jobs/Trips, mirror records, or perform tracking. Shared server booking handlers call it so Coordinator, HR, Client, Bulk, Portal, Guest, API, and import paths use the same deterministic decision.

## Route-driven Journey Type

The current route rules are:

| From → To | Journey Type | Primary | Optional connection |
| --- | --- | --- | --- |
| Airport → Local | Arrival Flight | Flight | — |
| Local → Airport | Departure Flight | Flight | — |
| Port → Local | Ship Arrival | Ship | — |
| Local → Port | Ship Departure | Ship | — |
| Port → Airport | Ship + Connecting Flight | Ship | Flight |
| Airport → Port | Arrival Flight + Connecting Ship | Flight | Ship |
| Everything else | Road Transfer | None | — |

The Coordinator form presents the automatic suggestion and permits an explicit operational override. Transport selectors are displayed only when allowed by the selected Journey Type.

## Flight, Ship, and Road isolation

- Flight journeys select an active Flight Schedule record and use Flight tracking and Flight pickup calculations.
- Ship journeys select a company-owned Ship Event and use Ship ETA and Ship Operations; they never enter the Flight tracker.
- Road Transfer has no Flight or Ship selector, no transport relationship, and no transport tracking.

Primary Flight and Ship relationships are mutually exclusive. Connecting Flight is available only for Port → Airport. Connecting Ship is available only for Airport → Port. Transport data is never inferred from passenger, client, route text, identifiers, or previous trips.

## Connecting Flight and Connecting Ship

Connections are nullable references to existing records:

- `onward_flight_schedule_record_id` references an active departure Flight Schedule record.
- `onward_ship_event_id` references a company-owned Ship Event.

The selected records are stored by reference; their descriptive data is not copied into Jobs or Trips. Historical relationships remain stable when a newer schedule becomes active or a Ship ETA changes.

## Jobs → Trips mirroring

Jobs are authoritative. The existing Transport Core trigger mirrors primary and onward Flight/Ship relationship IDs and the stored pickup offset into the corresponding Trip identified by `legacy_job_id`. Trips are read models for these links; booking code does not maintain an independent Trip relationship.

The onward Ship migration uses a nullable foreign key with `ON DELETE RESTRICT`, matching the established onward Flight pattern. Existing records remain unchanged.

## Shared booking paths

All authoritative booking paths pass endpoint types through the shared server booking handlers and therefore use the same Journey Resolver:

- Coordinator booking
- HR booking
- Client booking
- Bulk booking
- Public Portal booking
- Guest booking links
- API and import handlers that create or update Jobs

UI forms may display the suggestion, but the server validates endpoint types and remains the source of truth for the Journey decision.
