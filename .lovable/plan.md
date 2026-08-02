# Transport Core schema drift — investigation report

Read-only investigation of the connected preview database against four repository migrations. Nothing was applied or changed.

## 1. Core tables and enum types

| Object | Present in preview DB |
|---|---|
| public.operations | No |
| public.trips | No |
| public.passengers | No |
| public.trip_stops | No |
| enum operation_status | No |
| enum trip_status_v2 | No |
| enum passenger_type_v2 | No |
| enum passenger_row_status_v2 | No |
| enum trip_stop_type_v2 | No |

Existing public enums are only the legacy set (job_status, pax_status, group_status, booking_status, driver_status, dispatch_*, etc.). The entire Transport Core layer from `20260724153000_transport_core_rebuild.sql` is absent.

## 2. Link columns

| Column | Present |
|---|---|
| jobs.operation_id | No |
| pax.operation_id | No |
| trips.legacy_job_id | No (table missing) |
| jobs.flight_schedule_record_id | Yes |
| trips.flight_schedule_record_id | No (table missing) |
| jobs.scheduled_transport_pickup_offset_minutes | Yes |
| companies.default_departure/arrival_pickup_offset_minutes | Yes |

So `20260801160000` and `20260802061035` were applied only in their `jobs`/`companies` halves; their `trips` halves never ran.

## 3. Triggers and functions matching transport_core / flight_schedule

Functions present: `create_flight_schedule_draft`, `activate_flight_schedule_draft`, `prevent_flight_schedule_import_mutation`.
Triggers present: `flight_schedule_imports_immutable`, `flight_schedule_records_immutable`.

Absent: `touch_transport_updated_at`, `derive_operation_name`, `ensure_job_operation_id`, `refresh_trip_stops_for_job`, `mirror_job_to_transport_core`, `mirror_pax_to_transport_core`, `mirror_job_flight_schedule_link`, and every `trg_jobs_transport_core_*` / `trg_pax_transport_core_mirror` trigger.

Flight schedule tables (`flight_schedule_versions`, `flight_schedule_imports`, `flight_schedule_records`) all exist, so `20260801202443` is fully applied.

## 4. Can the Transport Core migration apply safely?

Yes — all prerequisites it depends on exist, and no conflicts were found:

- Referenced base tables exist: `companies`, `jobs`, `pax`, `drivers`, `groups`, `group_stops`.
- Every `jobs` column read by the mirror functions and backfill exists; the only missing names are `operation_id` (created by the migration itself) and `pax` columns (`job_id`, `name`, `phone`, `note`) which all exist on `pax`.
- `group_stops` has the `stop_index`, `display_name`, `address`, `group_id` columns the stop backfill reads.
- No name collisions: none of the tables, enums, functions, triggers, indexes or constraints it creates already exist.
- Data will satisfy the final `SET NOT NULL` steps: 71 jobs (0 with null company_id/from/to/date/time), 143 pax (0 with null job_id), 21 group_stops. The backfill covers all of them.

Two caveats, not blockers:

1. The migration enables RLS on the four new tables and adds no policies and no `GRANT`s. That is intentional in the repo (server-function-only access), but any browser query against `operations`/`trips`/`passengers`/`trip_stops` will fail with a permission error until grants/policies are added.
2. It installs `AFTER INSERT/UPDATE/DELETE` mirror triggers on `jobs` and `pax`, so every write to those tables afterwards also writes Transport Core rows. Behaviour change, expected by design.

## Smallest safe sequence (not applied)

1. `20260724153000_transport_core_rebuild.sql` — creates enums, four tables, link columns, FKs, mirror functions/triggers, backfills, then sets `operation_id` NOT NULL.
2. `20260725160000_fix_pax_operation_link.sql` — replaces `mirror_pax_to_transport_core` with the self-healing version (must follow step 1; it depends on `derive_operation_name` and `operations`).
3. Re-run the `trips`-only halves of `20260801160000_trip_flight_schedule_link.sql` and `20260802061035_operational_pickup_offsets.sql` — both are `ADD COLUMN IF NOT EXISTS` / `CREATE OR REPLACE`, so re-running them whole is idempotent and ends with the correct combined `mirror_job_flight_schedule_link` trigger (run `20260802061035` last so the offset-aware version wins).

No other migration needs to be replayed. Steps 1–2 must run in one transaction-safe order before step 3, because step 3 references `trips.legacy_job_id`.

Nothing has been applied. Say the word if you want this sequence executed.
