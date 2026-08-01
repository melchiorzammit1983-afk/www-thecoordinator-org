-- Activation changes only immutable schedule-version metadata. Imported
-- sessions and flight rows remain append-only and are never edited here.
ALTER TABLE public.flight_schedule_versions
  ADD COLUMN activated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN activated_at timestamptz;

-- This server-only function runs as the calling service role. The advisory
-- transaction lock serialises all activations, and an exception rolls back
-- both the archive and activation updates together.
CREATE FUNCTION public.activate_flight_schedule_draft(
  p_schedule_version_id uuid,
  p_activated_by uuid
)
RETURNS TABLE (schedule_version_id uuid, archived_schedule_version_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_schedule_version_id uuid;
  v_archived_schedule_version_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(424242);

  SELECT id
  INTO v_schedule_version_id
  FROM public.flight_schedule_versions
  WHERE id = p_schedule_version_id
    AND status = 'draft'
  FOR UPDATE;

  IF v_schedule_version_id IS NULL THEN
    RAISE EXCEPTION 'Only an existing draft schedule can be activated';
  END IF;

  UPDATE public.flight_schedule_versions
  SET status = 'archived', updated_at = now()
  WHERE status = 'active'
  RETURNING id INTO v_archived_schedule_version_id;

  UPDATE public.flight_schedule_versions
  SET
    status = 'active',
    activated_by = p_activated_by,
    activated_at = now(),
    updated_at = now()
  WHERE id = v_schedule_version_id;

  RETURN QUERY SELECT v_schedule_version_id, v_archived_schedule_version_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_flight_schedule_draft(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_flight_schedule_draft(uuid, uuid)
  TO service_role;
