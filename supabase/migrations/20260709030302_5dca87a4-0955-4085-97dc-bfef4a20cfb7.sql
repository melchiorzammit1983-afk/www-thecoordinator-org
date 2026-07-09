
-- Fix portal-logos UPDATE/DELETE policies: compare to storage.objects.name, not pc.name
DROP POLICY IF EXISTS "coordinator can update portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can delete portal logos" ON storage.objects;

CREATE POLICY "coordinator can update portal logos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'portal-logos' AND EXISTS (
    SELECT 1 FROM public.portal_companies pc
    WHERE (pc.id)::text = split_part(storage.objects.name, '/', 1)
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  )
)
WITH CHECK (
  bucket_id = 'portal-logos' AND EXISTS (
    SELECT 1 FROM public.portal_companies pc
    WHERE (pc.id)::text = split_part(storage.objects.name, '/', 1)
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  )
);

CREATE POLICY "coordinator can delete portal logos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'portal-logos' AND EXISTS (
    SELECT 1 FROM public.portal_companies pc
    WHERE (pc.id)::text = split_part(storage.objects.name, '/', 1)
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  )
);

-- Attach enforce_jobs_partner_update trigger so partners (executors / connection-permission holders)
-- cannot modify dispatch_chain_company_ids, origin_company_id, or company_id via UPDATE.
DROP TRIGGER IF EXISTS trg_enforce_jobs_partner_update ON public.jobs;
CREATE TRIGGER trg_enforce_jobs_partner_update
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_partner_update();
