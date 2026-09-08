import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { allowedOrigins, loadEnv } from './config/env';
import { loggerOptions } from './lib/logger';
import { prisma } from './lib/prisma';
import { redisHealthy } from './lib/redis';
import authPlugin from './plugins/auth';
import errorHandlerPlugin from './plugins/error-handler';
import authRoutes from './modules/auth';
import userRoutes from './modules/users';
import leadRoutes from './modules/leads';
import crmRoutes from './modules/crm';
import campaignRoutes from './modules/campaigns';
import marketRoutes from './modules/market';
import dashboardRoutes from './modules/dashboard';
import providerRoutes from './modules/providers';
import settingsRoutes from './modules/settings';
import serviceRoutes from './modules/services';
import notificationRoutes from './modules/notifications';
import adminRoutes from './modules/admin';
import { exportPipelineCsv } from './services/export-service';

/**
 * HTTP application assembly.
 *
 * Security defaults are applied globally: Helmet headers, a strict CORS allow-list, a
 * baseline rate limit, and a body size cap. Individual routes tighten the rate limit
 * further (login) where it matters.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: loggerOptions(),
    trustProxy: env.TRUST_PROXY,
    // Large CSV uploads arrive as JSON string bodies; 24 MB covers a very large sheet.
    bodyLimit: 24 * 1024 * 1024,
    genReqId: () => `req_${Math.random().toString(36).slice(2, 12)}`,
  });

  await app.register(sensible);
  await app.register(errorHandlerPlugin);

  await app.register(helmet, {
    // The API serves JSON only; the dashboard is a separate origin with its own policy.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin/server-to-server requests carry no Origin header.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins().includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Authenticated users are limited per account, anonymous callers per IP.
    keyGenerator: (req) => req.user?.id ?? req.ip,
    addHeadersOnExceeding: { 'x-ratelimit-remaining': true },
  });

  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(authPlugin);

  /* ------------------------------- Health -------------------------------- */
  app.get('/health', async () => {
    const [dbOk, redisOk] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      redisHealthy(),
    ]);
    return {
      status: dbOk ? 'ok' : 'degraded',
      database: dbOk ? 'up' : 'down',
      // Redis being down degrades queues and caching but the API still serves reads.
      redis: redisOk ? 'up' : 'down',
      version: '1.0.0',
      time: new Date().toISOString(),
    };
  });

  app.get('/', async () => ({
    name: 'Baimar Lead Intelligence API',
    version: '1.0.0',
    docs: '/health',
  }));

  /* ------------------------------- Routes -------------------------------- */
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(leadRoutes, { prefix: '/api/leads' });
  await app.register(crmRoutes, { prefix: '/api/crm' });
  await app.register(campaignRoutes, { prefix: '/api/campaigns' });
  await app.register(marketRoutes, { prefix: '/api/market' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(providerRoutes, { prefix: '/api/providers' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(serviceRoutes, { prefix: '/api/services' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  app.get('/api/exports/pipeline', { onRequest: [app.requirePermission('lead:export')] }, async (_req, reply) => {
    const csv = await exportPipelineCsv();
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="baimar-pipeline-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

  return app;
}
