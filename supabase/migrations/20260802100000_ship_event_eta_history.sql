-- Ship Operations v1.7: preserve an immutable audit trail of genuine ETA changes.
CREATE TABLE public.ship_event_eta_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_event_id uuid NOT NULL REFERENCES public.ship_events(id) ON DELETE RESTRICT,
  previous_eta timestamptz NOT NULL,
  new_eta timestamptz NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX ship_event_eta_history_event_changed_idx
  ON public.ship_event_eta_history (ship_event_id, changed_at DESC);

ALTER TABLE public.ship_event_eta_history ENABLE ROW LEVEL SECURITY;

-- The table is server-only, consistent with ship_events. The authenticated
-- caller is resolved by the server function before this RPC is invoked.
GRANT ALL ON public.ship_event_eta_history TO service_role;
REVOKE ALL ON public.ship_event_eta_history FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_ship_event_eta_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Ship ETA history records are immutable';
END;
$$;

CREATE TRIGGER ship_event_eta_history_immutable
  BEFORE UPDATE OR DELETE ON public.ship_event_eta_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ship_event_eta_history_mutation();

-- Updating the current ETA and recording its previous value must succeed or
-- fail together. This RPC is deliberately callable by service_role only.
CREATE OR REPLACE FUNCTION public.update_ship_event_eta_with_history(
  p_ship_event_id uuid,
  p_company_id uuid,
  p_eta timestamptz,
  p_changed_by uuid
)
RETURNS public.ship_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous public.ship_events;
  v_updated public.ship_events;
BEGIN
  SELECT *
    INTO v_previous
    FROM public.ship_events
   WHERE id = p_ship_event_id
     AND company_id = p_company_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ship event not found';
  END IF;

  IF v_previous.eta IS NOT DISTINCT FROM p_eta THEN
    RETURN v_previous;
  END IF;

  UPDATE public.ship_events
     SET eta = p_eta,
         updated_at = now()
   WHERE id = p_ship_event_id
   RETURNING * INTO v_updated;

  INSERT INTO public.ship_event_eta_history (
    ship_event_id,
    previous_eta,
    new_eta,
    changed_by
  ) VALUES (
    p_ship_event_id,
    v_previous.eta,
    v_updated.eta,
    p_changed_by
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_ship_event_eta_with_history(uuid, uuid, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_ship_event_eta_with_history(uuid, uuid, timestamptz, uuid)
  TO service_role;
