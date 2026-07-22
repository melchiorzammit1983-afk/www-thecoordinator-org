/**
 * Server-only helper for writing to public.trip_audit_log via the
 * SECURITY DEFINER function public.record_trip_audit.
 *
 * The RPC is granted to service_role only (authenticated cannot execute it
 * directly). Callers MUST be inside a server function or server route that
 * already authenticated the actor. Pass the caller's user id via
 * `actor_user_id`; the RPC uses it in place of auth.uid().
 */
export type RecordTripAuditArgs = {
  job_id: string | null;
  event_type: string;
  previous?: Record<string, unknown> | null;
  new?: Record<string, unknown> | null;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  address?: string | null;
  speed?: number | null;
  device_time?: string | null;
  group_id?: string | null;
  stop_id?: string | null;
  approval_status?: string | null;
  driver_id?: string | null;
  actor_label?: string | null;
  /** Authenticated user id from the calling server-fn context, if any. */
  actor_user_id?: string | null;
};

export async function recordTripAudit(args: RecordTripAuditArgs): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("record_trip_audit" as never, {
    _job_id: args.job_id,
    _event_type: args.event_type,
    _previous: (args.previous ?? null) as never,
    _new: (args.new ?? null) as never,
    _notes: args.notes ?? null,
    _lat: args.lat ?? null,
    _lng: args.lng ?? null,
    _accuracy: args.accuracy ?? null,
    _address: args.address ?? null,
    _speed: args.speed ?? null,
    _device_time: args.device_time ?? null,
    _group_id: args.group_id ?? null,
    _stop_id: args.stop_id ?? null,
    _approval_status: args.approval_status ?? null,
    _driver_id: args.driver_id ?? null,
    _actor_label: args.actor_label ?? null,
    _actor_user_id: args.actor_user_id ?? null,
  } as never);
  if (error) {
    console.warn("[recordTripAudit] rpc failed:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}
