CREATE OR REPLACE FUNCTION public.enforce_company_owner_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
BEGIN
  IF session_user = 'service_role' OR current_user = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.points_balance IS DISTINCT FROM OLD.points_balance
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'only_admin_can_update_sensitive_company_fields';
  END IF;
  RETURN NEW;
END $function$;