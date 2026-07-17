CREATE OR REPLACE FUNCTION public.allocate_to_ai_wallet(_company_id uuid, _amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE _bal numeric(10,2);
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF auth.uid() IS NOT NULL
     AND NOT (private.is_admin(auth.uid()) OR private.is_company_owner(auth.uid(), _company_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM set_config('app.wallet_bypass', '1', true);

  UPDATE public.companies
    SET points_balance = points_balance - _amount,
        ai_points_balance = ai_points_balance + _amount
    WHERE id = _company_id AND points_balance >= _amount
    RETURNING ai_points_balance INTO _bal;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_general_points'; END IF;

  INSERT INTO public.points_ledger (company_id, feature_key, points_deducted, note)
    VALUES (_company_id, 'ai_wallet_topup', _amount, 'coordinator allocation general → AI');
  RETURN _bal;
END;
$function$;