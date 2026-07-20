import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  GeminiEmbedder,
  GeminiChatModel,
  FsObjectStore,
  SimpleUrlFetcher,
  PgVectorStore,
} from '@dialogos-forge/core';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/runMigrations.js';
import { recoverStaleBuildJobs } from './db/recoverStaleJobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

dotenv.config({ path: path.join(rootDir, '.env') });

export const env = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiEmbedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
  geminiChatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-flash-lite-latest',
  geminiEmbedDims: Number(process.env.GEMINI_EMBED_DIMS || 768),
  databaseUrl: process.env.DATABASE_URL || 'pglite:./data/pglite',
  apiPort: Number(process.env.API_PORT || 8787),
  apiHost: process.env.API_HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || 'data/uploads'),
  publicApiUrl: (process.env.PUBLIC_API_URL || 'http://localhost:8787').replace(
    /\/$/,
    ''
  ),
};

fs.mkdirSync(env.uploadDir, { recursive: true });

/** @type {import('pg').Pool | Awaited<ReturnType<typeof createPool>>} */
export let pool;

export const objectStore = new FsObjectStore({
  rootDir: env.uploadDir,
  publicBaseUrl: env.publicApiUrl,
});

export let vectorStore;
export const urlFetcher = new SimpleUrlFetcher();

export async function initDb() {
  pool = await createPool(env.databaseUrl);
  await runMigrations(pool, { log: (msg) => console.log(msg) });
  await recoverStaleBuildJobs(pool);
  vectorStore = new PgVectorStore({ pool });
  return pool;
}

export async function closeDb() {
  if (pool) {
    await pool.end?.();
    pool = null;
    vectorStore = null;
  }
}

export function getEmbedder() {
  return new GeminiEmbedder({
    apiKey: env.geminiApiKey,
    model: env.geminiEmbedModel,
    dimensions: env.geminiEmbedDims,
  });
}

export function getChatModel() {
  return new GeminiChatModel({
    apiKey: env.geminiApiKey,
    model: env.geminiChatModel,
  });
}
