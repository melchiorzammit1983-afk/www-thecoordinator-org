-- Ship Operations 21B: immutable Port/Berth change history and one current review.
CREATE TABLE public.ship_event_port_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  ship_event_id uuid NOT NULL REFERENCES public.ship_events(id) ON DELETE RESTRICT,
  previous_port_id uuid,
  previous_port_name text,
  previous_berth_id uuid,
  previous_berth_name text,
  new_port_id uuid NOT NULL REFERENCES public.ports(id) ON DELETE RESTRICT,
  new_port_name text NOT NULL,
  new_berth_id uuid,
  new_berth_name text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ship_event_port_history_event_changed_idx
  ON public.ship_event_port_change_history (ship_event_id, changed_at DESC);

ALTER TABLE public.ship_event_port_change_history ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ship_event_port_change_history TO service_role;
REVOKE ALL ON public.ship_event_port_change_history FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_ship_event_port_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ship Port/Berth history records are immutable';
END;
$$;

CREATE TRIGGER ship_event_port_history_immutable
  BEFORE UPDATE OR DELETE ON public.ship_event_port_change_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ship_event_port_history_mutation();

CREATE TABLE public.ship_event_port_change_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  ship_event_id uuid NOT NULL UNIQUE REFERENCES public.ship_events(id) ON DELETE RESTRICT,
  history_id uuid NOT NULL REFERENCES public.ship_event_port_change_history(id) ON DELETE RESTRICT,
  previous_port_name text,
  previous_berth_name text,
  new_port_name text NOT NULL,
  new_berth_name text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ship_event_port_change_reviews_company_idx
  ON public.ship_event_port_change_reviews (company_id, updated_at DESC);

ALTER TABLE public.ship_event_port_change_reviews ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ship_event_port_change_reviews TO service_role;
REVOKE ALL ON public.ship_event_port_change_reviews FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_ship_event_port_with_review(
  p_ship_event_id uuid,
  p_company_id uuid,
  p_port_id uuid,
  p_berth_id uuid,
  p_changed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_event public.ship_events%ROWTYPE;
  v_port public.ports%ROWTYPE;
  v_berth public.berths%ROWTYPE;
  v_previous_port_name text;
  v_previous_berth_name text;
  v_history_id uuid;
BEGIN
  SELECT * INTO v_event
  FROM public.ship_events
  WHERE id = p_ship_event_id AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ship event not found'; END IF;
  IF v_event.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Archived ship events cannot be changed'; END IF;

  SELECT * INTO v_port
  FROM public.ports
  WHERE id = p_port_id AND company_id = p_company_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Port not found for this company'; END IF;

  IF p_berth_id IS NOT NULL THEN
    SELECT * INTO v_berth
    FROM public.berths
    WHERE id = p_berth_id AND port_id = p_port_id AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Berth not found for the selected port'; END IF;
  END IF;

  IF v_event.port_id IS NOT DISTINCT FROM p_port_id
    AND v_event.berth_id IS NOT DISTINCT FROM p_berth_id THEN
    RETURN jsonb_build_object('changed', false, 'ship_event_id', p_ship_event_id);
  END IF;

  SELECT name INTO v_previous_port_name FROM public.ports WHERE id = v_event.port_id;
  SELECT name INTO v_previous_berth_name FROM public.berths WHERE id = v_event.berth_id;

  INSERT INTO public.ship_event_port_change_history (
    company_id, ship_event_id, previous_port_id, previous_port_name,
    previous_berth_id, previous_berth_name, new_port_id, new_port_name,
    new_berth_id, new_berth_name, changed_by
  ) VALUES (
    p_company_id, p_ship_event_id, v_event.port_id, v_previous_port_name,
    v_event.berth_id, v_previous_berth_name, p_port_id, v_port.name,
    p_berth_id, CASE WHEN p_berth_id IS NULL THEN NULL ELSE v_berth.name END, p_changed_by
  ) RETURNING id INTO v_history_id;

  UPDATE public.ship_events
  SET port = v_port.name, port_id = p_port_id, berth_id = p_berth_id, updated_at = now()
  WHERE id = p_ship_event_id;

  -- A history row is always retained, but the active review exists only when
  -- at least one company job is linked to this ship event.
  IF EXISTS (
    SELECT 1 FROM public.jobs
    WHERE company_id = p_company_id AND ship_event_id = p_ship_event_id
  ) THEN
    INSERT INTO public.ship_event_port_change_reviews (
      company_id, ship_event_id, history_id, previous_port_name, previous_berth_name,
      new_port_name, new_berth_name, changed_by, changed_at, updated_at
    ) VALUES (
      p_company_id, p_ship_event_id, v_history_id, v_previous_port_name, v_previous_berth_name,
      v_port.name, CASE WHEN p_berth_id IS NULL THEN NULL ELSE v_berth.name END,
      p_changed_by, now(), now()
    )
    ON CONFLICT (ship_event_id) DO UPDATE SET
      history_id = EXCLUDED.history_id,
      previous_port_name = EXCLUDED.previous_port_name,
      previous_berth_name = EXCLUDED.previous_berth_name,
      new_port_name = EXCLUDED.new_port_name,
      new_berth_name = EXCLUDED.new_berth_name,
      changed_by = EXCLUDED.changed_by,
      changed_at = EXCLUDED.changed_at,
      updated_at = now();

    UPDATE public.jobs
    SET needs_review = true
    WHERE company_id = p_company_id AND ship_event_id = p_ship_event_id;
  END IF;

  RETURN jsonb_build_object('changed', true, 'ship_event_id', p_ship_event_id, 'history_id', v_history_id);
END;
$$;

REVOKE ALL ON FUNCTION public.update_ship_event_port_with_review(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_ship_event_port_with_review(uuid, uuid, uuid, uuid, uuid) TO service_role;