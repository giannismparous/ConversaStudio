import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { env, initDb, closeDb, pool } from './config.js';
import { closeBrowser } from '@dialogos-forge/core';
import authRoutes from './routes/auth.js';
import botRoutes from './routes/bots.js';
import publicRoutes from './routes/public.js';

const app = Fastify({
  logger: true,
  bodyLimit: 25 * 1024 * 1024,
});

await initDb();

const corsOptions =
  env.authMode === 'dev'
    ? {
        origin: true,
        allowedHeaders: ['Content-Type', 'X-Dev-User', 'Authorization'],
      }
    : {
        origin: (origin, cb) => {
          const allowed = String(env.corsOrigin || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (!origin || allowed.includes(origin)) {
            cb(null, true);
            return;
          }
          cb(null, false);
        },
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization'],
      };

await app.register(cors, corsOptions);

await app.register(multipart, {
  limits: { fileSize: 25 * 1024 * 1024 },
});

if (env.storageMode === 'local') {
  await app.register(fastifyStatic, {
    root: env.uploadDir,
    prefix: '/files/',
    decorateReply: false,
  });
}

app.get('/health', async () => ({
  ok: true,
  authMode: env.authMode,
  storageMode: env.storageMode,
}));

app.get('/', async () => ({
  ok: true,
  service: 'conversastudio-api',
  health: '/health',
}));

await app.register(authRoutes);
await app.register(botRoutes);
await app.register(publicRoutes);

try {
  await pool.query('SELECT 1');
} catch (err) {
  app.log.error('Database not reachable.');
  app.log.error(err.message);
  process.exit(1);
}

await app.listen({ port: env.apiPort, host: env.apiHost });
console.log(`ConversaStudio API on http://localhost:${env.apiPort} (${env.authMode})`);

async function shutdown() {
  await closeBrowser().catch(() => {});
  await app.close().catch(() => {});
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
