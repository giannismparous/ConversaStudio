import { pool, getGenderInferModel } from '../config.js';

/** In-flight Gemini calls keyed by name — collapses concurrent cache misses. */
const inflightByName = new Map();

function normalizeGender(value) {
  const raw = String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s_-]/g, ' ')
    .trim();
  if (!raw) return null;

  // Prefer whole-word matches so "feminine" is never confused with "male".
  const tokens = raw.split(/[\s_-]+/).filter(Boolean);
  for (const token of tokens) {
    if (token === 'feminine' || token === 'female' || token === 'she' || token === 'f') {
      return 'feminine';
    }
    if (token === 'masculine' || token === 'male' || token === 'he' || token === 'm') {
      return 'masculine';
    }
    if (token === 'neutral' || token === 'it' || token === 'n' || token === 'unknown') {
      return 'neutral';
    }
  }

  if (/\bfeminine\b|\bfemale\b|\bshe\b/.test(raw)) return 'feminine';
  if (/\bmasculine\b|\bmale\b|\bhe\b/.test(raw)) return 'masculine';
  if (/\bneutral\b|\bit\b/.test(raw)) return 'neutral';
  return null;
}

function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

async function readCachedGender(key) {
  if (!key) return null;
  const { rows } = await pool.query(
    `SELECT persona_gender FROM persona_gender_defaults WHERE name_key = $1`,
    [key]
  );
  const gender = rows[0]?.persona_gender;
  if (gender === 'masculine' || gender === 'feminine' || gender === 'neutral') return gender;
  return null;
}

async function writeCachedGender(displayName, gender) {
  const key = nameKey(displayName);
  const personaGender = normalizeGender(gender);
  // Never persist unparsed / failed guesses as neutral.
  if (!key || !personaGender) return;
  await pool.query(
    `INSERT INTO persona_gender_defaults (name_key, display_name, persona_gender)
     VALUES ($1, $2, $3)
     ON CONFLICT (name_key) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           persona_gender = EXCLUDED.persona_gender,
           updated_at = NOW()`,
    [key, String(displayName || '').trim() || key, personaGender]
  );
}

async function deleteCachedGender(key) {
  if (!key) return;
  await pool.query(`DELETE FROM persona_gender_defaults WHERE name_key = $1`, [key]);
}

async function inferFromModel(botName) {
  const chat = getGenderInferModel();
  const prompt = [
    'You classify given-name gender for a chatbot persona.',
    'Reply with EXACTLY one word and nothing else: masculine, feminine, or neutral.',
    '',
    'Definitions:',
    '- feminine: typically female given names (Stephanie, Maria, Sofia, Emma, …)',
    '- masculine: typically male given names (John, Nikos, Ahmed, Michael, …)',
    '- neutral: brands, products, acronyms, places, invented words, OR clearly unisex names (Alex, Jordan, Sam, Taylor) when no other cue exists',
    '',
    'Important: common gendered given names must NOT be neutral.',
    'Examples: Stephanie=feminine, Maria=feminine, John=masculine, Alex=neutral, DialogosAI=neutral.',
    '',
    `Name: ${botName}`,
  ].join('\n');

  const response = await chat.generate({ prompt });
  const parsed = normalizeGender(response);
  if (!parsed) {
    const err = new Error(`Unparseable gender response: ${JSON.stringify(response)}`);
    err.statusCode = 502;
    throw err;
  }
  return parsed;
}

/**
 * Resolve persona gender for a bot name.
 * Shared DB cache first; Gemini only on cache miss (deduped per name).
 * @returns {{ personaGender: 'masculine'|'feminine'|'neutral', source: 'default'|'cache'|'model' }}
 */
export async function inferPersonaGender(name) {
  const botName = String(name || '').trim();
  if (!botName) return { personaGender: 'neutral', source: 'default' };

  const key = nameKey(botName);
  if (key === 'dialogosai') {
    const existing = await readCachedGender(key);
    if (!existing) await writeCachedGender(botName, 'neutral');
    return { personaGender: 'neutral', source: 'default' };
  }

  const cached = await readCachedGender(key);
  if (cached) return { personaGender: cached, source: 'cache' };

  if (inflightByName.has(key)) {
    return inflightByName.get(key);
  }

  const promise = (async () => {
    try {
      const again = await readCachedGender(key);
      if (again) return { personaGender: again, source: 'cache' };

      const personaGender = await inferFromModel(botName);
      await writeCachedGender(botName, personaGender);
      return { personaGender, source: 'model' };
    } catch (err) {
      // Do not leave a poison neutral cache entry behind on model failures.
      await deleteCachedGender(key).catch(() => {});
      throw err;
    } finally {
      inflightByName.delete(key);
    }
  })();

  inflightByName.set(key, promise);
  return promise;
}
