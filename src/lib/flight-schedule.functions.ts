import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin.functions";
import {
  compareFlightScheduleRecords,
  type ComparableFlightScheduleRecord,
  type FlightScheduleComparison,
} from "@/lib/flight-schedule-comparison";

const draftRecordSchema = z.object({
  rowNumber: z.number().int().positive(),
  flightNumber: z.string().trim().min(1).max(20),
  date: z.string().trim().min(1).max(20),
  direction: z.enum(["Arrival", "Departure"]),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  airline: z.string().trim().min(1).max(200),
  origin: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
  destination: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
  aircraftType: z.string().trim().max(50).optional(),
});

export type FlightScheduleVersion = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  effective_from: string | null;
  coverage_start: string | null;
  coverage_end: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  activated_by: string | null;
  activated_at: string | null;
  flightCount: number;
};

export type FlightScheduleImportSession = {
  id: string;
  schedule_version_id: string;
  source_filename: string | null;
  source_type: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  validation_status: string;
  created_by: string | null;
  created_at: string;
};

export type FlightScheduleComparisonResult = {
  left: FlightScheduleVersion;
  right: FlightScheduleVersion;
  leftImport: FlightScheduleImportSession | null;
  rightImport: FlightScheduleImportSession | null;
  comparison: FlightScheduleComparison;
};

function toIsoDate(value: string) {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(value);
  const [, yearValue, monthValue, dayValue] = iso ?? [];
  const [, localDay, localMonth, localYear] = local ?? [];
  const year = Number(
    yearValue ?? (localYear && Number(localYear) < 100 ? `20${localYear}` : localYear),
  );
  const month = Number(monthValue ?? localMonth);
  const day = Number(dayValue ?? localDay);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid schedule date: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function withFlightCount(version: unknown): FlightScheduleVersion {
  const { flight_schedule_records: records, ...details } = version as FlightScheduleVersion & {
    flight_schedule_records?: Array<{ count: number }>;
  };
  return {
    ...details,
    flightCount: records?.[0]?.count ?? 0,
  };
}

/** Admin-only read model for active and immutable draft schedules. */
export const getFlightScheduleOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await assertAdmin(context);
    const [
      { data: active, error: activeError },
      { data: imports, error: importsError },
      { data: drafts, error: draftsError },
      { data: archived, error: archivedError },
    ] = await Promise.all([
      // Generated Supabase types are refreshed by the Lovable-owned project after migration.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb as any)
        .from("flight_schedule_versions")
        .select(
          "id, name, status, effective_from, coverage_start, coverage_end, created_by, created_at, updated_at, activated_by, activated_at, flight_schedule_records(count)",
        )
        .eq("status", "active")
        .maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb as any)
        .from("flight_schedule_imports")
        .select(
          "id, schedule_version_id, source_filename, source_type, status, total_rows, valid_rows, warning_rows, error_rows, validation_status, created_by, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb as any)
        .from("flight_schedule_versions")
        .select(
          "id, name, status, effective_from, coverage_start, coverage_end, created_by, created_at, updated_at, activated_by, activated_at, flight_schedule_records(count)",
        )
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(100),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb as any)
        .from("flight_schedule_versions")
        .select(
          "id, name, status, effective_from, coverage_start, coverage_end, created_by, created_at, updated_at, activated_by, activated_at, flight_schedule_records(count)",
        )
        .eq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(100),
    ]);
    if (activeError) throw new Error(activeError.message);
    if (importsError) throw new Error(importsError.message);
    if (draftsError) throw new Error(draftsError.message);
    if (archivedError) throw new Error(archivedError.message);
    return {
      active: active ? withFlightCount(active) : null,
      imports: (imports ?? []) as FlightScheduleImportSession[],
      drafts: (drafts ?? []).map(withFlightCount),
      archived: (archived ?? []).map(withFlightCount),
    };
  });

/** Reads exactly two immutable versions and compares their stored flight rows. */
export const compareFlightScheduleVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        leftVersionId: z.string().uuid(),
        rightVersionId: z.string().uuid(),
      })
      .refine((value) => value.leftVersionId !== value.rightVersionId, {
        message: "Choose two different schedule versions.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const versionIds = [data.leftVersionId, data.rightVersionId];
    // A single row query reads both schedules; no data is changed or written.
    const [
      { data: versions, error: versionsError },
      { data: records, error: recordsError },
      { data: imports, error: importsError },
    ] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb as any)
        .from("flight_schedule_versions")
        .select(
          "id, name, status, effective_from, coverage_start, coverage_end, created_by, created_at, updated_at, activated_by, activated_at",
        )
        .in("id", versionIds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb as any)
        .from("flight_schedule_records")
        .select(
          "schedule_version_id, scheduled_date, direction, airline, flight_number, scheduled_time, origin, destination",
        )
        .in("schedule_version_id", versionIds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb as any)
        .from("flight_schedule_imports")
        .select(
          "id, schedule_version_id, source_filename, source_type, status, total_rows, valid_rows, warning_rows, error_rows, validation_status, created_by, created_at",
        )
        .in("schedule_version_id", versionIds)
        .order("created_at", { ascending: false }),
    ]);
    if (versionsError) throw new Error(versionsError.message);
    if (recordsError) throw new Error(recordsError.message);
    if (importsError) throw new Error(importsError.message);
    const rawVersions = (versions ?? []) as Array<Omit<FlightScheduleVersion, "flightCount">>;
    if (rawVersions.length !== 2) throw new Error("One or both schedule versions no longer exist.");

    const versionRecords = new Map<string, ComparableFlightScheduleRecord[]>();
    for (const record of records ?? []) {
      const scheduleVersionId = record.schedule_version_id as string;
      versionRecords.set(scheduleVersionId, [
        ...(versionRecords.get(scheduleVersionId) ?? []),
        {
          scheduledDate: record.scheduled_date,
          direction: record.direction,
          airline: record.airline,
          flightNumber: record.flight_number,
          scheduledTime: record.scheduled_time,
          origin: record.origin,
          destination: record.destination,
        },
      ]);
    }
    const versionById = new Map(rawVersions.map((version) => [version.id, version]));
    const versionWithCount = (versionId: string): FlightScheduleVersion => ({
      ...(versionById.get(versionId) as Omit<FlightScheduleVersion, "flightCount">),
      flightCount: versionRecords.get(versionId)?.length ?? 0,
    });
    const importByVersionId = new Map<string, FlightScheduleImportSession>();
    for (const importSession of imports ?? []) {
      if (!importByVersionId.has(importSession.schedule_version_id)) {
        importByVersionId.set(importSession.schedule_version_id, importSession);
      }
    }

    const left = versionWithCount(data.leftVersionId);
    const right = versionWithCount(data.rightVersionId);
    return {
      left,
      right,
      leftImport: importByVersionId.get(left.id) ?? null,
      rightImport: importByVersionId.get(right.id) ?? null,
      comparison: compareFlightScheduleRecords(
        versionRecords.get(left.id) ?? [],
        versionRecords.get(right.id) ?? [],
      ),
    } as FlightScheduleComparisonResult;
  });

export const createFlightScheduleDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sourceFilename: z.string().trim().min(1).max(255),
        sourceType: z.literal("spreadsheet"),
        summary: z.object({
          totalRows: z.number().int().min(1),
          validRows: z.number().int().min(0),
          warningRows: z.number().int().min(0),
          errorRows: z.literal(0),
          duplicateRows: z.number().int().min(0),
          ignoredRows: z.number().int().min(0),
        }),
        records: z.array(draftRecordSchema).min(1).max(10_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const records = data.records.map((record) => ({
      ...record,
      date: toIsoDate(record.date),
      direction: record.direction.toLocaleLowerCase(),
      flightNumber: record.flightNumber.toLocaleUpperCase(),
      origin: record.origin.toLocaleUpperCase(),
      destination: record.destination.toLocaleUpperCase(),
    }));
    const duplicateKeys = new Set<string>();
    for (const record of records) {
      const key = [record.flightNumber, record.date, record.direction, record.scheduledTime].join(
        "|",
      );
      if (duplicateKeys.has(key)) throw new Error("Duplicate schedule rows cannot create a draft.");
      duplicateKeys.add(key);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created, error } = await (sb as any).rpc("create_flight_schedule_draft", {
      p_source_filename: data.sourceFilename,
      p_source_type: data.sourceType,
      p_created_by: context.userId,
      p_summary: data.summary,
      p_records: records,
    });
    if (error) throw new Error(error.message);
    const result = Array.isArray(created) ? created[0] : created;
    if (!result?.import_session_id || !result?.schedule_version_id)
      throw new Error("Draft schedule could not be created.");
    return result as { import_session_id: string; schedule_version_id: string };
  });

/** Atomically archives any current active schedule and activates one draft. */
export const activateFlightScheduleDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scheduleVersionId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    // The function is executable by the service role only; assertAdmin above
    // keeps the application-level permission check explicit and auditable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: activated, error } = await (sb as any).rpc("activate_flight_schedule_draft", {
      p_schedule_version_id: data.scheduleVersionId,
      p_activated_by: context.userId,
    });
    if (error) throw new Error(error.message);
    const result = Array.isArray(activated) ? activated[0] : activated;
    if (!result?.schedule_version_id)
      throw new Error("Schedule activation could not be completed.");
    return result as { schedule_version_id: string; archived_schedule_version_id: string | null };
  });
