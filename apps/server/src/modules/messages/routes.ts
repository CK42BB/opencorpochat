// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  canDeleteMessage,
  canEditMessage,
  canPostInChannel,
  EditMessageInput,
  ForwardMessageInput,
  PostMessageInput,
  ReactionInput,
  VoteInput,
  type Actor,
  type Message,
} from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import type { MessagesTable, UsersTable } from '../../db/schema.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { route } from '../../lib/route.js';
import { nowIso } from '../../lib/time.js';
import { audit } from '../admin/audit.js';
import { requireChannelAccess, requireMember, toMembership } from '../channels/service.js';
import {
  createMessage,
  deleteMessage,
  editMessage,
  getMessageRow,
  hydrate,
  hydrateOne,
  publishMessage,
  reactionSummary,
} from './service.js';

const actorOf = (u: UsersTable): Actor => ({ id: u.id, role: u.role as Actor['role'] });

/** Load a message and verify the user can see its channel. */
export async function requireMessageAccess(ctx: Ctx, user: UsersTable, messageId: string) {
  const msg = await getMessageRow(ctx, messageId);
  const { channel, membership } = await requireChannelAccess(ctx, user, msg.channel_id);
  return { msg, channel, membership };
}

export function messageRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/channels/:id/messages',
    summary: 'List messages in a channel (newest first). Use before/after/around for paging.',
    tags: ['messages'],
    query: z.object({
      before: z.string().max(64).optional(),
      after: z.string().max(64).optional(),
      around: z.string().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    handler: async ({ user, params, query }) => {
      await requireChannelAccess(ctx, user, params.id!);
      const base = () =>
        ctx.db
          .selectFrom('messages')
          .selectAll()
          .where('channel_id', '=', params.id!)
          .where((eb) => eb.or([eb('thread_root_id', 'is', null), eb('also_in_channel', '=', 1)]));
      let rows: MessagesTable[];
      let hasMoreBefore = false;
      let hasMoreAfter = false;
      if (query.around) {
        const half = Math.ceil(query.limit / 2);
        const older = await base()
          .where('id', '<', query.around)
          .orderBy('id', 'desc')
          .limit(half + 1)
          .execute();
        const newer = await base()
          .where('id', '>=', query.around)
          .orderBy('id', 'asc')
          .limit(half + 1)
          .execute();
        hasMoreBefore = older.length > half;
        hasMoreAfter = newer.length > half;
        rows = [...older.slice(0, half).reverse(), ...newer.slice(0, half)];
      } else if (query.after) {
        const r = await base()
          .where('id', '>', query.after)
          .orderBy('id', 'asc')
          .limit(query.limit + 1)
          .execute();
        hasMoreAfter = r.length > query.limit;
        rows = r.slice(0, query.limit);
        hasMoreBefore = true;
      } else {
        let q = base();
        if (query.before) q = q.where('id', '<', query.before);
        const r = await q
          .orderBy('id', 'desc')
          .limit(query.limit + 1)
          .execute();
        hasMoreBefore = r.length > query.limit;
        rows = r.slice(0, query.limit).reverse();
        hasMoreAfter = !!query.before;
      }
      return { messages: await hydrate(ctx, rows, user.id), hasMoreBefore, hasMoreAfter };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/messages',
    summary: 'Post a message (optionally as a thread reply, with files or a poll)',
    tags: ['messages'],
    body: PostMessageInput,
    rateLimit: { max: 60, timeWindow: '1 minute' },
    handler: async ({ user, params, body }): Promise<Message> => {
      const { channel, membership } = await requireMember(ctx, user, params.id!);
      if (
        !canPostInChannel(
          actorOf(user),
          {
            kind: channel.kind as never,
            archived: !!channel.archived_at,
            isReadonly: !!channel.is_readonly,
          },
          toMembership(membership),
        )
      ) {
        // Anyone may still reply in threads of announcement channels.
        if (!(channel.is_readonly && body.threadRootId && !channel.archived_at))
          throw forbidden('You cannot post in this channel');
      }
      const row = await createMessage(ctx, {
        channel,
        userId: user.id,
        body: body.body,
        kind: user.role === 'bot' ? 'bot' : 'user',
        threadRootId: body.threadRootId ?? null,
        alsoInChannel: body.alsoInChannel,
        fileIds: body.fileIds,
        poll: body.poll
          ? {
              question: body.poll.question,
              options: body.poll.options,
              multiple: body.poll.multiple,
              anonymous: body.poll.anonymous,
            }
          : undefined,
      });
      return hydrateOne(ctx, row, user.id);
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/messages/:id',
    summary: 'Get a single message',
    tags: ['messages'],
    handler: async ({ user, params }) => {
      const { msg } = await requireMessageAccess(ctx, user, params.id!);
      return hydrateOne(ctx, msg, user.id);
    },
  });

  route(app, ctx, {
    method: 'PATCH',
    url: '/messages/:id',
    summary: 'Edit your message',
    tags: ['messages'],
    body: EditMessageInput,
    handler: async ({ user, params, body }) => {
      const { msg } = await requireMessageAccess(ctx, user, params.id!);
      if (msg.deleted_at || msg.kind === 'system')
        throw badRequest('This message cannot be edited');
      if (
        !canEditMessage(
          actorOf(user),
          { userId: msg.user_id, createdAt: msg.created_at },
          ctx.settings.get().messageEditWindowMinutes,
        )
      )
        throw forbidden('You can no longer edit this message');
      return hydrateOne(ctx, await editMessage(ctx, msg, body.body), user.id);
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/messages/:id',
    summary: 'Delete a message',
    tags: ['messages'],
    handler: async ({ user, params, ip }) => {
      const { msg, membership } = await requireMessageAccess(ctx, user, params.id!);
      if (msg.deleted_at) return;
      if (
        !canDeleteMessage(
          actorOf(user),
          { userId: msg.user_id },
          membership ? toMembership(membership) : null,
        )
      )
        throw forbidden();
      await deleteMessage(ctx, msg);
      if (msg.user_id !== user.id) {
        await audit(ctx, {
          actorId: user.id,
          action: 'message.deleted_by_admin',
          targetType: 'message',
          targetId: msg.id,
          ip,
          metadata: { channelId: msg.channel_id, authorId: msg.user_id },
        });
      }
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/messages/:id/thread',
    summary: 'Get a thread: the root message and all replies',
    tags: ['messages'],
    handler: async ({ user, params }) => {
      const { msg } = await requireMessageAccess(ctx, user, params.id!);
      const root = msg.thread_root_id ? await getMessageRow(ctx, msg.thread_root_id) : msg;
      const replies = await ctx.db
        .selectFrom('messages')
        .selectAll()
        .where('thread_root_id', '=', root.id)
        .orderBy('id')
        .limit(1000)
        .execute();
      const follow = await ctx.db
        .selectFrom('thread_follows')
        .select('following')
        .where('root_id', '=', root.id)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      const [rootMsg, ...rest] = await hydrate(ctx, [root, ...replies], user.id);
      return { root: rootMsg, replies: rest, following: follow ? follow.following === 1 : false };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/messages/:id/reactions',
    summary: 'Add an emoji reaction',
    tags: ['messages'],
    body: ReactionInput,
    handler: async ({ user, params, body }) => {
      const { msg, membership } = await requireMessageAccess(ctx, user, params.id!);
      if (!membership) throw forbidden('Join the channel first');
      if (msg.deleted_at) throw badRequest('Message was deleted');
      const distinct = await ctx.db
        .selectFrom('reactions')
        .select('emoji')
        .distinct()
        .where('message_id', '=', msg.id)
        .execute();
      if (distinct.length >= 50 && !distinct.some((d) => d.emoji === body.emoji))
        throw badRequest('Too many different reactions');
      await ctx.db
        .insertInto('reactions')
        .values({ message_id: msg.id, user_id: user.id, emoji: body.emoji, created_at: nowIso() })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const reactions = await reactionSummary(ctx, msg.id);
      await ctx.hub.sendToChannel(msg.channel_id, 'reaction.updated', {
        messageId: msg.id,
        channelId: msg.channel_id,
        reactions,
      });
      return reactions;
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/messages/:id/reactions/:emoji',
    summary: 'Remove your emoji reaction',
    tags: ['messages'],
    handler: async ({ user, params }) => {
      const { msg } = await requireMessageAccess(ctx, user, params.id!);
      await ctx.db
        .deleteFrom('reactions')
        .where('message_id', '=', msg.id)
        .where('user_id', '=', user.id)
        .where('emoji', '=', decodeURIComponent(params.emoji!))
        .execute();
      const reactions = await reactionSummary(ctx, msg.id);
      await ctx.hub.sendToChannel(msg.channel_id, 'reaction.updated', {
        messageId: msg.id,
        channelId: msg.channel_id,
        reactions,
      });
      return reactions;
    },
  });

  // ----- Pins -----
  route(app, ctx, {
    method: 'GET',
    url: '/channels/:id/pins',
    summary: 'List pinned messages in a channel',
    tags: ['messages'],
    handler: async ({ user, params }) => {
      await requireChannelAccess(ctx, user, params.id!);
      const rows = await ctx.db
        .selectFrom('pins as p')
        .innerJoin('messages as m', 'm.id', 'p.message_id')
        .selectAll('m')
        .where('p.channel_id', '=', params.id!)
        .orderBy('p.created_at', 'desc')
        .execute();
      return hydrate(ctx, rows, user.id);
    },
  });

  for (const method of ['POST', 'DELETE'] as const) {
    route(app, ctx, {
      method,
      url: '/messages/:id/pin',
      summary: method === 'POST' ? 'Pin a message to its channel' : 'Unpin a message',
      tags: ['messages'],
      handler: async ({ user, params }) => {
        const { msg, membership, channel } = await requireMessageAccess(ctx, user, params.id!);
        if (!membership) throw forbidden('Join the channel first');
        if (msg.deleted_at) throw badRequest('Message was deleted');
        if (method === 'POST') {
          await ctx.db
            .insertInto('pins')
            .values({
              channel_id: msg.channel_id,
              message_id: msg.id,
              pinned_by: user.id,
              created_at: nowIso(),
            })
            .onConflict((oc) => oc.doNothing())
            .execute();
          await createMessage(ctx, {
            channel,
            userId: user.id,
            kind: 'system',
            body: `@${user.username} pinned a message`,
            skipNotify: true,
          });
        } else {
          await ctx.db.deleteFrom('pins').where('message_id', '=', msg.id).execute();
        }
        await ctx.hub.sendToChannel(msg.channel_id, 'pin.updated', {
          channelId: msg.channel_id,
          messageId: msg.id,
          pinned: method === 'POST',
        });
      },
    });
  }

  // ----- Saved items -----
  route(app, ctx, {
    method: 'GET',
    url: '/saved',
    summary: 'List your saved messages',
    tags: ['messages'],
    handler: async ({ user }) => {
      const rows = await ctx.db
        .selectFrom('saved_items as s')
        .innerJoin('messages as m', 'm.id', 's.message_id')
        .innerJoin('channel_members as cm', (j) =>
          j.onRef('cm.channel_id', '=', 'm.channel_id').on('cm.user_id', '=', user.id),
        )
        .selectAll('m')
        .where('s.user_id', '=', user.id)
        .orderBy('s.created_at', 'desc')
        .limit(500)
        .execute();
      return hydrate(ctx, rows, user.id);
    },
  });

  for (const method of ['POST', 'DELETE'] as const) {
    route(app, ctx, {
      method,
      url: '/messages/:id/save',
      summary: method === 'POST' ? 'Save a message for later' : 'Remove from saved',
      tags: ['messages'],
      handler: async ({ user, params }) => {
        const { msg } = await requireMessageAccess(ctx, user, params.id!);
        if (method === 'POST') {
          await ctx.db
            .insertInto('saved_items')
            .values({ user_id: user.id, message_id: msg.id, created_at: nowIso() })
            .onConflict((oc) => oc.doNothing())
            .execute();
        } else {
          await ctx.db
            .deleteFrom('saved_items')
            .where('user_id', '=', user.id)
            .where('message_id', '=', msg.id)
            .execute();
        }
        ctx.hub.sendToUsers([user.id], 'saved.updated', {
          messageId: msg.id,
          saved: method === 'POST',
        });
      },
    });
  }

  // ----- Forward -----
  route(app, ctx, {
    method: 'POST',
    url: '/messages/:id/forward',
    summary: 'Share a message into another channel or DM',
    tags: ['messages'],
    body: ForwardMessageInput,
    handler: async ({ user, params, body }) => {
      const { msg } = await requireMessageAccess(ctx, user, params.id!);
      if (msg.deleted_at) throw badRequest('Message was deleted');
      const { channel, membership } = await requireMember(ctx, user, body.channelId);
      if (
        !canPostInChannel(
          actorOf(user),
          {
            kind: channel.kind as never,
            archived: !!channel.archived_at,
            isReadonly: !!channel.is_readonly,
          },
          toMembership(membership),
        )
      )
        throw forbidden();
      const row = await createMessage(ctx, {
        channel,
        userId: user.id,
        body: body.comment,
        forwardedFrom: { messageId: msg.id, channelId: msg.channel_id, userId: msg.user_id },
      });
      return hydrateOne(ctx, row, user.id);
    },
  });

  // ----- Polls -----
  route(app, ctx, {
    method: 'POST',
    url: '/messages/:id/vote',
    summary: 'Vote in a poll (replaces your previous vote)',
    tags: ['messages'],
    body: VoteInput,
    handler: async ({ user, params, body }) => {
      const { msg, membership } = await requireMessageAccess(ctx, user, params.id!);
      if (!membership) throw forbidden('Join the channel first');
      const poll = json<{ options: { id: string }[]; multiple: boolean; closed: boolean } | null>(
        msg.poll,
        null,
      );
      if (!poll || msg.deleted_at) throw notFound('Poll');
      if (poll.closed) throw badRequest('This poll is closed');
      const valid = new Set(poll.options.map((o) => o.id));
      const choices = [...new Set(body.optionIds)].filter((o) => valid.has(o));
      if (!poll.multiple && choices.length > 1) throw badRequest('Choose one option');
      await ctx.db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('poll_votes')
          .where('message_id', '=', msg.id)
          .where('user_id', '=', user.id)
          .execute();
        if (choices.length) {
          await trx
            .insertInto('poll_votes')
            .values(choices.map((o) => ({ message_id: msg.id, option_id: o, user_id: user.id })))
            .execute();
        }
      });
      await publishMessage(ctx, msg, 'message.updated');
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/messages/:id/close-poll',
    summary: 'Close a poll you created',
    tags: ['messages'],
    handler: async ({ user, params }) => {
      const { msg } = await requireMessageAccess(ctx, user, params.id!);
      if (msg.user_id !== user.id) throw forbidden();
      const poll = json<Record<string, unknown> | null>(msg.poll, null);
      if (!poll) throw notFound('Poll');
      await ctx.db
        .updateTable('messages')
        .set({ poll: JSON.stringify({ ...poll, closed: true }) })
        .where('id', '=', msg.id)
        .execute();
      await publishMessage(ctx, await getMessageRow(ctx, msg.id), 'message.updated');
    },
  });

  // ----- Threads -----
  route(app, ctx, {
    method: 'GET',
    url: '/threads',
    summary: 'Threads you follow, most recently active first',
    tags: ['messages'],
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      before: z.string().max(64).optional(),
    }),
    handler: async ({ user, query }) => {
      let q = ctx.db
        .selectFrom('thread_follows as f')
        .innerJoin('messages as m', 'm.id', 'f.root_id')
        .innerJoin('channel_members as cm', (j) =>
          j.onRef('cm.channel_id', '=', 'm.channel_id').on('cm.user_id', '=', user.id),
        )
        .selectAll('m')
        .select(['f.last_read_at'])
        .where('f.user_id', '=', user.id)
        .where('f.following', '=', 1)
        .where('m.reply_count', '>', 0);
      if (query.before) q = q.where('m.last_reply_at', '<', query.before);
      const rows = await q.orderBy('m.last_reply_at', 'desc').limit(query.limit).execute();
      const roots = await hydrate(ctx, rows, user.id);
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const latest = await ctx.db
          .selectFrom('messages')
          .selectAll()
          .where('thread_root_id', '=', r.id)
          .where('deleted_at', 'is', null)
          .orderBy('id', 'desc')
          .limit(3)
          .execute();
        out.push({
          root: roots[i],
          latestReplies: await hydrate(ctx, latest.reverse(), user.id),
          unread: !r.last_read_at || (r.last_reply_at ?? '') > r.last_read_at,
        });
      }
      return out;
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/threads/:id/read',
    summary: 'Mark a thread read',
    tags: ['messages'],
    handler: async ({ user, params }) => {
      const { msg } = await requireMessageAccess(ctx, user, params.id!);
      await ctx.db
        .updateTable('thread_follows')
        .set({ last_read_at: nowIso() })
        .where('root_id', '=', msg.id)
        .where('user_id', '=', user.id)
        .execute();
      await ctx.db
        .updateTable('notifications')
        .set({ read_at: nowIso() })
        .where('user_id', '=', user.id)
        .where('kind', '=', 'thread_reply')
        .where('read_at', 'is', null)
        .where('message_id', 'in', (eb) =>
          eb.selectFrom('messages').select('id').where('thread_root_id', '=', msg.id),
        )
        .execute();
      ctx.hub.sendToUsers([user.id], 'thread.updated', {
        rootId: msg.id,
        channelId: msg.channel_id,
        unread: false,
      });
    },
  });

  for (const method of ['POST', 'DELETE'] as const) {
    route(app, ctx, {
      method,
      url: '/threads/:id/follow',
      summary: method === 'POST' ? 'Follow a thread' : 'Stop following a thread',
      tags: ['messages'],
      handler: async ({ user, params }) => {
        const { msg } = await requireMessageAccess(ctx, user, params.id!);
        const following = method === 'POST' ? 1 : 0;
        await ctx.db
          .insertInto('thread_follows')
          .values({ root_id: msg.id, user_id: user.id, last_read_at: nowIso(), following })
          .onConflict((oc) => oc.columns(['root_id', 'user_id']).doUpdateSet({ following }))
          .execute();
      },
    });
  }
}
