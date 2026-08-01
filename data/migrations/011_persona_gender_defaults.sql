-- Global cache: inferred default persona gender by bot name (shared across users).
CREATE TABLE IF NOT EXISTS persona_gender_defaults (
  name_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  persona_gender TEXT NOT NULL
    CHECK (persona_gender IN ('masculine', 'feminine', 'neutral')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO persona_gender_defaults (name_key, display_name, persona_gender)
VALUES ('dialogosai', 'DialogosAI', 'neutral')
ON CONFLICT (name_key) DO NOTHING;

ALTER TABLE IF EXISTS public.persona_gender_defaults ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.persona_gender_defaults FROM anon, authenticated';
  END IF;
END $$;
