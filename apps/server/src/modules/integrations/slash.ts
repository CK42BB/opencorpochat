// SPDX-License-Identifier: AGPL-3.0-only
// Slash commands: built-ins plus admin-registered commands backed by an HTTP endpoint.
import type { FastifyInstance } from 'fastify';
import { CreateSlashCommandInput, RunSlashCommandInput, type SlashCommand } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import type { SlashCommandsTable, UsersTable } from '../../db/schema.js';
import { randomToken } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { route } from '../../lib/route.js';
import { postJson } from '../../lib/safe-fetch.js';
import { DAY, HOUR, nowIso } from '../../lib/time.js';
import { audit } from '../admin/audit.js';
import { addMembers, removeMember, requireMember, channelView } from '../channels/service.js';
import { createMessage } from '../messages/service.js';
import { publishUser } from '../users/service.js';
import { signatureHeaders } from './routes.js';

export const BUILTIN_COMMANDS: { command: string; description: string; usageHint: string }[] = [
  { command: 'me', description: 'Display an action', usageHint: '[text]' },
  { command: 'shrug', description: 'Append ¯\\_(ツ)_/¯ to your message', usageHint: '[text]' },
  { command: 'topic', description: 'Set the channel topic', usageHint: '[text]' },
  { command: 'invite', description: 'Add people to this channel', usageHint: '@user [@user...]' },
  { command: 'leave', description: 'Leave this channel', usageHint: '' },
  { command: 'remind', description: 'Set a reminder', usageHint: 'me in 30m to [text]' },
  { command: 'status', description: 'Set your status', usageHint: ':emoji: [text]' },
  { command: 'away', description: 'Pause notifications for 1 hour', usageHint: '' },
  { command: 'dnd', description: 'Do not disturb for a duration', usageHint: '[30m|2h|1d|off]' },
  { command: 'call', description: 'Start a call or huddle here', usageHint: '' },
  { command: 'msg', description: 'Send a direct message', usageHint: '@user [message]' },
];

/** Parse "30m", "2 hours", "in 3 days", "tomorrow". Returns ms or null. */
export function parseDuration(text: string): { ms: number; rest: string } | null {
  const t = text.trim();
  const tm = /^tomorrow\b\s*(.*)$/i.exec(t);
  if (tm) return { ms: DAY, rest: tm[1] ?? '' };
  const m = /^(?:in\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)\b\s*(.*)$/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase()[0];
  const ms = unit === 'm' ? n * 60_000 : unit === 'h' ? n * HOUR : unit === 'd' ? n * DAY : n * 7 * DAY;
  return { ms, rest: m[3] ?? '' };
}

function toCommand(c: SlashCommandsTable, secret?: string): SlashCommand {
  return {
    id: c.id,
    command: c.command,
    description: c.description,
    usageHint: c.usage_hint,
    url: c.url,
    createdBy: c.created_by,
    createdAt: c.created_at,
    ...(secret ? { secret } : {}),
  };
}

type Result = { ephemeral?: string; clientAction?: 'call' | 'open_channel'; channelId?: string };

async function runBuiltin(ctx: Ctx, user: UsersTable, cmd: string, args: string, channelId: string, threadRootId: string | null): Promise<Result | null> {
  const post = async (body: string) => {
    const { channel } = await requireMember(ctx, user, channelId);
    await createMessage(ctx, { channel, userId: user.id, body, threadRootId });
  };
  switch (cmd) {
    case 'me':
      if (!args) throw badRequest('Usage: /me [text]');
      await post(`_${args}_`);
      return {};
    case 'shrug':
      // Markdown-escaped so the arms survive rendering: ¯\_(ツ)_/¯
      await post(`${args} ¯\\\\\\_(ツ)\\_/¯`.trim());
      return {};
    case 'topic': {
      const { channel } = await requireMember(ctx, user, channelId);
      if (channel.kind === 'dm' || channel.kind === 'group_dm') throw badRequest('DMs have no topic');
      await ctx.db.updateTable('channels').set({ topic: args.slice(0, 250) }).where('id', '=', channel.id).execute();
      const updated = await ctx.db.selectFrom('channels').selectAll().where('id', '=', channel.id).executeTakeFirstOrThrow();
      await ctx.hub.sendToChannel(channel.id, 'channel.updated', { channel: await channelView(ctx, updated) });
      await createMessage(ctx, { channel: updated, userId: user.id, kind: 'system', body: args ? `@${user.username} set the topic: ${args}` : `@${user.username} cleared the topic`, skipNotify: true });
      return {};
    }
    case 'invite': {
      const { channel } = await requireMember(ctx, user, channelId);
      if (user.role === 'guest' || channel.kind === 'dm') throw forbidden();
      const names = [...args.matchAll(/@?([a-z0-9][a-z0-9._-]*)/gi)].map((m) => m[1]!.toLowerCase());
      if (!names.length) throw badRequest('Usage: /invite @user');
      const users = await ctx.db.selectFrom('users').select('id').where('username', 'in', names).execute();
      const added = await addMembers(ctx, channel, users.map((u) => u.id), user.id);
      return { ephemeral: added.length ? `Added ${added.length} ${added.length === 1 ? 'person' : 'people'}.` : 'Nobody new to add.' };
    }
    case 'leave': {
      const { channel } = await requireMember(ctx, user, channelId);
      if (channel.kind === 'dm') throw badRequest('Direct messages cannot be left');
      await removeMember(ctx, channel, user.id, user.id);
      return {};
    }
    case 'remind': {
      const m = /^(?:me\s+)?(.*)$/i.exec(args);
      const parsed = parseDuration(m?.[1] ?? '');
      if (!parsed) throw badRequest('Usage: /remind me in 30m to [text]  (also: 2h, 1d, tomorrow)');
      const text = parsed.rest.replace(/^to\s+/i, '').trim() || 'Reminder';
      const remindAt = new Date(Date.now() + parsed.ms).toISOString();
      await ctx.db.insertInto('reminders').values({ id: ulid(), user_id: user.id, message_id: null, text, remind_at: remindAt, created_at: nowIso() }).execute();
      return { ephemeral: `⏰ OK, I'll remind you "${text}" at ${new Date(remindAt).toUTCString()}.` };
    }
    case 'status': {
      const em = /^(:[a-z0-9_+-]+:|\p{Extended_Pictographic}\S*)?\s*(.*)$/u.exec(args);
      const { replaceShortcodes } = await import('@ocpc/shared');
      await ctx.db
        .updateTable('users')
        .set({ status_emoji: replaceShortcodes(em?.[1] ?? '').slice(0, 64), status_text: (em?.[2] ?? '').slice(0, 100), status_expires_at: null })
        .where('id', '=', user.id)
        .execute();
      await publishUser(ctx, user.id);
      return { ephemeral: args ? 'Status updated.' : 'Status cleared.' };
    }
    case 'away':
    case 'dnd': {
      let until: string | null;
      if (cmd === 'away') until = new Date(Date.now() + HOUR).toISOString();
      else if (/^off$/i.test(args)) until = null;
      else {
        const d = parseDuration(args || '1h');
        if (!d) throw badRequest('Usage: /dnd 30m | 2h | 1d | off');
        until = new Date(Date.now() + d.ms).toISOString();
      }
      await ctx.db.updateTable('users').set({ dnd_until: until }).where('id', '=', user.id).execute();
      await publishUser(ctx, user.id);
      return { ephemeral: until ? `🔕 Notifications paused until ${new Date(until).toUTCString()}.` : '🔔 Notifications resumed.' };
    }
    case 'call':
      return { clientAction: 'call' };
    case 'msg': {
      const m = /^@?([a-z0-9][a-z0-9._-]*)\s*([\s\S]*)$/i.exec(args);
      if (!m) throw badRequest('Usage: /msg @user [message]');
      const target = await ctx.db.selectFrom('users').select('id').where('username', '=', m[1]!.toLowerCase()).executeTakeFirst();
      if (!target) throw notFound('User');
      const { openDm } = await import('../channels/service.js');
      const dm = await openDm(ctx, user, [target.id]);
      if (m[2]?.trim()) await createMessage(ctx, { channel: dm, userId: user.id, body: m[2].trim() });
      return { clientAction: 'open_channel', channelId: dm.id };
    }
  }
  return null;
}

export function slashRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/commands',
    summary: 'List available slash commands (built-in and custom)',
    tags: ['integrations'],
    handler: async () => {
      const custom = await ctx.db.selectFrom('slash_commands').selectAll().orderBy('command').execute();
      return [...BUILTIN_COMMANDS.map((c) => ({ ...c, builtin: true })), ...custom.map((c) => ({ ...toCommand(c), builtin: false }))];
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/commands/run',
    summary: 'Run a slash command, e.g. {"channelId": "...", "text": "/remind me in 10m to stretch"}',
    tags: ['integrations'],
    body: RunSlashCommandInput,
    handler: async ({ user, body }) => {
      const m = /^\/([a-z0-9_-]+)\s*([\s\S]*)$/i.exec(body.text.trim());
      if (!m) throw badRequest('Not a slash command');
      const cmd = m[1]!.toLowerCase();
      const args = m[2]!.trim();
      const threadRootId = body.threadRootId ?? null;
      const builtin = await runBuiltin(ctx, user, cmd, args, body.channelId, threadRootId);
      if (builtin) return builtin;
      const custom = await ctx.db.selectFrom('slash_commands').selectAll().where('command', '=', cmd).executeTakeFirst();
      if (!custom) throw notFound(`Command /${cmd}`);
      const { channel } = await requireMember(ctx, user, body.channelId);
      const payload = {
        command: `/${cmd}`,
        text: args,
        user_id: user.id,
        user_name: user.username,
        channel_id: channel.id,
        channel_name: channel.name,
        thread_root_id: threadRootId,
        response_url: null,
      };
      let res;
      try {
        res = await postJson(custom.url, payload, signatureHeaders(custom.secret, payload), 8000);
      } catch {
        return { ephemeral: `/${cmd} didn't respond. Try again later.` };
      }
      const data = (res.data ?? {}) as { text?: string; response_type?: string; username?: string };
      if (res.status >= 300) return { ephemeral: `/${cmd} failed (HTTP ${res.status}).` };
      if (data.text && data.response_type === 'in_channel') {
        await createMessage(ctx, { channel, userId: null, kind: 'bot', asName: (data.username ?? `/${cmd}`).slice(0, 80), body: data.text.slice(0, 40_000), threadRootId });
        return {};
      }
      return { ephemeral: data.text ?? '' };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/slash-commands',
    summary: 'Register a custom slash command (admins)',
    tags: ['integrations'],
    auth: 'admin',
    body: CreateSlashCommandInput,
    handler: async ({ user, body, ip }) => {
      if (BUILTIN_COMMANDS.some((c) => c.command === body.command)) throw conflict('That is a built-in command');
      const exists = await ctx.db.selectFrom('slash_commands').select('id').where('command', '=', body.command).executeTakeFirst();
      if (exists) throw conflict('That command already exists');
      const secret = randomToken(24);
      const row: SlashCommandsTable = { id: ulid(), command: body.command, description: body.description, usage_hint: body.usageHint, url: body.url, secret, created_by: user.id, created_at: nowIso() };
      await ctx.db.insertInto('slash_commands').values(row).execute();
      await audit(ctx, { actorId: user.id, action: 'slash_command.created', targetType: 'slash_command', targetId: row.id, ip, metadata: { command: body.command } });
      return toCommand(row, secret);
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/slash-commands/:id',
    summary: 'Delete a custom slash command (admins)',
    tags: ['integrations'],
    auth: 'admin',
    handler: async ({ user, params, ip }) => {
      await ctx.db.deleteFrom('slash_commands').where('id', '=', params.id!).execute();
      await audit(ctx, { actorId: user.id, action: 'slash_command.deleted', targetType: 'slash_command', targetId: params.id!, ip });
    },
  });
}
