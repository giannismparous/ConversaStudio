-- Wizard in-progress bots stay off the dashboard until first successful build.
-- Duplicate creates listed drafts the user can open and build manually.
ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS listed BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN bots.listed IS
  'When false, bot is an unfinished create-wizard session (hidden from dashboard).';
