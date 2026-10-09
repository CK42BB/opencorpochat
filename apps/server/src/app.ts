// SPDX-License-Identifier: AGPL-3.0-only
// Builds the Fastify application. Used by index.ts (production) and tests.
import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import { migrate, openDatabase } from './db/index.js';
import { HttpError } from './lib/errors.js';
import { buildOpenApi } from './openapi.js';
import { Hub } from './realtime/hub.js';
import { gatewayRoutes } from './realtime/gateway.js';
import { SettingsStore } from './modules/admin/settings.js';
import { createStorage } from './modules/files/storage.js';
import { resolveAuth } from './modules/auth/sessions.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { channelRoutes } from './modules/channels/routes.js';
import { memberIds } from './modules/channels/service.js';
import { messageRoutes } from './modules/messages/routes.js';
import { unfurlMessage } from './modules/messages/unfurl.js';
import { fileRoutes } from './modules/files/routes.js';
import { searchRoutes } from './modules/search/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { notifyForMessage } from './modules/notifications/service.js';
import { callRoutes, onConnectionClosed } from './modules/calls/routes.js';
import { integrationRoutes, runOutgoingWebhooks } from './modules/integrations/routes.js';
import { slashRoutes } from './modules/integrations/slash.js';
import { adminRoutes } from './modules/admin/routes.js';
import { directoryRoutes } from './modules/admin/directory.js';
import { schedulingRoutes } from './modules/scheduling/routes.js';
import { startScheduler } from './jobs/scheduler.js';
import { nowIso } from './lib/time.js';

export interface BuiltApp {
  app: FastifyInstance;
  ctx: Ctx;
  stop(): Promise<void>;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss: https:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export async function buildApp(config: Config, opts: { scheduler?: boolean; logger?: boolean } = {}): Promise<BuiltApp> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  });

  const handle = await openDatabase(config);
  await migrate(handle);
  const settings = new SettingsStore(handle.db, config.maxUploadMb);
  await settings.load();

  const ctx: Ctx = {
    config,
    handle,
    db: handle.db,
    dialect: handle.dialect,
    hub: null as unknown as Hub,
    storage: createStorage(config),
    settings,
    log: app.log,
    routeDocs: [],
    events: { onMessageCreated: [] },
  };
  ctx.hub = new Hub((channelId) => memberIds(ctx, channelId));
  ctx.hub.onPresenceChange = (userId, presence) => ctx.hub.broadcast('presence', { userId, presence });
  ctx.hub.onDisconnect = (conn) => onConnectionClosed(ctx, conn);
  // Initialise DND state for presence.
  const dnd = await ctx.db.selectFrom('users').select('id').where('dnd_until', '>', nowIso()).execute();
  for (const u of dnd) ctx.hub.dndUsers.add(u.id);

  ctx.events.onMessageCreated.push(
    (id) => notifyForMessage(ctx, id),
    (id) => unfurlMessage(ctx, id),
    (id) => runOutgoingWebhooks(ctx, id),
  );

  await app.register(cookie);
  await app.register(multipart);
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });

  app.decorateRequest('auth', null);

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', CSP);
    if (config.secureCookies) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (req.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'too_large', message: 'File is too large' });
    }
    return reply.code(status).send({
      error: status === 429 ? 'rate_limited' : status >= 500 ? 'internal' : 'bad_request',
      message: status >= 500 ? 'Something went wrong on the server' : e.message ?? 'Bad request',
    });
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await ctx.db.selectFrom('org_settings').select('key').limit(1).execute();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  await app.register(
    async (api) => {
      // Authenticate every API request, and enforce the CSRF header for cookie sessions.
      api.addHook('onRequest', async (req, reply) => {
        const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        const usesCookie = !req.headers.authorization && !!req.cookies?.ocpc_session;
        const isHook = req.url.startsWith('/api/v1/hooks/');
        if (unsafe && !isHook && usesCookie && req.headers['x-ocpc-csrf'] !== '1') {
          return reply.code(403).send({ error: 'csrf', message: 'Missing X-OCPC-CSRF header' });
        }
        if (!isHook) req.auth = await resolveAuth(ctx, req);
      });
      authRoutes(api, ctx);
      userRoutes(api, ctx);
      channelRoutes(api, ctx);
      messageRoutes(api, ctx);
      fileRoutes(api, ctx);
      searchRoutes(api, ctx);
      notificationRoutes(api, ctx);
      callRoutes(api, ctx);
      integrationRoutes(api, ctx);
      slashRoutes(api, ctx);
      adminRoutes(api, ctx);
      directoryRoutes(api, ctx);
      schedulingRoutes(api, ctx);
      gatewayRoutes(api, ctx);
      const spec = buildOpenApi(ctx.routeDocs, config.publicUrl);
      api.get('/openapi.json', async () => spec);
      api.all('/*', async (_req, reply) => reply.code(404).send({ error: 'not_found', message: 'Unknown API route' }));
    },
    { prefix: '/api/v1' },
  );

  // Serve the built web client (single-page app) if present.
  if (config.webDir && existsSync(path.join(config.webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      wildcard: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        reply.header('Cache-Control', 'no-cache');
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found', message: 'Not found' });
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/html')
        .send('<h1>OpenCorpoChat API is running</h1><p>The web client is not built. Run <code>pnpm build</code>, or use <code>pnpm dev</code> and open http://localhost:5173.</p>'),
    );
  }

  const stopScheduler = opts.scheduler === false ? () => {} : startScheduler(ctx);

  return {
    app,
    ctx,
    async stop() {
      stopScheduler();
      ctx.hub.closeAll();
      await app.close();
      await handle.close();
    },
  };
}
