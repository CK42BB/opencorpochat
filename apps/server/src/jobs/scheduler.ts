// SPDX-License-Identifier: AGPL-3.0-only
// In-process periodic jobs. No external queue is needed for a single node.
import type { Ctx } from '../context.js';
import { DAY, nowIso } from '../lib/time.js';
import { ulidFloor } from '../lib/ids.js';
import { createMessage } from '../modules/messages/service.js';
import { canPostInChannel } from '@ocpc/shared';
import { recordNotification } from '../modules/notifications/service.js';
import { sendDigests } from '../modules/notifications/email.js';
import { publishUser } from '../modules/users/service.js';

export async function sendScheduledMessages(ctx: Ctx) {
  const due = await ctx.db
    .selectFrom('scheduled_messages')
    .selectAll()
    .where('send_at', '<=', nowIso())
    .limit(100)
    .execute();
  for (const s of due) {
    await ctx.db.deleteFrom('scheduled_messages').where('id', '=', s.id).execute();
    const channel = await ctx.db
      .selectFrom('channels')
      .selectAll()
      .where('id', '=', s.channel_id)
      .executeTakeFirst();
    const member = await ctx.db
      .selectFrom('channel_members')
      .selectAll()
      .where('channel_id', '=', s.channel_id)
      .where('user_id', '=', s.user_id)
      .executeTakeFirst();
    const user = await ctx.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', s.user_id)
      .executeTakeFirst();
    if (!channel || !member || !user || user.deactivated_at) continue;
    if (
      !canPostInChannel(
        { id: user.id, role: user.role as never },
        {
          kind: channel.kind as never,
          archived: !!channel.archived_at,
          isReadonly: !!channel.is_readonly,
        },
        { role: member.role } as never,
      )
    )
      continue;
    try {
      await createMessage(ctx, {
        channel,
        userId: s.user_id,
        body: s.body,
        threadRootId: s.thread_root_id,
      });
    } catch (err) {
      ctx.log.warn({ err }, 'scheduled message failed');
    }
  }
}

export async function fireReminders(ctx: Ctx) {
  const due = await ctx.db
    .selectFrom('reminders')
    .selectAll()
    .where('remind_at', '<=', nowIso())
    .limit(100)
    .execute();
  for (const r of due) {
    await ctx.db.deleteFrom('reminders').where('id', '=', r.id).execute();
    const msg = r.message_id
      ? await ctx.db
          .selectFrom('messages')
          .select(['channel_id'])
          .where('id', '=', r.message_id)
          .executeTakeFirst()
      : undefined;
    const text = r.text || 'Reminder about a message';
    await recordNotification(
      ctx,
      {
        user_id: r.user_id,
        kind: 'reminder',
        channel_id: msg?.channel_id ?? null,
        message_id: r.message_id,
        actor_id: null,
        text,
      },
      {
        push: {
          title: '⏰ Reminder',
          body: text,
          url: msg ? `/c/${msg.channel_id}#${r.message_id}` : '/activity',
        },
      },
    );
  }
}

export async function clearExpiredStatuses(ctx: Ctx) {
  const now = nowIso();
  const expired = await ctx.db
    .selectFrom('users')
    .select('id')
    .where((eb) =>
      eb.or([
        eb.and([eb('status_expires_at', 'is not', null), eb('status_expires_at', '<=', now)]),
        eb.and([eb('dnd_until', 'is not', null), eb('dnd_until', '<=', now)]),
      ]),
    )
    .execute();
  for (const { id } of expired) {
    await ctx.db
      .updateTable('users')
      .set((eb) => ({
        status_emoji: eb
          .case()
          .when('status_expires_at', '<=', now)
          .then('')
          .else(eb.ref('status_emoji'))
          .end(),
        status_text: eb
          .case()
          .when('status_expires_at', '<=', now)
          .then('')
          .else(eb.ref('status_text'))
          .end(),
        status_expires_at: eb
          .case()
          .when('status_expires_at', '<=', now)
          .then(null)
          .else(eb.ref('status_expires_at'))
          .end(),
        dnd_until: eb
          .case()
          .when('dnd_until', '<=', now)
          .then(null)
          .else(eb.ref('dnd_until'))
          .end(),
      }))
      .where('id', '=', id)
      .execute();
    await publishUser(ctx, id);
  }
}

/** Delete messages older than the org-wide or per-channel retention period. */
export async function applyRetention(ctx: Ctx) {
  const orgDays = ctx.settings.get().retentionDays;
  const channels = await ctx.db.selectFrom('channels').select(['id', 'retention_days']).execute();
  for (const c of channels) {
    const days = c.retention_days ?? orgDays;
    if (!days) continue;
    const cutoff = ulidFloor(Date.now() - days * DAY);
    const files = await ctx.db
      .selectFrom('files')
      .select(['id', 'storage_key'])
      .where('channel_id', '=', c.id)
      .where('message_id', '<', cutoff)
      .execute();
    for (const f of files) await ctx.storage.delete(f.storage_key).catch(() => {});
    if (files.length)
      await ctx.db
        .deleteFrom('files')
        .where(
          'id',
          'in',
          files.map((f) => f.id),
        )
        .execute();
    // Delete replies first, then roots (thread_follows/reactions cascade via FK).
    await ctx.db
      .deleteFrom('messages')
      .where('channel_id', '=', c.id)
      .where('id', '<', cutoff)
      .where('thread_root_id', 'is not', null)
      .execute();
    await ctx.db
      .deleteFrom('messages')
      .where('channel_id', '=', c.id)
      .where('id', '<', cutoff)
      .execute();
  }
}

export async function cleanup(ctx: Ctx) {
  const now = nowIso();
  await ctx.db.deleteFrom('sessions').where('expires_at', '<', now).execute();
  await ctx.db.deleteFrom('kv').where('expires_at', '<', now).execute();
  // Uploaded but never attached files older than a day.
  const orphans = await ctx.db
    .selectFrom('files')
    .select(['id', 'storage_key'])
    .where('purpose', '=', 'attachment')
    .where('message_id', 'is', null)
    .where('created_at', '<', new Date(Date.now() - DAY).toISOString())
    .execute();
  for (const f of orphans) await ctx.storage.delete(f.storage_key).catch(() => {});
  if (orphans.length)
    await ctx.db
      .deleteFrom('files')
      .where(
        'id',
        'in',
        orphans.map((f) => f.id),
      )
      .execute();
  await ctx.db
    .deleteFrom('notifications')
    .where('created_at', '<', new Date(Date.now() - 90 * DAY).toISOString())
    .execute();
}

export function startScheduler(ctx: Ctx) {
  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, name: string, fn: (ctx: Ctx) => Promise<void>) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await fn(ctx);
      } catch (err) {
        ctx.log.error({ err, job: name }, 'job failed');
      } finally {
        running = false;
      }
    };
    timers.push(setInterval(tick, ms));
    setTimeout(tick, 2000).unref();
  };
  every(15_000, 'scheduled-messages', sendScheduledMessages);
  every(15_000, 'reminders', fireReminders);
  every(60_000, 'statuses', clearExpiredStatuses);
  every(60_000, 'email-digests', sendDigests);
  every(60 * 60_000, 'retention', applyRetention);
  every(60 * 60_000, 'cleanup', cleanup);
  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}
