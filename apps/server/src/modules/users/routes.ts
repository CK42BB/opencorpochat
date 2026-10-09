// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import {
  PreferencesInput,
  UpdateDndInput,
  UpdateProfileInput,
  UpdateStatusInput,
  type User,
} from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { route } from '../../lib/route.js';
import { myChannels } from '../channels/service.js';
import { listCustomEmoji, listGroups } from '../admin/directory.js';
import {
  canSeeUser,
  getUserRow,
  preferencesOf,
  publishUser,
  toMe,
  toUser,
  visibleUsers,
} from './service.js';
import { activeCalls } from '../calls/state.js';

export function userRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/bootstrap',
    summary:
      'Everything the client needs on startup: me, users, my channels, groups, emoji, settings, presence',
    tags: ['users'],
    handler: async ({ user }) => {
      const [users, channels, groups, emoji] = await Promise.all([
        visibleUsers(ctx, user),
        myChannels(ctx, user.id),
        listGroups(ctx),
        listCustomEmoji(ctx),
      ]);
      const unreadThreads = await ctx.db
        .selectFrom('thread_follows as f')
        .innerJoin('messages as m', 'm.id', 'f.root_id')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('f.user_id', '=', user.id)
        .where('f.following', '=', 1)
        .where((eb) =>
          eb.or([
            eb('f.last_read_at', 'is', null),
            eb('m.last_reply_at', '>', eb.ref('f.last_read_at')),
          ]),
        )
        .where('m.reply_count', '>', 0)
        .executeTakeFirst();
      const unreadNotifications = await ctx.db
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('user_id', '=', user.id)
        .where('read_at', 'is', null)
        .executeTakeFirst();
      const myChannelIds = new Set(channels.map((c) => c.id));
      return {
        me: toMe(user),
        users: users.map(toUser),
        channels,
        groups,
        emoji,
        settings: ctx.settings.public(),
        presence: ctx.hub.presenceMap(),
        calls: activeCalls().filter((c) => myChannelIds.has(c.channelId)),
        unreadThreads: Number(unreadThreads?.n ?? 0),
        unreadNotifications: Number(unreadNotifications?.n ?? 0),
      };
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/me',
    summary: 'The signed-in user',
    tags: ['users'],
    handler: ({ user }) => toMe(user),
  });

  route(app, ctx, {
    method: 'PATCH',
    url: '/me',
    summary: 'Update your profile',
    tags: ['users'],
    body: UpdateProfileInput,
    handler: async ({ body, user }) => {
      if (body.timezone) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: body.timezone });
        } catch {
          throw badRequest('Unknown time zone');
        }
      }
      if (body.avatarFileId) {
        const f = await ctx.db
          .selectFrom('files')
          .select(['uploader_id', 'mime'])
          .where('id', '=', body.avatarFileId)
          .executeTakeFirst();
        if (!f || f.uploader_id !== user.id || !f.mime.startsWith('image/'))
          throw badRequest('Invalid avatar image');
        await ctx.db
          .updateTable('files')
          .set({ purpose: 'avatar' })
          .where('id', '=', body.avatarFileId)
          .execute();
      }
      await ctx.db
        .updateTable('users')
        .set({
          display_name: body.displayName,
          full_name: body.fullName,
          title: body.title,
          pronouns: body.pronouns,
          timezone: body.timezone,
          phone: body.phone,
          avatar_file_id: body.avatarFileId,
        })
        .where('id', '=', user.id)
        .execute();
      return toMe(await publishUser(ctx, user.id));
    },
  });

  route(app, ctx, {
    method: 'PUT',
    url: '/me/status',
    summary: 'Set (or clear) your custom status',
    tags: ['users'],
    body: UpdateStatusInput,
    handler: async ({ body, user }) => {
      await ctx.db
        .updateTable('users')
        .set({
          status_emoji: body.emoji,
          status_text: body.text,
          status_expires_at: body.expiresAt,
        })
        .where('id', '=', user.id)
        .execute();
      return toMe(await publishUser(ctx, user.id));
    },
  });

  route(app, ctx, {
    method: 'PUT',
    url: '/me/dnd',
    summary: 'Pause notifications until a time (null to resume)',
    tags: ['users'],
    body: UpdateDndInput,
    handler: async ({ body, user }) => {
      await ctx.db
        .updateTable('users')
        .set({ dnd_until: body.until })
        .where('id', '=', user.id)
        .execute();
      return toMe(await publishUser(ctx, user.id));
    },
  });

  route(app, ctx, {
    method: 'PATCH',
    url: '/me/preferences',
    summary: 'Update your preferences (theme, notifications, sidebar sections...)',
    tags: ['users'],
    body: PreferencesInput,
    handler: async ({ body, user }) => {
      const prefs = { ...preferencesOf(user), ...body };
      await ctx.db
        .updateTable('users')
        .set({ preferences: JSON.stringify(prefs) })
        .where('id', '=', user.id)
        .execute();
      return toMe(await getUserRow(ctx, user.id));
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/users',
    summary: 'List people in the organization',
    tags: ['users'],
    handler: async ({ user }): Promise<User[]> => (await visibleUsers(ctx, user)).map(toUser),
  });

  route(app, ctx, {
    method: 'GET',
    url: '/users/:id',
    summary: 'Get a person by id',
    tags: ['users'],
    handler: async ({ user, params }) => {
      if (!(await canSeeUser(ctx, user, params.id!))) throw notFound('User');
      const row = await getUserRow(ctx, params.id!);
      return {
        ...toUser(row),
        presence: ctx.hub.presenceOf(row.id),
        email: user.role === 'guest' ? undefined : row.email,
        phone: row.phone,
      };
    },
  });
}
