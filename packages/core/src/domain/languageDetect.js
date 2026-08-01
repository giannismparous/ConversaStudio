const GREEK_SCRIPT = /[\u0370-\u03FF\u1F00-\u1FFF]/;

/** Distinctive English — avoid tiny words that collide with Greeklish (me, a, an, or, to…). */
const ENGLISH_MARKERS =
  /\b(what|who|how|why|when|where|which|whose|whom|is|are|was|were|can|could|would|should|do|does|did|have|has|had|the|this|that|these|those|please|help|tell|explain|about|with|your|you|my|from|into|than|then|because|before|after|hello|hi|hey|thanks|thank|contact|company|price|hours|open|closed|phone|address|whereabouts|information|looking|need|want|know)\b/i;

/**
 * Common Greeklish tokens (Greek in Latin letters).
 * Prefer high-signal words; avoid tokens that are also common English (an, to, is, me alone).
 */
const GREEKLISH_MARKERS =
  /\b(ti|pos|pws|pou|pote|giati|gt|gia|kai|den|tha|na|mou|sou|mas|sas|tou|tis|ton|tin|sto|sti|sta|ston|stin|einai|eimai|eisai|eimaste|eiste|thelo|thelw|theleis|thelei|thelume|kaneis|kane|kanei|kanoume|kanete|kanoun|milao|milas|milaei|milame|les|leei|leme|lew|leo|vlepo|vlepeis|xero|ksero|kseris|kserete|thes|thelete|kalimera|kalhmera|kalispera|kalhspera|geia|yiasou|geiasou|parakalo|parakalw|efharisto|euxaristo|efxaristo|nai|oxi|ohi|auto|afto|afti|afta|ekei|edo|edw|tora|meta|prin|poli|poly|ligo|kati|kapoio|kapoia|kapoios|poso|posi|posa|posos|mia|ena|enan|enas|etairia|etaireia|kostizei|kostizoun|ora|ores|tilefono|dieythinsi|dieythinsh|poion|poia|poio|poios|poiou|sena|emena|milame|rwta|rwthsh|erotisi|erwtisi)\b/i;

/** Digraphs / endings that strongly suggest Greeklish (not plain English). */
const GREEKLISH_SHAPE =
  /\b(?:th|ps|ks|mp|nt)[aeiouy][a-z]{1,}\b|\b[a-z]{2,}(?:eisai|eimaste|oume|iete)\b/i;

/**
 * Detect reply language from the user's latest message only.
 * English only when the message is clearly English.
 * Greek script OR Greeklish → Greek reply.
 * @returns {'en' | 'el'}
 */
export function detectMessageLanguage(text) {
  const message = String(text || '').trim();
  if (!message) return 'en';

  if (GREEK_SCRIPT.test(message)) return 'el';

  const lower = message.toLowerCase();
  const latinLetters = (lower.match(/[a-z]/g) || []).length;
  if (latinLetters < 2) return 'en';

  const englishHits = (lower.match(new RegExp(ENGLISH_MARKERS.source, 'gi')) || []).length;
  const greeklishHits = (lower.match(new RegExp(GREEKLISH_MARKERS.source, 'gi')) || []).length;
  const shapeHits = GREEKLISH_SHAPE.test(lower) ? 1 : 0;
  const greeklishScore = greeklishHits + shapeHits;

  if (greeklishScore > 0 && englishHits === 0) return 'el';
  if (englishHits > 0 && greeklishScore === 0) return 'en';
  if (greeklishScore >= englishHits) return 'el';
  if (englishHits > greeklishScore) return 'en';

  return 'en';
}

/**
 * Reply language follows the user message.
 * Explicit UI language must NOT force English replies to Greek/Greeklish messages.
 */
export function resolveReplyLanguage(message, _explicitLanguage) {
  return detectMessageLanguage(message);
}
