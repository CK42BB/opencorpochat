// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PushSubscriptionInput } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { ulid } from '../../lib/ids.js';
import { route } from '../../lib/route.js';
import { nowIso } from '../../lib/time.js';
import { toNotification } from './service.js';

export function notificationRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/notifications',
    summary: 'Your activity feed: mentions, DMs, thread replies, keywords, reminders',
    tags: ['notifications'],
    query: z.object({ before: z.string().max(64).optional(), unread: z.enum(['true', 'false']).optional() }),
    handler: async ({ user, query }) => {
      let q = ctx.db.selectFrom('notifications').selectAll().where('user_id', '=', user.id);
      if (query.before) q = q.where('id', '<', query.before);
      if (query.unread === 'true') q = q.where('read_at', 'is', null);
      const rows = await q.orderBy('id', 'desc').limit(50).execute();
      return rows.map(toNotification);
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/notifications/read',
    summary: 'Mark activity entries read (all, or specific ids)',
    tags: ['notifications'],
    body: z.object({ ids: z.array(z.string().max(64)).max(500).optional() }),
    handler: async ({ user, body }) => {
      let q = ctx.db.updateTable('notifications').set({ read_at: nowIso() }).where('user_id', '=', user.id).where('read_at', 'is', null);
      if (body.ids?.length) q = q.where('id', 'in', body.ids);
      await q.execute();
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/push/subscribe',
    summary: 'Register a Web Push subscription for this browser',
    tags: ['notifications'],
    body: PushSubscriptionInput,
    handler: async ({ user, body }) => {
      await ctx.db
        .insertInto('push_subscriptions')
        .values({ id: ulid(), user_id: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, created_at: nowIso() })
        .onConflict((oc) => oc.column('endpoint').doUpdateSet({ user_id: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth }))
        .execute();
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/push/unsubscribe',
    summary: 'Remove a Web Push subscription',
    tags: ['notifications'],
    body: z.object({ endpoint: z.string().max(2000) }),
    handler: async ({ user, body }) => {
      await ctx.db.deleteFrom('push_subscriptions').where('endpoint', '=', body.endpoint).where('user_id', '=', user.id).execute();
    },
  });
}
