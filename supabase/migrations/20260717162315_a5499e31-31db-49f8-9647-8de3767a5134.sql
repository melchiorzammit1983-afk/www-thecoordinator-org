
revoke execute on function public.is_platform_admin(uuid) from public, anon, authenticated;
revoke execute on function public.my_company_id(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin(uuid) to service_role;
grant execute on function public.my_company_id(uuid) to service_role;
