import {
  buildRagPrompt,
  formatKeyFacts,
  resolveReplyLanguage,
} from '@dialogos-forge/core';
import { pool, vectorStore, getEmbedder, getChatModel, objectStore, env } from '../config.js';
import { buildChatSources } from './sourceCitations.js';

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function answerBotChat(botId, question, { history = [] } = {}) {
  const q = String(question || '').trim();
  if (!q) {
    return { answer: 'Type a question to get started.', sources: [], confidence: 0 };
  }

  const { rows } = await pool.query('SELECT * FROM bots WHERE id = $1', [botId]);
  const bot = rows[0];
  if (!bot) {
    const err = new Error('Bot not found');
    err.statusCode = 404;
    throw err;
  }

  const keyFacts = parseJsonArray(bot.key_facts);
  const hasKeyFacts = Boolean(formatKeyFacts(keyFacts));

  if (bot.status !== 'ready' && !hasKeyFacts) {
    return {
      answer:
        bot.status === 'building'
          ? 'This bot is still building its knowledge index. Try again in a moment.'
          : 'This bot has no ready index yet. Open the editor and press Build first.',
      sources: [],
      confidence: 0,
    };
  }

  let hits = [];
  if (bot.status === 'ready') {
    const embedder = getEmbedder();
    const queryEmbedding = await embedder.embedQuery(q);
    hits = await vectorStore.similaritySearch(botId, queryEmbedding, 6);
    if (hits[0] && (hits[0].score ?? 0) < 0.25) {
      hits = [];
    }
  }

  if (!hits.length && !hasKeyFacts) {
    return {
      answer:
        'I do not have enough information in the uploaded documents to answer that.',
      sources: [],
      confidence: 0,
    };
  }

  const ragContext = hits.length
    ? hits
        .map(
          (h, i) =>
            `[#${i + 1} ${h.label || 'source'} | score=${h.score.toFixed(3)}]\n${h.content}`
        )
        .join('\n\n')
    : '(no retrieved documents)';

  const historyLines = (history || [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  // Reply language follows the user's message (Greek / Greeklish → el, English → en).
  // Do not let UI locale force English answers to Greek/Greeklish messages.
  const replyLanguage = resolveReplyLanguage(q);

  const prompt = buildRagPrompt({
    systemPrompt: bot.system_prompt,
    rules: parseJsonArray(bot.rules),
    keyFacts,
    botName: bot.name,
    personaGender: bot.persona_gender || 'neutral',
    welcomeMessage: bot.welcome_message || '',
    language: replyLanguage,
    context: `${historyLines ? `Recent conversation:\n${historyLines}\n\n` : ''}${ragContext}`,
    question: q,
  });

  const chat = getChatModel();
  const answer = await chat.generate({ prompt });

  const sources = buildChatSources({
    hits,
    hasKeyFacts,
    sourceCitations: bot.source_citations,
    publicApiUrl: env.publicApiUrl,
    objectStore,
  });

  const top = hits[0]?.score ?? (hasKeyFacts ? 0.9 : 0);
  return {
    answer: answer || 'I could not generate an answer.',
    sources,
    confidence: top > 0.8 ? 0.95 : top > 0.5 ? 0.8 : hasKeyFacts ? 0.85 : 0.6,
  };
}
