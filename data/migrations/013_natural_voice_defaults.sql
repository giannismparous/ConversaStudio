-- Natural first-person voice for new bots (no "human-centered digital navigation" pitch).
ALTER TABLE bots
  ALTER COLUMN system_prompt SET DEFAULT
  'You are DialogosAI.
Answer using ONLY the information in the provided CONTEXT.
Talk naturally in first person, like a helpful person — never like a scripted bot.';

-- Soften existing prompts that use the old robotic title phrase.
UPDATE bots
SET system_prompt = trim(both E'\n' FROM regexp_replace(
  system_prompt,
  E',?\\s*a human-centered digital navigation assistant\\.?',
  '',
  'gi'
))
WHERE system_prompt ILIKE '%human-centered digital navigation assistant%';

-- Ensure softened prompts get the natural-voice line once.
UPDATE bots
SET system_prompt = system_prompt || E'\nTalk naturally in first person, like a helpful person — never like a scripted bot.'
WHERE system_prompt NOT ILIKE '%Talk naturally in first person%'
  AND system_prompt ~* '^You are ';
