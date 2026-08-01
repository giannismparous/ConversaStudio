#!/usr/bin/env node
/**
 * Quick sanity check before deploying online.
 * Run: npm run check:online
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.online.example');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

const env = { ...loadEnvFile(examplePath), ...loadEnvFile(envPath) };
const authMode = (env.AUTH_MODE || 'dev').toLowerCase();
const storageMode = (env.STORAGE_MODE || 'local').toLowerCase();
const isOnline = authMode === 'supabase';

const required = ['GEMINI_API_KEY'];
const onlineRequired = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CORS_ORIGIN',
  'PUBLIC_API_URL',
  'VITE_API_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
];

const webRequired = isOnline ? ['VITE_AUTH_MODE'] : [];

let ok = true;

function need(key) {
  const value = env[key];
  if (!value || value.includes('your_') || value.includes('replace_me')) {
    console.log(`✗ ${key} — missing or still placeholder`);
    ok = false;
    return;
  }
  console.log(`✓ ${key}`);
}

console.log(`\nDialogosAI online check (AUTH_MODE=${authMode}, STORAGE_MODE=${storageMode})\n`);

for (const key of required) need(key);

if (isOnline) {
  console.log('\nOnline auth / deploy:');
  for (const key of [...onlineRequired, ...webRequired]) need(key);

  if (env.DATABASE_URL?.startsWith('pglite:')) {
    console.log('✗ DATABASE_URL — use Supabase Postgres URL in production, not pglite');
    ok = false;
  } else if (env.DATABASE_URL) {
    console.log('✓ DATABASE_URL looks like managed Postgres');
  }

  if (env.VITE_AUTH_MODE !== 'supabase') {
    console.log('✗ VITE_AUTH_MODE — set to supabase for the deployed web app');
    ok = false;
  } else {
    console.log('✓ VITE_AUTH_MODE');
  }
} else {
  console.log('\nLocal dev mode — online vars optional.');
  console.log('Copy .env.online.example → .env when you are ready to deploy.');
}

console.log(ok ? '\nReady for online deploy.\n' : '\nFix the items above, then re-run npm run check:online\n');
process.exit(ok ? 0 : 1);
