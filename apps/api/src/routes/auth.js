import { pool } from '../config.js';
import { resolveDevUser } from '../services/auth.js';

export default async function authRoutes(fastify) {
  fastify.post('/auth/dev-login', async (request, reply) => {
    const username = String(request.body?.username || '')
      .trim()
      .toLowerCase();
    if (!username) {
      return reply.code(400).send({ error: 'username_required' });
    }
    request.headers['x-dev-user'] = username;
    await resolveDevUser(request, reply);
    if (reply.sent) return;
    return { user: request.user };
  });

  fastify.get('/auth/me', { preHandler: resolveDevUser }, async (request) => {
    return { user: request.user };
  });
}
