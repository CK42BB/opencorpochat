// SPDX-License-Identifier: AGPL-3.0-only
import type { Channel, ChannelKind, Membership, MyChannel, NotifyLevel } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { bool } from '../../db/index.js';
import type { ChannelMembersTable, ChannelsTable, UsersTable } from '../../db/schema.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';
import { canViewChannel } from '@ocpc/shared';
import { createMessage } from '../messages/service.js';

export function toMembership(m: ChannelMembersTable): Membership {
  return {
    channelId: m.channel_id,
    userId: m.user_id,
    role: m.role as Membership['role'],
    notifyLevel: m.notify_level as NotifyLevel,
    muted: bool(m.muted),
    starred: bool(m.starred),
    lastReadMessageId: m.last_read_message_id,
    joinedAt: m.joined_at,
  };
}

export function toChannel(row: ChannelsTable, memberCount: number, dmUserIds?: string[]): Channel {
  return {
    id: row.id,
    kind: row.kind as ChannelKind,
    name: row.name,
    topic: row.topic,
    description: row.description,
    createdBy: row.created_by,
    isDefault: bool(row.is_default),
    isReadonly: bool(row.is_readonly),
    archived: !!row.archived_at,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    memberCount,
    ...(dmUserIds ? { dmUserIds } : {}),
  };
}

export async function getChannelRow(ctx: Ctx, id: string) {
  const row = await ctx.db
    .selectFrom('channels')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('Channel');
  return row;
}

export async function getMembershipRow(ctx: Ctx, channelId: string, userId: string) {
  return (
    (await ctx.db
      .selectFrom('channel_members')
      .selectAll()
      .where('channel_id', '=', channelId)
      .where('user_id', '=', userId)
      .executeTakeFirst()) ?? null
  );
}

export async function memberIds(ctx: Ctx, channelId: string): Promise<string[]> {
  const rows = await ctx.db
    .selectFrom('channel_members')
    .select('user_id')
    .where('channel_id', '=', channelId)
    .execute();
  return rows.map((r) => r.user_id);
}

export async function memberCount(ctx: Ctx, channelId: string) {
  const r = await ctx.db
    .selectFrom('channel_members')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('channel_id', '=', channelId)
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

export async function channelView(ctx: Ctx, row: ChannelsTable): Promise<Channel> {
  const ids =
    row.kind === 'dm' || row.kind === 'group_dm' ? await memberIds(ctx, row.id) : undefined;
  return toChannel(row, ids ? ids.length : await memberCount(ctx, row.id), ids);
}

/** Load a channel and check the user may see it. Returns the user's membership (or null). */
export async function requireChannelAccess(ctx: Ctx, user: UsersTable, channelId: string) {
  const channel = await getChannelRow(ctx, channelId);
  const membership = await getMembershipRow(ctx, channelId, user.id);
  const actor = { id: user.id, role: user.role as never };
  if (
    !canViewChannel(
      actor,
      { kind: channel.kind as ChannelKind },
      membership ? toMembership(membership) : null,
    )
  ) {
    throw notFound('Channel');
  }
  return { channel, membership };
}

export async function requireMember(ctx: Ctx, user: UsersTable, channelId: string) {
  const { channel, membership } = await requireChannelAccess(ctx, user, channelId);
  if (!membership) throw forbidden('Join the channel first');
  return { channel, membership };
}

/** All channels the user belongs to, with unread and mention counts. */
export async function myChannels(ctx: Ctx, userId: string): Promise<MyChannel[]> {
  const rows = await ctx.db
    .selectFrom('channel_members as cm')
    .innerJoin('channels as c', 'c.id', 'cm.channel_id')
    .selectAll('c')
    .select([
      'cm.role as m_role',
      'cm.notify_level as m_notify_level',
      'cm.muted as m_muted',
      'cm.starred as m_starred',
      'cm.last_read_message_id as m_last_read',
      'cm.joined_at as m_joined_at',
    ])
    .where('cm.user_id', '=', userId)
    .execute();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const counts = await ctx.db
    .selectFrom('channel_members as cm')
    .select(['cm.channel_id', (eb) => eb.fn.countAll<number>().as('n')])
    .where('cm.channel_id', 'in', ids)
    .groupBy('cm.channel_id')
    .execute();
  const countMap = new Map(counts.map((c) => [c.channel_id, Number(c.n)]));

  const unread = await ctx.db
    .selectFrom('messages as m')
    .innerJoin('channel_members as cm', (j) =>
      j.onRef('cm.channel_id', '=', 'm.channel_id').on('cm.user_id', '=', userId),
    )
    .select(['m.channel_id', (eb) => eb.fn.countAll<number>().as('n')])
    .where((eb) => eb.or([eb('m.thread_root_id', 'is', null), eb('m.also_in_channel', '=', 1)]))
    .where('m.deleted_at', 'is', null)
    .where((eb) => eb.or([eb('m.user_id', 'is', null), eb('m.user_id', '!=', userId)]))
    .where((eb) =>
      eb.or([
        eb('cm.last_read_message_id', 'is', null),
        eb('m.id', '>', eb.ref('cm.last_read_message_id')),
      ]),
    )
    .groupBy('m.channel_id')
    .execute();
  const unreadMap = new Map(unread.map((u) => [u.channel_id, Number(u.n)]));

  const mentions = await ctx.db
    .selectFrom('mentions as mn')
    .innerJoin('channel_members as cm', (j) =>
      j.onRef('cm.channel_id', '=', 'mn.channel_id').on('cm.user_id', '=', userId),
    )
    .innerJoin('messages as m', 'm.id', 'mn.message_id')
    .select(['mn.channel_id', (eb) => eb.fn.countAll<number>().as('n')])
    .where('mn.user_id', '=', userId)
    .where('m.deleted_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('cm.last_read_message_id', 'is', null),
        eb('mn.message_id', '>', eb.ref('cm.last_read_message_id')),
      ]),
    )
    .groupBy('mn.channel_id')
    .execute();
  const mentionMap = new Map(mentions.map((u) => [u.channel_id, Number(u.n)]));

  const dmIds = rows.filter((r) => r.kind === 'dm' || r.kind === 'group_dm').map((r) => r.id);
  const dmMembers = dmIds.length
    ? await ctx.db
        .selectFrom('channel_members')
        .select(['channel_id', 'user_id'])
        .where('channel_id', 'in', dmIds)
        .execute()
    : [];
  const dmMap = new Map<string, string[]>();
  for (const m of dmMembers)
    dmMap.set(m.channel_id, [...(dmMap.get(m.channel_id) ?? []), m.user_id]);

  return rows.map((r) => {
    const isDm = r.kind === 'dm' || r.kind === 'group_dm';
    const unreadCount = unreadMap.get(r.id) ?? 0;
    return {
      ...toChannel(r, countMap.get(r.id) ?? 0, isDm ? (dmMap.get(r.id) ?? []) : undefined),
      membership: {
        channelId: r.id,
        userId,
        role: r.m_role as Membership['role'],
        notifyLevel: r.m_notify_level as NotifyLevel,
        muted: bool(r.m_muted),
        starred: bool(r.m_starred),
        lastReadMessageId: r.m_last_read,
        joinedAt: r.m_joined_at,
      },
      unreadCount,
      // In DMs every unread message counts as a mention.
      mentionCount: isDm ? unreadCount : (mentionMap.get(r.id) ?? 0),
    };
  });
}

export async function myChannel(
  ctx: Ctx,
  userId: string,
  channelId: string,
): Promise<MyChannel | null> {
  return (await myChannels(ctx, userId)).find((c) => c.id === channelId) ?? null;
}

export async function latestMessageId(ctx: Ctx, channelId: string) {
  const r = await ctx.db
    .selectFrom('messages')
    .select('id')
    .where('channel_id', '=', channelId)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return r?.id ?? null;
}

export async function addMembers(
  ctx: Ctx,
  channel: ChannelsTable,
  userIds: string[],
  actorId: string | null,
  opts: { silent?: boolean; role?: 'admin' | 'member' } = {},
) {
  const existing = new Set(await memberIds(ctx, channel.id));
  const users = userIds.length
    ? await ctx.db
        .selectFrom('users')
        .select(['id', 'username', 'role'])
        .where('id', 'in', userIds)
        .where('deactivated_at', 'is', null)
        .execute()
    : [];
  const toAdd = users.filter((u) => !existing.has(u.id));
  if (toAdd.length === 0) return [];
  const lastId = await latestMessageId(ctx, channel.id);
  const joinedAt = nowIso();
  await ctx.db
    .insertInto('channel_members')
    .values(
      toAdd.map((u) => ({
        channel_id: channel.id,
        user_id: u.id,
        role: opts.role ?? 'member',
        notify_level: channel.kind === 'dm' || channel.kind === 'group_dm' ? 'all' : 'mentions',
        muted: 0,
        starred: 0,
        last_read_message_id: lastId,
        joined_at: joinedAt,
      })),
    )
    .onConflict((oc) => oc.doNothing())
    .execute();

  const count = existing.size + toAdd.length;
  for (const u of toAdd) {
    const mine = await myChannel(ctx, u.id, channel.id);
    if (mine) ctx.hub.sendToUsers([u.id], 'channel.created', { channel: mine });
    ctx.hub.sendToUsers(existing, 'channel.member_joined', {
      channelId: channel.id,
      userId: u.id,
      memberCount: count,
    });
  }
  if (!opts.silent && channel.kind !== 'dm' && channel.kind !== 'group_dm') {
    const names = toAdd.map((u) => '@' + u.username);
    const self = toAdd.length === 1 && toAdd[0]!.id === actorId;
    const actor =
      actorId && !self
        ? await ctx.db
            .selectFrom('users')
            .select('username')
            .where('id', '=', actorId)
            .executeTakeFirst()
        : null;
    const body = self
      ? `${names[0]} joined #${channel.name}`
      : `${names.join(', ')} ${toAdd.length > 1 ? 'were' : 'was'} added${actor ? ` by @${actor.username}` : ''}`;
    await createMessage(ctx, {
      channel,
      userId: actorId ?? toAdd[0]!.id,
      body,
      kind: 'system',
      skipNotify: true,
    });
  }
  return toAdd.map((u) => u.id);
}

export async function removeMember(
  ctx: Ctx,
  channel: ChannelsTable,
  userId: string,
  actorId: string,
) {
  const res = await ctx.db
    .deleteFrom('channel_members')
    .where('channel_id', '=', channel.id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (Number(res.numDeletedRows) === 0) return;
  const count = await memberCount(ctx, channel.id);
  ctx.hub.sendToUsers([userId], 'channel.removed', { channelId: channel.id });
  await ctx.hub.sendToChannel(channel.id, 'channel.member_left', {
    channelId: channel.id,
    userId,
    memberCount: count,
  });
  const u = await ctx.db
    .selectFrom('users')
    .select('username')
    .where('id', '=', userId)
    .executeTakeFirst();
  if (u) {
    const body =
      actorId === userId
        ? `@${u.username} left #${channel.name}`
        : `@${u.username} was removed from #${channel.name}`;
    await createMessage(ctx, { channel, userId: actorId, body, kind: 'system', skipNotify: true });
  }
}

export async function createChannel(
  ctx: Ctx,
  input: {
    name: string;
    kind: 'public' | 'private';
    topic?: string;
    description?: string;
    isReadonly?: boolean;
    isDefault?: boolean;
    createdBy: string;
    memberIds?: string[];
  },
) {
  const taken = await ctx.db
    .selectFrom('channels')
    .select('id')
    .where('name', '=', input.name)
    .where('kind', 'in', ['public', 'private'])
    .executeTakeFirst();
  if (taken) throw conflict(`A channel named #${input.name} already exists`);
  const row: ChannelsTable = {
    id: ulid(),
    kind: input.kind,
    name: input.name,
    topic: input.topic ?? '',
    description: input.description ?? '',
    created_by: input.createdBy,
    is_default: input.isDefault ? 1 : 0,
    is_readonly: input.isReadonly ? 1 : 0,
    dm_key: null,
    retention_days: null,
    archived_at: null,
    created_at: nowIso(),
    last_message_at: null,
  };
  await ctx.db.insertInto('channels').values(row).execute();
  await addMembers(ctx, row, [input.createdBy], input.createdBy, { silent: true, role: 'admin' });
  const others = (input.memberIds ?? []).filter((id) => id !== input.createdBy);
  if (others.length) await addMembers(ctx, row, others, input.createdBy);
  return row;
}

/** Find or create the DM / group DM for exactly this set of users. */
export async function openDm(ctx: Ctx, me: UsersTable, otherIds: string[]) {
  const ids = [...new Set([me.id, ...otherIds])].sort();
  const users = await ctx.db
    .selectFrom('users')
    .select(['id', 'deactivated_at'])
    .where('id', 'in', ids)
    .execute();
  if (users.length !== ids.length) throw notFound('User');
  const key = ids.join(':');
  const existing = await ctx.db
    .selectFrom('channels')
    .selectAll()
    .where('dm_key', '=', key)
    .executeTakeFirst();
  if (existing) {
    // Re-add the caller if they had left a group DM.
    if (!(await getMembershipRow(ctx, existing.id, me.id)))
      await addMembers(ctx, existing, [me.id], me.id, { silent: true });
    return existing;
  }
  const row: ChannelsTable = {
    id: ulid(),
    kind: ids.length <= 2 ? 'dm' : 'group_dm',
    name: '',
    topic: '',
    description: '',
    created_by: me.id,
    is_default: 0,
    is_readonly: 0,
    dm_key: key,
    retention_days: null,
    archived_at: null,
    created_at: nowIso(),
    last_message_at: null,
  };
  await ctx.db.insertInto('channels').values(row).execute();
  await addMembers(ctx, row, ids, me.id, { silent: true });
  return row;
}

export async function joinDefaultChannels(
  ctx: Ctx,
  userId: string,
  extraChannelIds: string[] = [],
) {
  const settings = ctx.settings.get();
  const defaults = await ctx.db
    .selectFrom('channels')
    .selectAll()
    .where('archived_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('is_default', '=', 1),
        ...(settings.defaultChannelIds.length ? [eb('id', 'in', settings.defaultChannelIds)] : []),
        ...(extraChannelIds.length ? [eb('id', 'in', extraChannelIds)] : []),
      ]),
    )
    .execute();
  const user = await ctx.db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirst();
  for (const ch of defaults) {
    // Guests only join channels they were explicitly invited to.
    if (user?.role === 'guest' && !extraChannelIds.includes(ch.id)) continue;
    if (ch.kind !== 'public' && !extraChannelIds.includes(ch.id)) continue;
    await addMembers(ctx, ch, [userId], userId);
  }
}

export async function markRead(
  ctx: Ctx,
  channelId: string,
  userId: string,
  messageId: string | null,
) {
  await ctx.db
    .updateTable('channel_members')
    .set({ last_read_message_id: messageId })
    .where('channel_id', '=', channelId)
    .where('user_id', '=', userId)
    .execute();
  const mine = await myChannel(ctx, userId, channelId);
  if (mine) {
    ctx.hub.sendToUsers([userId], 'membership.updated', {
      membership: mine.membership,
      unreadCount: mine.unreadCount,
      mentionCount: mine.mentionCount,
    });
  }
  // Reading a channel also clears its (non-thread) activity entries up to that point.
  if (messageId) {
    await ctx.db
      .updateTable('notifications')
      .set({ read_at: nowIso() })
      .where('user_id', '=', userId)
      .where('channel_id', '=', channelId)
      .where('kind', '!=', 'thread_reply')
      .where('read_at', 'is', null)
      .where('message_id', '<=', messageId)
      .execute();
  }
}
