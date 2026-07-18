CREATE OR REPLACE FUNCTION public.allocate_to_ai_wallet(_company_id uuid, _amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _bal numeric(10,2);
BEGIN
  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'missing_company';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  -- This RPC is intentionally service-only. The TanStack server function
  -- authenticates the signed-in coordinator and verifies company ownership
  -- before invoking it. Avoid auth.uid() here because service-role calls do
  -- not have the coordinator's auth context, which caused false forbidden
  -- errors for valid wallet top-ups.
  PERFORM set_config('app.wallet_bypass', '1', true);

  UPDATE public.companies
     SET points_balance = points_balance - _amount,
         ai_points_balance = ai_points_balance + _amount
   WHERE id = _company_id
     AND points_balance >= _amount
   RETURNING ai_points_balance INTO _bal;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_general_points';
  END IF;

  INSERT INTO public.points_ledger (company_id, feature_key, points_deducted, note)
  VALUES (_company_id, 'ai_wallet_topup', _amount, 'coordinator allocation general → AI');

  RETURN _bal;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allocate_to_ai_wallet(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_to_ai_wallet(uuid, numeric) TO service_role;