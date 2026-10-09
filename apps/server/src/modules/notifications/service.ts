// SPDX-License-Identifier: AGPL-3.0-only
// Decides who gets notified about a new message, records activity entries, and
// delivers Web Push. Email digests are sent by the scheduler (see jobs/).
import { matchesKeyword, type Notification } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { bool } from '../../db/index.js';
import type { NotificationsTable, UsersTable } from '../../db/schema.js';
import { ulid } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';
import { preferencesOf } from '../users/service.js';

export function toNotification(n: NotificationsTable): Notification {
  return {
    id: n.id,
    kind: n.kind as Notification['kind'],
    channelId: n.channel_id,
    messageId: n.message_id,
    actorId: n.actor_id,
    text: n.text,
    createdAt: n.created_at,
    read: !!n.read_at,
  };
}

/** Is the user inside their DND window or outside their notification schedule? */
export function isQuiet(user: UsersTable, now = new Date()) {
  if (user.dnd_until && user.dnd_until > now.toISOString()) return true;
  const sched = preferencesOf(user).notifySchedule;
  if (!sched.enabled) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: user.timezone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const hm = `${get('hour')}:${get('minute')}`;
    if (!sched.days.includes(day)) return true;
    return sched.start <= sched.end ? hm < sched.start || hm >= sched.end : hm < sched.start && hm >= sched.end;
  } catch {
    return false;
  }
}

let webpush: typeof import('web-push') | null = null;
async function getWebPush(ctx: Ctx) {
  if (!webpush) {
    webpush = (await import('web-push')).default as unknown as typeof import('web-push');
    webpush.setVapidDetails(ctx.config.vapid.subject, ctx.config.vapid.publicKey, ctx.config.vapid.privateKey);
  }
  return webpush;
}

export async function sendPush(ctx: Ctx, userId: string, payload: Record<string, unknown>) {
  const subs = await ctx.db.selectFrom('push_subscriptions').selectAll().where('user_id', '=', userId).execute();
  if (!subs.length) return;
  const wp = await getWebPush(ctx);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await ctx.db.deleteFrom('push_subscriptions').where('id', '=', s.id).execute();
        else ctx.log.debug({ err }, 'web push failed');
      }
    }),
  );
}

export async function recordNotification(
  ctx: Ctx,
  n: Omit<NotificationsTable, 'id' | 'read_at' | 'emailed_at' | 'created_at'>,
  opts: { push?: { title: string; body: string; url: string } } = {},
) {
  const row: NotificationsTable = { ...n, id: ulid(), read_at: null, emailed_at: null, created_at: nowIso() };
  await ctx.db.insertInto('notifications').values(row).execute();
  ctx.hub.sendToUsers([n.user_id], 'notification', { notification: toNotification(row) });
  if (opts.push) await maybePush(ctx, n.user_id, opts.push);
  return row;
}

/** Push to a device only when the user isn't actively looking at the app. */
async function maybePush(ctx: Ctx, userId: string, p: { title: string; body: string; url: string }) {
  if (ctx.hub.presenceOf(userId) === 'online') return;
  const user = await ctx.db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst();
  if (!user || isQuiet(user)) return;
  await sendPush(ctx, userId, { ...p, tag: p.url });
}

function snippet(body: string, max = 140) {
  const flat = body.replace(/```[\s\S]*?```/g, '[code]').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/** Message-created hook: fan out activity + push notifications. */
export async function notifyForMessage(ctx: Ctx, messageId: string) {
  const msg = await ctx.db.selectFrom('messages').selectAll().where('id', '=', messageId).executeTakeFirst();
  if (!msg || msg.edited_at || msg.deleted_at || msg.kind === 'system') return;
  const channel = await ctx.db.selectFrom('channels').selectAll().where('id', '=', msg.channel_id).executeTakeFirst();
  if (!channel) return;
  const author = msg.user_id ? await ctx.db.selectFrom('users').selectAll().where('id', '=', msg.user_id).executeTakeFirst() : undefined;
  const authorName = msg.as_name ?? author?.display_name ?? 'Someone';
  const isDm = channel.kind === 'dm' || channel.kind === 'group_dm';
  const where = isDm ? 'you' : `#${channel.name}`;
  const text = snippet(msg.body) || (msg.poll ? '📊 Poll' : '📎 Attachment');
  const url = `/c/${channel.id}${msg.thread_root_id ? `?thread=${msg.thread_root_id}` : ''}#${msg.id}`;

  const members = await ctx.db
    .selectFrom('channel_members as cm')
    .innerJoin('users as u', 'u.id', 'cm.user_id')
    .selectAll('u')
    .select(['cm.notify_level', 'cm.muted'])
    .where('cm.channel_id', '=', channel.id)
    .where('u.deactivated_at', 'is', null)
    .execute();
  const mentioned = new Set(
    (await ctx.db.selectFrom('mentions').select('user_id').where('message_id', '=', msg.id).execute()).map((m) => m.user_id),
  );
  const followers = msg.thread_root_id
    ? new Set(
        (
          await ctx.db
            .selectFrom('thread_follows')
            .select('user_id')
            .where('root_id', '=', msg.thread_root_id)
            .where('following', '=', 1)
            .execute()
        ).map((f) => f.user_id),
      )
    : new Set<string>();

  for (const m of members) {
    if (m.id === msg.user_id || m.role === 'bot') continue;
    const level = m.notify_level;
    if (level === 'none') continue;
    const prefs = preferencesOf(m);
    let kind: Notification['kind'] | null = null;
    if (mentioned.has(m.id)) kind = 'mention';
    else if (isDm && !msg.thread_root_id) kind = 'dm';
    else if (msg.thread_root_id && followers.has(m.id)) kind = 'thread_reply';
    else if (prefs.keywords.length && matchesKeyword(msg.body, prefs.keywords)) kind = 'keyword';

    // Muted channels only notify on direct mentions.
    if (bool(m.muted) && kind !== 'mention') continue;

    const title = kind === 'mention' ? `${authorName} mentioned you in ${where}` : kind === 'thread_reply' ? `${authorName} replied in a thread in ${where}` : isDm ? authorName : `${authorName} in ${where}`;
    if (kind) {
      await recordNotification(
        ctx,
        { user_id: m.id, kind, channel_id: channel.id, message_id: msg.id, actor_id: msg.user_id, text },
        { push: { title, body: text, url } },
      );
    } else if (level === 'all' && !msg.thread_root_id) {
      await maybePush(ctx, m.id, { title, body: text, url });
    }
  }
}
