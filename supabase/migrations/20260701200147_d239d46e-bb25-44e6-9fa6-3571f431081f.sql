
-- 1) companies: prevent owner from changing sensitive fields
CREATE OR REPLACE FUNCTION public.enforce_company_owner_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF NEW.points_balance IS DISTINCT FROM OLD.points_balance
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'only_admin_can_update_sensitive_company_fields';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_company_owner_update ON public.companies;
CREATE TRIGGER trg_enforce_company_owner_update
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_company_owner_update();

-- 2) job_dispatch_hops: add WITH CHECK + prevent immutable field changes
DROP POLICY IF EXISTS hops_update_participant ON public.job_dispatch_hops;
CREATE POLICY hops_update_participant ON public.job_dispatch_hops
  FOR UPDATE
  USING ((to_company_id = company_of(auth.uid())) OR (from_company_id = company_of(auth.uid())))
  WITH CHECK ((to_company_id = company_of(auth.uid())) OR (from_company_id = company_of(auth.uid())));

CREATE OR REPLACE FUNCTION public.enforce_hop_immutable_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.hop_index IS DISTINCT FROM OLD.hop_index
     OR NEW.from_company_id IS DISTINCT FROM OLD.from_company_id
     OR NEW.to_company_id IS DISTINCT FROM OLD.to_company_id THEN
    RAISE EXCEPTION 'hop_identifying_fields_are_immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_hop_immutable ON public.job_dispatch_hops;
CREATE TRIGGER trg_enforce_hop_immutable
  BEFORE UPDATE ON public.job_dispatch_hops
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hop_immutable_fields();

-- 3) jobs_partner_update: add WITH CHECK + prevent partners changing ownership/chain fields
DROP POLICY IF EXISTS jobs_partner_update ON public.jobs;
CREATE POLICY jobs_partner_update ON public.jobs
  FOR UPDATE
  USING ((executor_company_id = company_of(auth.uid())) OR has_connection_permission(company_of(auth.uid()), company_id, 'edit_jobs'::text))
  WITH CHECK ((executor_company_id = company_of(auth.uid())) OR has_connection_permission(company_of(auth.uid()), company_id, 'edit_jobs'::text));

CREATE OR REPLACE FUNCTION public.enforce_jobs_partner_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid;
BEGIN
  IF public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  _me := public.company_of(auth.uid());
  IF _me IS NULL THEN RETURN NEW; END IF;
  -- Owner company may freely edit ownership fields
  IF _me = OLD.company_id THEN RETURN NEW; END IF;
  -- Partners/executors cannot rewrite ownership or dispatch chain
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.origin_company_id IS DISTINCT FROM OLD.origin_company_id
     OR NEW.dispatch_chain_company_ids IS DISTINCT FROM OLD.dispatch_chain_company_ids THEN
    RAISE EXCEPTION 'partners_cannot_change_ownership_fields';
  END IF;
  -- Only the current executor may reassign executor_company_id (i.e. forward dispatch)
  IF NEW.executor_company_id IS DISTINCT FROM OLD.executor_company_id
     AND _me <> COALESCE(OLD.executor_company_id, OLD.company_id) THEN
    RAISE EXCEPTION 'only_current_executor_can_reassign_executor';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_jobs_partner_update ON public.jobs;
CREATE TRIGGER trg_enforce_jobs_partner_update
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_partner_update();

-- 4) drivers: add self-scoped policies for linked drivers
CREATE POLICY drivers_self_select ON public.drivers
  FOR SELECT
  USING (linked_user_id = auth.uid());

CREATE POLICY drivers_self_update ON public.drivers
  FOR UPDATE
  USING (linked_user_id = auth.uid())
  WITH CHECK (linked_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.enforce_driver_self_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF OLD.linked_user_id IS NOT NULL AND OLD.linked_user_id = auth.uid()
     AND NOT public.is_company_owner(auth.uid(), OLD.company_id) THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.linked_user_id IS DISTINCT FROM OLD.linked_user_id
       OR NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'drivers_cannot_change_identifying_fields';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_driver_self_update ON public.drivers;
CREATE TRIGGER trg_enforce_driver_self_update
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_driver_self_update();
