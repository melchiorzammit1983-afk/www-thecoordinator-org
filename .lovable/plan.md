## Goal
In the Edit trip dialog, replace the **Vehicle** field with a **Phone number** field, and let the coordinator view / add / remove passenger names while editing. The trip card refreshes to reflect changes.

## Database
- Add nullable `contact_phone text` column to `public.jobs` (migration). Existing `vehicle` column stays untouched (still used elsewhere / on drivers).
- Include `contact_phone` in the jobs SELECT projection used by `listJobs`.

## Backend (`src/lib/coordinator.functions.ts`)
- Extend `jobInput` schema: add `contact_phone: z.string().trim().max(40).optional()`.
- `createJob` + `updateJob`: persist `contact_phone`.
- New server fns (auth + owner-company scoped via existing `resolveCompany` pattern):
  - `listJobPax({ job_id })` → returns `[{ id, name, status, boarded_at }]`.
  - `addJobPax({ job_id, name })` → inserts row into `pax`.
  - `removeJobPax({ pax_id })` → deletes row (verifies pax belongs to a job in caller's company).

## Frontend (`src/components/coordinator/JobFormDialog.tsx`)
- Replace Vehicle input with **Phone number** input (`tel` type). Bind to `contact_phone` on create + edit.
- In edit mode, render a **Passengers** section:
  - Fetches pax via `useQuery(['job-pax', job.id])` using `listJobPax`.
  - List each name with a remove (trash) button → `removeJobPax` mutation.
  - Inline "Add passenger" input + button → `addJobPax` mutation.
  - Each mutation invalidates `['job-pax', job.id]` and `['jobs']` so the calendar card updates automatically.
- Keep the existing bulk-paste textarea path only for create mode (unchanged).

## Job type / props
- Add `contact_phone: string | null` to the local `Job` type in `JobFormDialog` and to the shared job type consumed by the calendar card.

## Out of scope
- Editing pax names (only add/remove).
- Vehicle field removal from other screens (drivers table, statements, etc.).
