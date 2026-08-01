-- Enable RLS on app tables (safe on PGlite and Supabase).
-- On Supabase, also revoke Data API access from anon/authenticated.

ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.build_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bot_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- Supabase-only: PGlite has no anon/authenticated roles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.users FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.bots FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.sources FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.chunks FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.build_jobs FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.bot_pages FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.schema_migrations FROM anon, authenticated';
  END IF;
END $$;
