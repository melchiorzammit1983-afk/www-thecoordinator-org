
DROP POLICY IF EXISTS drivers_self_select ON public.drivers;
CREATE POLICY drivers_self_select ON public.drivers FOR SELECT TO authenticated USING (linked_user_id = auth.uid());

DROP POLICY IF EXISTS drivers_self_update ON public.drivers;
CREATE POLICY drivers_self_update ON public.drivers FOR UPDATE TO authenticated USING (linked_user_id = auth.uid()) WITH CHECK (linked_user_id = auth.uid());

DROP POLICY IF EXISTS hops_update_participant ON public.job_dispatch_hops;
CREATE POLICY hops_update_participant ON public.job_dispatch_hops FOR UPDATE TO authenticated
USING ((to_company_id = company_of(auth.uid())) OR (from_company_id = company_of(auth.uid())))
WITH CHECK ((to_company_id = company_of(auth.uid())) OR (from_company_id = company_of(auth.uid())));

DROP POLICY IF EXISTS jobs_partner_update ON public.jobs;
CREATE POLICY jobs_partner_update ON public.jobs FOR UPDATE TO authenticated
USING ((executor_company_id = company_of(auth.uid())) OR has_connection_permission(company_of(auth.uid()), company_id, 'edit_jobs'::text))
WITH CHECK ((executor_company_id = company_of(auth.uid())) OR has_connection_permission(company_of(auth.uid()), company_id, 'edit_jobs'::text));
