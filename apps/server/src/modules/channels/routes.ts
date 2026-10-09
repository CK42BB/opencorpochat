// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AddMembersInput,
  canAddMembers,
  canJoinChannel,
  canManageChannel,
  CreateChannelInput,
  isAdmin,
  MarkReadInput,
  OpenDmInput,
  UpdateChannelInput,
  UpdateMembershipInput,
  type Actor,
  type Channel,
} from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { route } from '../../lib/route.js';
import { nowIso } from '../../lib/time.js';
import { audit } from '../admin/audit.js';
import { createMessage } from '../messages/service.js';
import { toUser } from '../users/service.js';
import {
  addMembers,
  channelView,
  createChannel,
  getMembershipRow,
  markRead,
  myChannel,
  openDm,
  removeMember,
  requireChannelAccess,
  requireMember,
  toChannel,
  toMembership,
} from './service.js';
import type { UsersTable } from '../../db/schema.js';

const actorOf = (u: UsersTable): Actor => ({ id: u.id, role: u.role as Actor['role'] });

export function channelRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/channels',
    summary: 'Browse the channel directory (public channels, plus private ones you belong to)',
    tags: ['channels'],
    query: z.object({ q: z.string().max(80).optional(), archived: z.enum(['true', 'false']).optional() }),
    handler: async ({ user, query }): Promise<Channel[]> => {
      if (user.role === 'guest') return [];
      let q = ctx.db
        .selectFrom('channels as c')
        .selectAll('c')
        .select((eb) =>
          eb.selectFrom('channel_members as cm').select(eb.fn.countAll<number>().as('n')).whereRef('cm.channel_id', '=', 'c.id').as('member_count'),
        )
        .where((eb) =>
          eb.or([
            eb('c.kind', '=', 'public'),
            eb.and([
              eb('c.kind', '=', 'private'),
              eb.exists(eb.selectFrom('channel_members as m').select('m.user_id').whereRef('m.channel_id', '=', 'c.id').where('m.user_id', '=', user.id)),
            ]),
          ]),
        );
      q = query.archived === 'true' ? q.where('c.archived_at', 'is not', null) : q.where('c.archived_at', 'is', null);
      if (query.q) q = q.where('c.name', 'like', `%${query.q.toLowerCase().replace(/[%_]/g, '')}%`);
      const rows = await q.orderBy('c.name').limit(500).execute();
      return rows.map((r) => toChannel(r, Number(r.member_count ?? 0)));
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels',
    summary: 'Create a channel',
    tags: ['channels'],
    auth: 'member',
    body: CreateChannelInput,
    handler: async ({ body, user, ip }) => {
      if (body.isReadonly && !isAdmin(actorOf(user))) throw forbidden('Only admins can create announcement channels');
      const row = await createChannel(ctx, { ...body, createdBy: user.id });
      await audit(ctx, { actorId: user.id, action: 'channel.created', targetType: 'channel', targetId: row.id, ip, metadata: { name: row.name, kind: row.kind } });
      return myChannel(ctx, user.id, row.id);
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/dms',
    summary: 'Open (or find) a direct message with one or more people',
    tags: ['channels'],
    body: OpenDmInput,
    handler: async ({ body, user }) => {
      if (user.role === 'guest') {
        // Guests may only DM people they share a channel with.
        for (const id of body.userIds) {
          const shared = await ctx.db
            .selectFrom('channel_members as a')
            .innerJoin('channel_members as b', 'a.channel_id', 'b.channel_id')
            .select('a.channel_id')
            .where('a.user_id', '=', user.id)
            .where('b.user_id', '=', id)
            .executeTakeFirst();
          if (!shared) throw notFound('User');
        }
      }
      const row = await openDm(ctx, user, body.userIds);
      return myChannel(ctx, user.id, row.id);
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/channels/:id',
    summary: 'Get a channel',
    tags: ['channels'],
    handler: async ({ user, params }) => {
      const { channel, membership } = await requireChannelAccess(ctx, user, params.id!);
      return { ...(await channelView(ctx, channel)), membership: membership ? toMembership(membership) : null };
    },
  });

  route(app, ctx, {
    method: 'PATCH',
    url: '/channels/:id',
    summary: 'Update channel name, topic, description or settings',
    tags: ['channels'],
    body: UpdateChannelInput,
    handler: async ({ body, user, params, ip }) => {
      const { channel, membership } = await requireChannelAccess(ctx, user, params.id!);
      const actor = actorOf(user);
      const onlyTopic = Object.keys(body).every((k) => k === 'topic');
      // Any member may change the topic; other settings need channel-manager rights.
      if (!(onlyTopic && membership) && !canManageChannel(actor, { kind: channel.kind as never, createdBy: channel.created_by }, membership ? toMembership(membership) : null)) {
        throw forbidden();
      }
      if ((body.isDefault !== undefined || body.isReadonly !== undefined) && !isAdmin(actor)) throw forbidden('Admins only');
      if (channel.kind === 'dm' || channel.kind === 'group_dm') throw forbidden();
      if (body.name && body.name !== channel.name) {
        const taken = await ctx.db.selectFrom('channels').select('id').where('name', '=', body.name).where('kind', 'in', ['public', 'private']).executeTakeFirst();
        if (taken) throw conflict(`A channel named #${body.name} already exists`);
      }
      await ctx.db
        .updateTable('channels')
        .set({
          name: body.name,
          topic: body.topic,
          description: body.description,
          is_readonly: body.isReadonly === undefined ? undefined : body.isReadonly ? 1 : 0,
          is_default: body.isDefault === undefined ? undefined : body.isDefault ? 1 : 0,
          kind: body.kind,
        })
        .where('id', '=', channel.id)
        .execute();
      const updated = await ctx.db.selectFrom('channels').selectAll().where('id', '=', channel.id).executeTakeFirstOrThrow();
      const view = await channelView(ctx, updated);
      await ctx.hub.sendToChannel(channel.id, 'channel.updated', { channel: view });
      if (body.topic !== undefined && body.topic !== channel.topic) {
        await createMessage(ctx, { channel: updated, userId: user.id, kind: 'system', body: body.topic ? `@${user.username} set the topic: ${body.topic}` : `@${user.username} cleared the topic`, skipNotify: true });
      }
      if (body.name && body.name !== channel.name) {
        await createMessage(ctx, { channel: updated, userId: user.id, kind: 'system', body: `@${user.username} renamed the channel from #${channel.name} to #${body.name}`, skipNotify: true });
      }
      await audit(ctx, { actorId: user.id, action: 'channel.updated', targetType: 'channel', targetId: channel.id, ip, metadata: body });
      return view;
    },
  });

  for (const action of ['archive', 'unarchive'] as const) {
    route(app, ctx, {
      method: 'POST',
      url: `/channels/:id/${action}`,
      summary: action === 'archive' ? 'Archive a channel (read-only, hidden from directory)' : 'Unarchive a channel',
      tags: ['channels'],
      handler: async ({ user, params, ip }) => {
        const { channel, membership } = await requireChannelAccess(ctx, user, params.id!);
        if (!canManageChannel(actorOf(user), { kind: channel.kind as never, createdBy: channel.created_by }, membership ? toMembership(membership) : null)) throw forbidden();
        if (channel.is_default && action === 'archive') throw forbidden('Remove this channel from the defaults before archiving it');
        await ctx.db.updateTable('channels').set({ archived_at: action === 'archive' ? nowIso() : null }).where('id', '=', channel.id).execute();
        const updated = await ctx.db.selectFrom('channels').selectAll().where('id', '=', channel.id).executeTakeFirstOrThrow();
        await createMessage(ctx, { channel: { ...updated, archived_at: null }, userId: user.id, kind: 'system', body: `@${user.username} ${action}d this channel`, skipNotify: true });
        await ctx.hub.sendToChannel(channel.id, 'channel.updated', { channel: await channelView(ctx, updated) });
        await audit(ctx, { actorId: user.id, action: `channel.${action}d`, targetType: 'channel', targetId: channel.id, ip });
      },
    });
  }

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/join',
    summary: 'Join a public channel',
    tags: ['channels'],
    handler: async ({ user, params }) => {
      const { channel, membership } = await requireChannelAccess(ctx, user, params.id!);
      if (!membership) {
        if (!canJoinChannel(actorOf(user), { kind: channel.kind as never, archived: !!channel.archived_at })) throw forbidden();
        await addMembers(ctx, channel, [user.id], user.id);
      }
      return myChannel(ctx, user.id, channel.id);
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/leave',
    summary: 'Leave a channel',
    tags: ['channels'],
    handler: async ({ user, params }) => {
      const { channel } = await requireMember(ctx, user, params.id!);
      if (channel.kind === 'dm') {
        // You can't leave a 1:1 DM; just hide it client-side.
        throw forbidden('Direct messages cannot be left');
      }
      await removeMember(ctx, channel, user.id, user.id);
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/channels/:id/members',
    summary: 'List channel members',
    tags: ['channels'],
    handler: async ({ user, params }) => {
      await requireChannelAccess(ctx, user, params.id!);
      const rows = await ctx.db
        .selectFrom('channel_members as cm')
        .innerJoin('users as u', 'u.id', 'cm.user_id')
        .selectAll('u')
        .select(['cm.role as channel_role'])
        .where('cm.channel_id', '=', params.id!)
        .orderBy('u.username')
        .execute();
      return rows.map((r) => ({ ...toUser(r), channelRole: r.channel_role, presence: ctx.hub.presenceOf(r.id) }));
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/members',
    summary: 'Add people to a channel',
    tags: ['channels'],
    body: AddMembersInput,
    handler: async ({ user, params, body }) => {
      const { channel, membership } = await requireChannelAccess(ctx, user, params.id!);
      if (!canAddMembers(actorOf(user), { kind: channel.kind as never, archived: !!channel.archived_at }, membership ? toMembership(membership) : null)) throw forbidden();
      const added = await addMembers(ctx, channel, body.userIds, user.id);
      return { added };
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/channels/:id/members/:userId',
    summary: 'Remove someone from a channel',
    tags: ['channels'],
    handler: async ({ user, params, ip }) => {
      const { channel, membership } = await requireChannelAccess(ctx, user, params.id!);
      if (params.userId !== user.id && !canManageChannel(actorOf(user), { kind: channel.kind as never, createdBy: channel.created_by }, membership ? toMembership(membership) : null)) throw forbidden();
      if (channel.is_default && channel.kind === 'public' && params.userId !== user.id && !isAdmin(actorOf(user))) throw forbidden();
      await removeMember(ctx, channel, params.userId!, user.id);
      await audit(ctx, { actorId: user.id, action: 'channel.member_removed', targetType: 'channel', targetId: channel.id, ip, metadata: { userId: params.userId } });
    },
  });

  route(app, ctx, {
    method: 'PATCH',
    url: '/channels/:id/members/:userId',
    summary: 'Change a member\'s channel role (admin/member)',
    tags: ['channels'],
    body: z.object({ role: z.enum(['admin', 'member']) }),
    handler: async ({ user, params, body }) => {
      const { channel, membership } = await requireChannelAccess(ctx, user, params.id!);
      if (!canManageChannel(actorOf(user), { kind: channel.kind as never, createdBy: channel.created_by }, membership ? toMembership(membership) : null)) throw forbidden();
      await ctx.db.updateTable('channel_members').set({ role: body.role }).where('channel_id', '=', channel.id).where('user_id', '=', params.userId!).execute();
      const mine = await myChannel(ctx, params.userId!, channel.id);
      if (mine) ctx.hub.sendToUsers([params.userId!], 'membership.updated', { membership: mine.membership, unreadCount: mine.unreadCount, mentionCount: mine.mentionCount });
    },
  });

  route(app, ctx, {
    method: 'PATCH',
    url: '/channels/:id/membership',
    summary: 'Update your own settings for a channel (notifications, mute, star)',
    tags: ['channels'],
    body: UpdateMembershipInput,
    handler: async ({ user, params, body }) => {
      await requireMember(ctx, user, params.id!);
      await ctx.db
        .updateTable('channel_members')
        .set({
          notify_level: body.notifyLevel,
          muted: body.muted === undefined ? undefined : body.muted ? 1 : 0,
          starred: body.starred === undefined ? undefined : body.starred ? 1 : 0,
        })
        .where('channel_id', '=', params.id!)
        .where('user_id', '=', user.id)
        .execute();
      const mine = await myChannel(ctx, user.id, params.id!);
      if (mine) ctx.hub.sendToUsers([user.id], 'membership.updated', { membership: mine.membership, unreadCount: mine.unreadCount, mentionCount: mine.mentionCount });
      return mine?.membership;
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/read',
    summary: 'Mark a channel read up to a message',
    tags: ['channels'],
    body: MarkReadInput,
    handler: async ({ user, params, body }) => {
      const m = await getMembershipRow(ctx, params.id!, user.id);
      if (!m) throw notFound('Channel');
      // Never move the read pointer backwards via this endpoint.
      if (body.messageId && m.last_read_message_id && body.messageId <= m.last_read_message_id) return;
      await markRead(ctx, params.id!, user.id, body.messageId);
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/unread',
    summary: 'Mark a channel unread from a message onwards',
    tags: ['channels'],
    body: z.object({ messageId: z.string().max(64) }),
    handler: async ({ user, params, body }) => {
      const m = await getMembershipRow(ctx, params.id!, user.id);
      if (!m) throw notFound('Channel');
      const prev = await ctx.db
        .selectFrom('messages')
        .select('id')
        .where('channel_id', '=', params.id!)
        .where('id', '<', body.messageId)
        .where('thread_root_id', 'is', null)
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      await markRead(ctx, params.id!, user.id, prev?.id ?? '0');
    },
  });
}
