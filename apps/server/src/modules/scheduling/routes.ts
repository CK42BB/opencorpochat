// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import { ReminderInput, ScheduleMessageInput, type Reminder, type ScheduledMessage } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { badRequest } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { route } from '../../lib/route.js';
import { nowIso } from '../../lib/time.js';
import { requireMember } from '../channels/service.js';
import { requireMessageAccess } from '../messages/routes.js';

export function schedulingRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/scheduled',
    summary: 'Your scheduled messages',
    tags: ['scheduling'],
    handler: async ({ user }): Promise<ScheduledMessage[]> => {
      const rows = await ctx.db.selectFrom('scheduled_messages').selectAll().where('user_id', '=', user.id).orderBy('send_at').execute();
      return rows.map((r) => ({ id: r.id, channelId: r.channel_id, threadRootId: r.thread_root_id, body: r.body, sendAt: r.send_at }));
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/scheduled',
    summary: 'Schedule a message to send later',
    tags: ['scheduling'],
    body: ScheduleMessageInput,
    handler: async ({ user, body }) => {
      await requireMember(ctx, user, body.channelId);
      if (Date.parse(body.sendAt) < Date.now() - 60_000) throw badRequest('Pick a time in the future');
      const row = { id: ulid(), user_id: user.id, channel_id: body.channelId, thread_root_id: body.threadRootId ?? null, body: body.body, send_at: new Date(body.sendAt).toISOString(), created_at: nowIso() };
      await ctx.db.insertInto('scheduled_messages').values(row).execute();
      return { id: row.id, channelId: row.channel_id, threadRootId: row.thread_root_id, body: row.body, sendAt: row.send_at };
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/scheduled/:id',
    summary: 'Cancel a scheduled message',
    tags: ['scheduling'],
    handler: async ({ user, params }) => {
      await ctx.db.deleteFrom('scheduled_messages').where('id', '=', params.id!).where('user_id', '=', user.id).execute();
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/reminders',
    summary: 'Your pending reminders',
    tags: ['scheduling'],
    handler: async ({ user }): Promise<Reminder[]> => {
      const rows = await ctx.db.selectFrom('reminders').selectAll().where('user_id', '=', user.id).orderBy('remind_at').execute();
      return rows.map((r) => ({ id: r.id, messageId: r.message_id, text: r.text, remindAt: r.remind_at }));
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/reminders',
    summary: 'Create a reminder (optionally about a message)',
    tags: ['scheduling'],
    body: ReminderInput,
    handler: async ({ user, body }) => {
      if (body.messageId) await requireMessageAccess(ctx, user, body.messageId);
      if (!body.messageId && !body.text) throw badRequest('What should I remind you about?');
      const row = { id: ulid(), user_id: user.id, message_id: body.messageId ?? null, text: body.text, remind_at: new Date(body.remindAt).toISOString(), created_at: nowIso() };
      await ctx.db.insertInto('reminders').values(row).execute();
      return { id: row.id, messageId: row.message_id, text: row.text, remindAt: row.remind_at };
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/reminders/:id',
    summary: 'Delete a reminder',
    tags: ['scheduling'],
    handler: async ({ user, params }) => {
      await ctx.db.deleteFrom('reminders').where('id', '=', params.id!).where('user_id', '=', user.id).execute();
    },
  });
}
