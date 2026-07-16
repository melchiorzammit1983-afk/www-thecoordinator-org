
-- 1) client_link_identities: add explicit admin/service policy for server flows
CREATE POLICY "Admins can read link identities"
  ON public.client_link_identities
  FOR SELECT
  TO authenticated
  USING (private.is_admin(auth.uid()));

-- 2) job_price_proposals: enforce column-level immutability via trigger
CREATE OR REPLACE FUNCTION public.enforce_price_proposal_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
DECLARE
  _me uuid := auth.uid();
  _is_from_party boolean := FALSE;
  _is_to_party boolean := FALSE;
BEGIN
  IF private.is_admin(_me) THEN
    RETURN NEW;
  END IF;

  IF OLD.from_company_id IS NOT NULL AND private.is_company_owner(_me, OLD.from_company_id) THEN
    _is_from_party := TRUE;
  END IF;
  IF OLD.to_company_id IS NOT NULL AND private.is_company_owner(_me, OLD.to_company_id) THEN
    _is_to_party := TRUE;
  END IF;

  -- Identifying / financial fields are immutable after creation
  IF NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.hop_id IS DISTINCT FROM OLD.hop_id
     OR NEW.from_party_kind IS DISTINCT FROM OLD.from_party_kind
     OR NEW.from_company_id IS DISTINCT FROM OLD.from_company_id
     OR NEW.from_driver_id IS DISTINCT FROM OLD.from_driver_id
     OR NEW.to_company_id IS DISTINCT FROM OLD.to_company_id
     OR NEW.to_driver_id IS DISTINCT FROM OLD.to_driver_id
     OR NEW.amount_eur IS DISTINCT FROM OLD.amount_eur
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'price_proposal_core_fields_immutable';
  END IF;

  -- Status transitions: only the counterpart (to_*) may accept.
  -- The originator may recall. Either can mark superseded/countered via new rows.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' AND NOT _is_to_party THEN
      RAISE EXCEPTION 'only_counterpart_can_accept_proposal';
    END IF;
    IF NEW.status = 'recalled' AND NOT _is_from_party THEN
      RAISE EXCEPTION 'only_originator_can_recall_proposal';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_price_proposal_update_trg ON public.job_price_proposals;
CREATE TRIGGER enforce_price_proposal_update_trg
  BEFORE UPDATE ON public.job_price_proposals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_price_proposal_update();

-- 3) portal-logos storage: standardize on storage.foldername
DROP POLICY IF EXISTS "coordinator can update portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can delete portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can upload portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can read portal logos" ON storage.objects;

CREATE POLICY "coordinator can read portal logos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'portal-logos' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id
             OR private.is_admin(auth.uid()))
    )
  );

CREATE POLICY "coordinator can upload portal logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'portal-logos' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(name))[1]
        AND pc.coordinator_company_id = private.company_of(auth.uid())
    )
  );

CREATE POLICY "coordinator can update portal logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'portal-logos' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id
             OR private.is_admin(auth.uid()))
    )
  )
  WITH CHECK (
    bucket_id = 'portal-logos' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id
             OR private.is_admin(auth.uid()))
    )
  );

CREATE POLICY "coordinator can delete portal logos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'portal-logos' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id
             OR private.is_admin(auth.uid()))
    )
  );
