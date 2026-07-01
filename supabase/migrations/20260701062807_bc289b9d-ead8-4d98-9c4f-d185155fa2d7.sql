
DO $$ BEGIN ALTER TYPE public.feature_name ADD VALUE IF NOT EXISTS 'magic_link_driver'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE public.feature_name ADD VALUE IF NOT EXISTS 'magic_link_client'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE public.feature_name ADD VALUE IF NOT EXISTS 'split_job'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE public.feature_name ADD VALUE IF NOT EXISTS 'clone_job'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE public.feature_name ADD VALUE IF NOT EXISTS 'recurring_schedule'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE public.client_booking_status ADD VALUE IF NOT EXISTS 'modification_pending'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE public.client_booking_status ADD VALUE IF NOT EXISTS 'rejected'; EXCEPTION WHEN others THEN NULL; END $$;
