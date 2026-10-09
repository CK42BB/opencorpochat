// SPDX-License-Identifier: AGPL-3.0-only
// Outgoing email (SMTP). Used for missed-activity digests and admin test mail.
import type { Ctx } from '../../context.js';
import { nowIso } from '../../lib/time.js';
import { preferencesOf } from '../users/service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transport: any = null;

async function getTransport(ctx: Ctx) {
  if (!ctx.config.smtp) return null;
  if (!transport) {
    const nodemailer = (await import('nodemailer')).default;
    transport = nodemailer.createTransport(ctx.config.smtp.url);
  }
  return transport;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function sendMail(ctx: Ctx, to: string, subject: string, text: string, html?: string) {
  const t = await getTransport(ctx);
  if (!t) throw new Error('SMTP is not configured (set SMTP_URL)');
  await t.sendMail({ from: ctx.config.smtp!.from, to, subject, text, html });
}

/** Email users about unread notifications older than their configured delay. */
export async function sendDigests(ctx: Ctx) {
  if (!ctx.config.smtp) return;
  const pending = await ctx.db
    .selectFrom('notifications')
    .select('user_id')
    .distinct()
    .where('read_at', 'is', null)
    .where('emailed_at', 'is', null)
    .where('kind', 'in', ['mention', 'dm', 'thread_reply'])
    .execute();
  for (const { user_id } of pending) {
    const user = await ctx.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', user_id)
      .executeTakeFirst();
    if (!user || user.deactivated_at || user.role === 'bot') continue;
    const prefs = preferencesOf(user);
    if (!prefs.emailNotifications || ctx.hub.isOnline(user.id)) continue;
    const cutoff = new Date(Date.now() - prefs.emailDelayMinutes * 60_000).toISOString();
    const items = await ctx.db
      .selectFrom('notifications as n')
      .leftJoin('users as a', 'a.id', 'n.actor_id')
      .leftJoin('channels as c', 'c.id', 'n.channel_id')
      .select([
        'n.id',
        'n.kind',
        'n.text',
        'n.channel_id',
        'n.message_id',
        'a.display_name',
        'c.name as channel_name',
        'c.kind as channel_kind',
      ])
      .where('n.user_id', '=', user.id)
      .where('n.read_at', 'is', null)
      .where('n.emailed_at', 'is', null)
      .where('n.kind', 'in', ['mention', 'dm', 'thread_reply'])
      .where('n.created_at', '<=', cutoff)
      .orderBy('n.id')
      .limit(50)
      .execute();
    if (!items.length) continue;
    const org = ctx.settings.get().name;
    const base = ctx.config.publicUrl;
    const lines = items.map((i) => {
      const where =
        i.channel_kind === 'dm' || i.channel_kind === 'group_dm'
          ? 'a direct message'
          : `#${i.channel_name}`;
      return {
        text: `${i.display_name ?? 'Someone'} in ${where}: ${i.text}`,
        url: `${base}/c/${i.channel_id}#${i.message_id}`,
      };
    });
    const subject = `[${org}] You have ${items.length} unread message${items.length > 1 ? 's' : ''}`;
    const text = `${lines.map((l) => `- ${l.text}\n  ${l.url}`).join('\n')}\n\nChange email settings: ${base}/settings/notifications\n`;
    const html = `<p>Here's what you missed in ${esc(org)}:</p><ul>${lines
      .map((l) => `<li><a href="${esc(l.url)}">${esc(l.text)}</a></li>`)
      .join(
        '',
      )}</ul><p style="color:#666;font-size:12px"><a href="${esc(base)}/settings/notifications">Notification settings</a></p>`;
    try {
      await sendMail(ctx, user.email, subject, text, html);
      await ctx.db
        .updateTable('notifications')
        .set({ emailed_at: nowIso() })
        .where(
          'id',
          'in',
          items.map((i) => i.id),
        )
        .execute();
    } catch (err) {
      ctx.log.warn({ err }, 'failed to send digest email');
    }
  }
}
