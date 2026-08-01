import { DIALOGOS_DEFAULTS } from './defaults.js';

export const DIALOGOS_DEFAULTS_EL = {
  welcomeMessage:
    'Γεια — είμαι το DialogosAI. Ρωτήστε με οτιδήποτε σχετικά με όσα έχω μάθει από τα έγγραφά σας.',
  suggestedQuestions: [
    'Τι μπορεί να κάνει για μένα το DialogosAI;',
    'Πώς μπορώ να επικοινωνήσω μαζί σας;',
  ],
  systemPrompt:
    'Είσαι το DialogosAI.\nΑπαντάς ΜΟΝΟ με βάση τις πληροφορίες στο CONTEXT.\nΜίλα φυσικά σε πρώτο πρόσωπο, σαν βοηθητικός άνθρωπος — ποτέ σαν σενάριο bot.',
};

export function greekArticle(personaGender) {
  if (personaGender === 'masculine') return 'ο';
  if (personaGender === 'feminine') return 'η';
  return 'το';
}

/** Genitive article before a name: του (he/it), της (she). */
export function greekGenitiveArticle(personaGender) {
  if (personaGender === 'feminine') return 'της';
  return 'του';
}

/** Vars for Greek build / ready titles that agree with persona gender. */
export function greekBuildNameVars(botName, personaGender = 'neutral') {
  const name = String(botName || '').trim() || 'DialogosAI';
  const article = greekGenitiveArticle(personaGender);
  if (personaGender === 'masculine') {
    return { name, article, nomArticle: 'Ο', readyAdj: 'έτοιμος' };
  }
  if (personaGender === 'feminine') {
    return { name, article, nomArticle: 'Η', readyAdj: 'έτοιμη' };
  }
  return { name, article, nomArticle: 'Το', readyAdj: 'έτοιμο' };
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * JS \\b does not treat Greek letters as word chars, so article+name never matched.
 * Use unicode letter/number boundaries instead.
 */
function greekArticleNameRe(name) {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])(ο|η|το)\\s+${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}_])`,
    'giu'
  );
}

export function looksGreek(text) {
  return /[\u0370-\u03FF\u1F00-\u1FFF]/.test(String(text || ''));
}

/** Normalize personalized copy back to DialogosAI templates for default matching. */
export function asDialogosTemplate(text, botName = '') {
  let result = String(text || '');
  const names = [...new Set([String(botName || '').trim(), 'DialogosAI'].filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  for (const name of names) {
    result = result.replace(greekArticleNameRe(name), '$1το DialogosAI');
    if (name !== 'DialogosAI') {
      result = result.split(name).join('DialogosAI');
    }
  }
  return result.trim();
}

/** Force the correct Greek article (ο/η/το) before the bot name. */
export function applyGreekPersonaGrammar(text, botName, personaGender = 'neutral') {
  const name = String(botName || '').trim() || 'DialogosAI';
  const article = greekArticle(personaGender);
  const names = [...new Set([name, 'DialogosAI'].filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  let next = String(text || '');
  for (const n of names) {
    next = next.replace(greekArticleNameRe(n), `$1${article} ${name}`);
  }
  if (name !== 'DialogosAI' && next.includes('DialogosAI')) {
    next = next.split('DialogosAI').join(name);
    next = next.replace(greekArticleNameRe(name), `$1${article} ${name}`);
  }
  return next;
}

export function personalizeUiCopy(copy, botName, personaGender = 'neutral') {
  const name = String(botName || '').trim() || 'DialogosAI';
  return {
    welcomeMessage: applyGreekPersonaGrammar(copy.welcomeMessage, name, personaGender),
    suggestedQuestions: (copy.suggestedQuestions || []).map((q) =>
      applyGreekPersonaGrammar(q, name, personaGender)
    ),
  };
}

export function normalizeSuggestedQuestions(list) {
  if (typeof list === 'string') {
    try {
      const parsed = JSON.parse(list);
      return normalizeSuggestedQuestions(parsed);
    } catch {
      return [];
    }
  }
  return (Array.isArray(list) ? list : [])
    .map((item) => (typeof item === 'string' ? item : item?.text))
    .map((text) => String(text || '').trim())
    .filter(Boolean);
}

function matchesTemplateSet(welcome, questions, defaultWelcome, defaultQuestions) {
  const dq = normalizeSuggestedQuestions(defaultQuestions);
  if (welcome !== String(defaultWelcome || '').trim()) return false;
  if (questions.length !== dq.length) return false;
  return questions.every((question, index) => question === dq[index]);
}

export function matchesDialogosDefaults(welcomeMessage, suggestedQuestions, botName = '') {
  const welcome = asDialogosTemplate(welcomeMessage, botName);
  const questions = normalizeSuggestedQuestions(suggestedQuestions).map((q) =>
    asDialogosTemplate(q, botName)
  );

  return (
    matchesTemplateSet(
      welcome,
      questions,
      DIALOGOS_DEFAULTS.welcomeMessage,
      DIALOGOS_DEFAULTS.suggestedQuestions
    ) ||
    matchesTemplateSet(
      welcome,
      questions,
      DIALOGOS_DEFAULTS_EL.welcomeMessage,
      DIALOGOS_DEFAULTS_EL.suggestedQuestions
    )
  );
}

function matchesDialogosWelcome(welcomeMessage, botName = '') {
  const welcome = asDialogosTemplate(welcomeMessage, botName);
  return (
    welcome === String(DIALOGOS_DEFAULTS.welcomeMessage || '').trim() ||
    welcome === String(DIALOGOS_DEFAULTS_EL.welcomeMessage || '').trim()
  );
}

/** Greek UI copy when translation is unavailable — never leave English on screen. */
export function greekFallbackUiCopy(botName, personaGender = 'neutral') {
  return personalizeUiCopy(
    {
      welcomeMessage: DIALOGOS_DEFAULTS_EL.welcomeMessage,
      suggestedQuestions: [...DIALOGOS_DEFAULTS_EL.suggestedQuestions],
    },
    botName,
    personaGender
  );
}

/**
 * Instant UI copy for test / preview.
 * Returns null only when Greek needs a live translation of custom English copy.
 */
export function resolveTestUiCopy({
  welcomeMessage,
  suggestedQuestions,
  language,
  botName,
  personaGender = 'neutral',
}) {
  const questions = normalizeSuggestedQuestions(suggestedQuestions);
  const welcome = String(welcomeMessage || '').trim();
  const name = String(botName || '').trim() || 'DialogosAI';

  if (language === 'en') {
    return personalizeUiCopy(
      { welcomeMessage: welcome, suggestedQuestions: questions },
      name,
      personaGender
    );
  }

  if (language !== 'el') return null;

  // Already Greek — keep (fix articles).
  if (looksGreek(welcome)) {
    const greekQuestions = questions.every((q) => !q || looksGreek(q))
      ? questions
      : [...DIALOGOS_DEFAULTS_EL.suggestedQuestions];
    return personalizeUiCopy(
      { welcomeMessage: welcome, suggestedQuestions: greekQuestions },
      name,
      personaGender
    );
  }

  // Dialogos default templates (full or welcome-only) → canned Greek.
  if (matchesDialogosDefaults(welcome, questions, name) || matchesDialogosWelcome(welcome, name)) {
    return personalizeUiCopy(
      {
        welcomeMessage: DIALOGOS_DEFAULTS_EL.welcomeMessage,
        suggestedQuestions: [...DIALOGOS_DEFAULTS_EL.suggestedQuestions],
      },
      name,
      personaGender
    );
  }

  return null;
}
