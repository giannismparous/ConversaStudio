import { pool } from '../config.js';

export async function resolveDevUser(request, reply) {
  const username = String(request.headers['x-dev-user'] || '')
    .trim()
    .toLowerCase();
  if (!username || username.length < 2) {
    return reply.code(401).send({ error: 'missing_user', message: 'Set X-Dev-User header' });
  }
  if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
    return reply.code(400).send({
      error: 'invalid_username',
      message: 'Username must be 2–32 chars: a-z, 0-9, _ or -',
    });
  }

  const { rows } = await pool.query(
    `INSERT INTO users (username) VALUES ($1)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, username, created_at`,
    [username]
  );
  request.user = rows[0];
}

export async function requireBotOwner(request, reply, botId) {
  const { rows } = await pool.query('SELECT * FROM bots WHERE id = $1', [botId]);
  const bot = rows[0];
  if (!bot) {
    reply.code(404).send({ error: 'not_found', message: 'Bot not found' });
    return null;
  }
  if (bot.owner_id !== request.user.id) {
    reply.code(403).send({ error: 'forbidden', message: 'Not your bot' });
    return null;
  }
  return bot;
}

export function mapBot(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    theme: row.theme,
    iconUrl: row.icon_url,
    systemPrompt: row.system_prompt,
    welcomeMessage: row.welcome_message,
    suggestedQuestions: (() => {
      const value = row.suggested_questions;
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
    })(),
    rules: (() => {
      const r = row.rules;
      if (Array.isArray(r)) return r;
      if (typeof r === 'string') {
        try {
          const parsed = JSON.parse(r);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })(),
    keyFacts: (() => {
      const f = row.key_facts;
      if (Array.isArray(f)) return f;
      if (typeof f === 'string') {
        try {
          const parsed = JSON.parse(f);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })(),
    personaGender: row.persona_gender || 'neutral',
    sourceCitations: (() => {
      const value = row.source_citations;
      if (value && typeof value === 'object') return value;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return { showSources: true, hideTypes: ['key_facts'] };
        }
      }
      return { showSources: true, hideTypes: ['key_facts'] };
    })(),
    buildError: row.build_error,
    lastBuiltAt: row.last_built_at,
    chunkCount: row.chunk_count,
    sourceCount:
      row.source_count !== undefined && row.source_count !== null
        ? Number(row.source_count)
        : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSource(row) {
  return {
    id: row.id,
    botId: row.bot_id,
    type: row.type,
    label: row.label,
    uri: row.uri,
    contentHash: row.content_hash,
    status: row.status,
    byteSize: row.byte_size,
    errorMessage: row.error_message,
    scrapeMode: row.scrape_mode || 'page',
    showInCitations: row.show_in_citations !== false,
    chunkCount: row.chunk_count || 0,
    createdAt: row.created_at,
  };
}

export function mapJob(row) {
  return {
    id: row.id,
    botId: row.bot_id,
    mode: row.mode,
    status: row.status,
    progress: row.progress,
    message: row.message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}
