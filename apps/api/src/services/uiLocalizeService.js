import {
  englishFallbackUiCopy,
  greekFallbackUiCopy,
  looksGreek,
  normalizeSuggestedQuestions,
  personalizeEnglishUiCopy,
  personalizeUiCopy,
  resolveTestUiCopy,
} from '@dialogos-forge/core';
import { getChatModel } from '../config.js';

const cache = new Map();

function cacheKey(language, welcomeMessage, suggestedQuestions, botName, personaGender) {
  return `${language}\0${botName}\0${personaGender}\0${welcomeMessage}\0${JSON.stringify(normalizeSuggestedQuestions(suggestedQuestions))}`;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object in model response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function localizeBotUiCopy({
  welcomeMessage,
  suggestedQuestions,
  language,
  botName = 'Assistant',
  personaGender = 'neutral',
}) {
  const resolved = resolveTestUiCopy({
    welcomeMessage,
    suggestedQuestions,
    language,
    botName,
    personaGender,
  });
  if (resolved) return resolved;

  const key = cacheKey(language, welcomeMessage, suggestedQuestions, botName, personaGender);
  if (cache.has(key)) return cache.get(key);

  const questions = normalizeSuggestedQuestions(suggestedQuestions);
  const welcome = String(welcomeMessage || '').trim();
  const chat = getChatModel();
  const name = String(botName || '').trim() || 'DialogosAI';

  let prompt;
  if (language === 'en') {
    prompt = [
      'Translate chatbot UI strings to natural modern English.',
      'Return ONLY valid JSON with this shape:',
      '{"welcomeMessage":"...","suggestedQuestions":["..."]}',
      '',
      'Rules:',
      `- Keep the bot name "${name}" unchanged if it appears.`,
      '- Do not use Greek letters. Output English only.',
      '- Keep the same number of suggested questions as the input.',
      '- Write concise, natural UI copy suitable for welcome text and suggestion chips.',
      '- Do not add markdown or commentary.',
      '',
      `Welcome message:\n${welcome || '(empty)'}`,
      '',
      `Suggested questions:\n${JSON.stringify(questions)}`,
    ].join('\n');
  } else {
    const article =
      personaGender === 'masculine' ? 'ο' : personaGender === 'feminine' ? 'η' : 'το';
    prompt = [
      'Translate chatbot UI strings to natural modern Greek (Ελληνικά).',
      'Return ONLY valid JSON with this shape:',
      '{"welcomeMessage":"...","suggestedQuestions":["..."]}',
      '',
      'Rules:',
      `- Keep the bot name "${name}" unchanged if it appears.`,
      `- Bot grammatical gender is ${personaGender}. When Greek needs an article before the bot name, ALWAYS use «${article} ${name}» (e.g. «τι κάνει ${article} ${name}», «είμαι ${article} ${name}»). Never use ο/η/το incorrectly.`,
      '- Keep the same number of suggested questions as the input.',
      '- Write concise, natural UI copy suitable for welcome text and suggestion chips.',
      '- Do not add markdown or commentary.',
      '',
      `Welcome message:\n${welcome || '(empty)'}`,
      '',
      `Suggested questions:\n${JSON.stringify(questions)}`,
    ].join('\n');
  }

  try {
    const response = await chat.generate({ prompt });
    const parsed = extractJsonObject(response);
    const rawCopy = {
      welcomeMessage: String(parsed.welcomeMessage || welcome).trim(),
      suggestedQuestions: normalizeSuggestedQuestions(parsed.suggestedQuestions).length
        ? normalizeSuggestedQuestions(parsed.suggestedQuestions)
        : questions,
    };
    const result =
      language === 'en'
        ? personalizeEnglishUiCopy(rawCopy, name)
        : personalizeUiCopy(rawCopy, name, personaGender);

    // Guard: if English request still came back Greek, fall back.
    if (language === 'en' && looksGreek(result.welcomeMessage)) {
      const fallback = englishFallbackUiCopy(name);
      cache.set(key, fallback);
      return fallback;
    }
    if (language === 'el' && !looksGreek(result.welcomeMessage) && welcome && !looksGreek(welcome)) {
      // translation failed oddly — keep trying personalized fallback
      const fallback = greekFallbackUiCopy(name, personaGender);
      cache.set(key, fallback);
      return fallback;
    }

    cache.set(key, result);
    return result;
  } catch (err) {
    if (language === 'en') return englishFallbackUiCopy(name);
    return greekFallbackUiCopy(name, personaGender);
  }
}
