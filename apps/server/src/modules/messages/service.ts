// SPDX-License-Identifier: AGPL-3.0-only
import {
  parseMentions,
  replaceShortcodes,
  type FileInfo,
  type LinkPreview,
  type Message,
  type Poll,
  type ReactionSummary,
} from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { bool, json } from '../../db/index.js';
import type { ChannelsTable, FilesTable, MessagesTable } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';

export function fileUrl(f: Pick<FilesTable, 'id' | 'name'>) {
  return `/api/v1/files/${f.id}/${encodeURIComponent(f.name)}`;
}

export function toFileInfo(f: FilesTable): FileInfo {
  return {
    id: f.id,
    name: f.name,
    mime: f.mime,
    size: Number(f.size),
    url: fileUrl(f),
    thumbUrl: f.mime.startsWith('image/') ? fileUrl(f) : null,
    width: f.width,
    height: f.height,
    uploaderId: f.uploader_id,
    channelId: f.channel_id,
    messageId: f.message_id,
    createdAt: f.created_at,
  };
}

interface StoredPoll {
  question: string;
  options: { id: string; text: string }[];
  multiple: boolean;
  anonymous: boolean;
  closed: boolean;
}

/** Turn message rows into API messages, batch-loading reactions, files, pins, etc. */
export async function hydrate(
  ctx: Ctx,
  rows: MessagesTable[],
  viewerId: string,
): Promise<Message[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [reactions, files, pins, saved, replyUsers, votes] = await Promise.all([
    ctx.db
      .selectFrom('reactions')
      .selectAll()
      .where('message_id', 'in', ids)
      .orderBy('created_at')
      .execute(),
    ctx.db.selectFrom('files').selectAll().where('message_id', 'in', ids).orderBy('id').execute(),
    ctx.db.selectFrom('pins').select('message_id').where('message_id', 'in', ids).execute(),
    ctx.db
      .selectFrom('saved_items')
      .select('message_id')
      .where('user_id', '=', viewerId)
      .where('message_id', 'in', ids)
      .execute(),
    ctx.db
      .selectFrom('messages')
      .select(['thread_root_id', 'user_id'])
      .distinct()
      .where('thread_root_id', 'in', ids.filter((_, i) => rows[i]!.reply_count > 0).concat(['']))
      .where('deleted_at', 'is', null)
      .execute(),
    ctx.db
      .selectFrom('poll_votes')
      .selectAll()
      .where('message_id', 'in', ids.filter((_, i) => rows[i]!.poll).concat(['']))
      .execute(),
  ]);

  const reactMap = new Map<string, ReactionSummary[]>();
  for (const r of reactions) {
    const list = reactMap.get(r.message_id) ?? [];
    let entry = list.find((e) => e.emoji === r.emoji);
    if (!entry) list.push((entry = { emoji: r.emoji, count: 0, userIds: [] }));
    entry.count++;
    entry.userIds.push(r.user_id);
    reactMap.set(r.message_id, list);
  }
  const fileMap = new Map<string, FileInfo[]>();
  for (const f of files)
    fileMap.set(f.message_id!, [...(fileMap.get(f.message_id!) ?? []), toFileInfo(f)]);
  const pinSet = new Set(pins.map((p) => p.message_id));
  const savedSet = new Set(saved.map((s) => s.message_id));
  const replyMap = new Map<string, string[]>();
  for (const r of replyUsers) {
    if (!r.thread_root_id || !r.user_id) continue;
    const l = replyMap.get(r.thread_root_id) ?? [];
    if (l.length < 5) l.push(r.user_id);
    replyMap.set(r.thread_root_id, l);
  }

  return rows.map((r) => {
    const deleted = !!r.deleted_at;
    let poll: Poll | null = null;
    if (r.poll && !deleted) {
      const p = json<StoredPoll | null>(r.poll, null);
      if (p) {
        poll = {
          question: p.question,
          multiple: p.multiple,
          anonymous: p.anonymous,
          closed: p.closed,
          options: p.options.map((o) => {
            const voters = votes
              .filter((v) => v.message_id === r.id && v.option_id === o.id)
              .map((v) => v.user_id);
            // Anonymous polls reveal only the viewer's own vote and the count.
            const voterIds = p.anonymous ? voters.map((v) => (v === viewerId ? v : '')) : voters;
            return { id: o.id, text: o.text, voterIds };
          }),
        };
      }
    }
    return {
      id: r.id,
      channelId: r.channel_id,
      userId: r.user_id,
      threadRootId: r.thread_root_id,
      body: deleted ? '' : r.body,
      kind: r.kind as Message['kind'],
      asName: r.as_name,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      deleted,
      replyCount: r.reply_count,
      lastReplyAt: r.last_reply_at,
      replyUserIds: replyMap.get(r.id) ?? [],
      alsoInChannel: bool(r.also_in_channel),
      reactions: deleted ? [] : (reactMap.get(r.id) ?? []),
      files: deleted ? [] : (fileMap.get(r.id) ?? []),
      pinned: pinSet.has(r.id),
      saved: savedSet.has(r.id),
      previews: deleted ? [] : json<LinkPreview[]>(r.previews, []),
      poll,
      forwardedFrom: deleted ? null : json(r.forwarded_from, null),
    };
  });
}

export async function getMessageRow(ctx: Ctx, id: string) {
  const row = await ctx.db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('Message');
  return row;
}

export async function hydrateOne(ctx: Ctx, row: MessagesTable, viewerId: string) {
  return (await hydrate(ctx, [row], viewerId))[0]!;
}

/** Broadcast a message change. Messages carry per-viewer fields (saved), so we hydrate per recipient lazily:
 * the shared payload uses saved=false and clients merge their local saved state. */
export async function publishMessage(
  ctx: Ctx,
  row: MessagesTable,
  type: 'message.created' | 'message.updated',
) {
  const message = await hydrateOne(ctx, row, '');
  await ctx.hub.sendToChannel(row.channel_id, type, { message });
  return message;
}

export interface CreateMessageInput {
  channel: ChannelsTable;
  userId: string | null;
  body: string;
  kind?: 'user' | 'system' | 'bot';
  asName?: string | null;
  threadRootId?: string | null;
  alsoInChannel?: boolean;
  fileIds?: string[];
  poll?: { question: string; options: string[]; multiple: boolean; anonymous: boolean };
  forwardedFrom?: { messageId: string; channelId: string; userId: string | null } | null;
  skipNotify?: boolean;
  createdAt?: string;
  id?: string;
}

export async function createMessage(ctx: Ctx, input: CreateMessageInput): Promise<MessagesTable> {
  const kind = input.kind ?? 'user';
  const body = kind === 'system' ? input.body : replaceShortcodes(input.body);
  const fileIds = input.fileIds ?? [];
  if (!body.trim() && fileIds.length === 0 && !input.poll && !input.forwardedFrom) {
    throw badRequest('Message is empty');
  }
  let root: MessagesTable | undefined;
  if (input.threadRootId) {
    root = await getMessageRow(ctx, input.threadRootId);
    if (root.channel_id !== input.channel.id) throw badRequest('Thread belongs to another channel');
    if (root.thread_root_id) throw badRequest('Cannot reply to a reply; reply to the thread root');
  }
  const now = input.createdAt ?? nowIso();
  const row: MessagesTable = {
    id: input.id ?? ulid(),
    channel_id: input.channel.id,
    user_id: input.userId,
    thread_root_id: root?.id ?? null,
    body,
    kind,
    as_name: input.asName ?? null,
    also_in_channel: root && input.alsoInChannel ? 1 : 0,
    reply_count: 0,
    last_reply_at: null,
    poll: input.poll
      ? JSON.stringify({
          question: input.poll.question,
          options: input.poll.options.map((text, i) => ({ id: String(i + 1), text })),
          multiple: input.poll.multiple,
          anonymous: input.poll.anonymous,
          closed: false,
        } satisfies StoredPoll)
      : null,
    previews: null,
    forwarded_from: input.forwardedFrom ? JSON.stringify(input.forwardedFrom) : null,
    edited_at: null,
    deleted_at: null,
    created_at: now,
  };

  // Resolve mentions before the transaction (reads only).
  const mentionUserIds =
    kind === 'system' ? [] : await resolveMentions(ctx, input.channel.id, body, input.userId);

  await ctx.db.transaction().execute(async (trx) => {
    await trx.insertInto('messages').values(row).execute();
    if (!root || row.also_in_channel) {
      await trx
        .updateTable('channels')
        .set({ last_message_at: now })
        .where('id', '=', input.channel.id)
        .execute();
    }
    if (root) {
      await trx
        .updateTable('messages')
        .set((eb) => ({ reply_count: eb('reply_count', '+', 1), last_reply_at: now }))
        .where('id', '=', root.id)
        .execute();
      // Thread participants follow the thread: the root author and every replier.
      const followers = [root.user_id, input.userId].filter((x): x is string => !!x);
      for (const uid of new Set(followers)) {
        await trx
          .insertInto('thread_follows')
          .values({
            root_id: root.id,
            user_id: uid,
            last_read_at: uid === input.userId ? now : null,
            following: 1,
          })
          .onConflict((oc) => oc.columns(['root_id', 'user_id']).doNothing())
          .execute();
      }
      if (input.userId) {
        await trx
          .updateTable('thread_follows')
          .set({ last_read_at: now })
          .where('root_id', '=', root.id)
          .where('user_id', '=', input.userId)
          .execute();
      }
    }
    if (fileIds.length) {
      const res = await trx
        .updateTable('files')
        .set({ message_id: row.id, channel_id: input.channel.id })
        .where('id', 'in', fileIds)
        .where('uploader_id', '=', input.userId ?? '')
        .where('message_id', 'is', null)
        .where('purpose', '=', 'attachment')
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== fileIds.length)
        throw badRequest('One or more files are invalid or already attached');
    }
    if (mentionUserIds.length) {
      await trx
        .insertInto('mentions')
        .values(
          mentionUserIds.map((uid) => ({
            message_id: row.id,
            user_id: uid,
            channel_id: input.channel.id,
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    // Your own message marks the channel read up to here.
    if (input.userId && (!root || row.also_in_channel)) {
      await trx
        .updateTable('channel_members')
        .set({ last_read_message_id: row.id })
        .where('channel_id', '=', input.channel.id)
        .where('user_id', '=', input.userId)
        .execute();
    }
  });

  await publishMessage(ctx, row, 'message.created');
  if (root) {
    const updatedRoot = await getMessageRow(ctx, root.id);
    await publishMessage(ctx, updatedRoot, 'message.updated');
  }
  if (!input.skipNotify) {
    for (const fn of ctx.events.onMessageCreated) {
      Promise.resolve(fn(row.id)).catch((err) =>
        ctx.log.error({ err }, 'onMessageCreated hook failed'),
      );
    }
  }
  return row;
}

/** Resolve @user, @group, @channel, @here into user ids that are members of the channel. */
export async function resolveMentions(
  ctx: Ctx,
  channelId: string,
  body: string,
  authorId: string | null,
) {
  const parsed = parseMentions(body);
  const members = await ctx.db
    .selectFrom('channel_members as cm')
    .innerJoin('users as u', 'u.id', 'cm.user_id')
    .select(['u.id', 'u.username'])
    .where('cm.channel_id', '=', channelId)
    .where('u.deactivated_at', 'is', null)
    .execute();
  const out = new Set<string>();
  const byName = new Map(members.map((m) => [m.username, m.id]));
  for (const name of parsed.usernames) {
    const id = byName.get(name);
    if (id) out.add(id);
  }
  if (parsed.usernames.length) {
    const groups = await ctx.db
      .selectFrom('user_groups as g')
      .innerJoin('user_group_members as gm', 'gm.group_id', 'g.id')
      .select('gm.user_id')
      .where('g.handle', 'in', parsed.usernames)
      .execute();
    const memberSet = new Set(members.map((m) => m.id));
    for (const g of groups) if (memberSet.has(g.user_id)) out.add(g.user_id);
  }
  if (parsed.channel) for (const m of members) out.add(m.id);
  if (parsed.here)
    for (const m of members) if (ctx.hub.presenceOf(m.id) === 'online') out.add(m.id);
  if (authorId) out.delete(authorId);
  return [...out];
}

export async function editMessage(ctx: Ctx, row: MessagesTable, body: string) {
  const newBody = replaceShortcodes(body);
  const mentionIds = await resolveMentions(ctx, row.channel_id, newBody, row.user_id);
  await ctx.db.transaction().execute(async (trx) => {
    await trx
      .updateTable('messages')
      .set({ body: newBody, edited_at: nowIso(), previews: null })
      .where('id', '=', row.id)
      .execute();
    await trx.deleteFrom('mentions').where('message_id', '=', row.id).execute();
    if (mentionIds.length) {
      await trx
        .insertInto('mentions')
        .values(
          mentionIds.map((uid) => ({
            message_id: row.id,
            user_id: uid,
            channel_id: row.channel_id,
          })),
        )
        .execute();
    }
  });
  const updated = await getMessageRow(ctx, row.id);
  await publishMessage(ctx, updated, 'message.updated');
  for (const fn of ctx.events.onMessageCreated) {
    // Re-run unfurling etc. on edit; notification hooks ignore edited messages.
    Promise.resolve(fn(row.id)).catch(() => {});
  }
  return updated;
}

export async function deleteMessage(ctx: Ctx, row: MessagesTable) {
  const files = await ctx.db
    .selectFrom('files')
    .selectAll()
    .where('message_id', '=', row.id)
    .execute();
  await ctx.db.transaction().execute(async (trx) => {
    await trx
      .updateTable('messages')
      .set({ deleted_at: nowIso(), body: '', poll: null, previews: null, forwarded_from: null })
      .where('id', '=', row.id)
      .execute();
    await trx.deleteFrom('reactions').where('message_id', '=', row.id).execute();
    await trx.deleteFrom('mentions').where('message_id', '=', row.id).execute();
    await trx.deleteFrom('pins').where('message_id', '=', row.id).execute();
    await trx.deleteFrom('files').where('message_id', '=', row.id).execute();
    await trx.deleteFrom('notifications').where('message_id', '=', row.id).execute();
    if (row.thread_root_id) {
      await trx
        .updateTable('messages')
        .set((eb) => ({ reply_count: eb('reply_count', '-', 1) }))
        .where('id', '=', row.thread_root_id)
        .where('reply_count', '>', 0)
        .execute();
    }
  });
  for (const f of files) await ctx.storage.delete(f.storage_key).catch(() => {});
  await ctx.hub.sendToChannel(row.channel_id, 'message.deleted', {
    messageId: row.id,
    channelId: row.channel_id,
    threadRootId: row.thread_root_id,
  });
  if (row.thread_root_id) {
    const root = await ctx.db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', row.thread_root_id)
      .executeTakeFirst();
    if (root) await publishMessage(ctx, root, 'message.updated');
  }
}

export async function reactionSummary(ctx: Ctx, messageId: string): Promise<ReactionSummary[]> {
  const rows = await ctx.db
    .selectFrom('reactions')
    .selectAll()
    .where('message_id', '=', messageId)
    .orderBy('created_at')
    .execute();
  const out: ReactionSummary[] = [];
  for (const r of rows) {
    let e = out.find((x) => x.emoji === r.emoji);
    if (!e) out.push((e = { emoji: r.emoji, count: 0, userIds: [] }));
    e.count++;
    e.userIds.push(r.user_id);
  }
  return out;
}
