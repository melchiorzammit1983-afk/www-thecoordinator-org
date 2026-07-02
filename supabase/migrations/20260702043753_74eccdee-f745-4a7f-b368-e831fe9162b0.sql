CREATE OR REPLACE FUNCTION public.enforce_company_owner_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Trusted server-side path (service_role via server functions): authorization
  -- is enforced in application code (assertAdmin / ownership checks).
  IF auth.uid() IS NULL AND current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.points_balance IS DISTINCT FROM OLD.points_balance
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'only_admin_can_update_sensitive_company_fields';
  END IF;
  RETURN NEW;
END $function$;