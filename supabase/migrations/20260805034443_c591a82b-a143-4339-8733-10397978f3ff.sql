ALTER FUNCTION public.prevent_ship_departure_readiness_audit_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_ship_event_port_history_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_ship_event_port_with_review(p_ship_event_id uuid, p_company_id uuid, p_port_id uuid, p_berth_id uuid, p_changed_by uuid) SET search_path = public, pg_temp;