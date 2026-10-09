// SPDX-License-Identifier: AGPL-3.0-only
// Importer for the publicly documented Slack workspace export format (a ZIP with
// users.json, channels.json and one folder per channel of daily JSON files).
// Only public-channel exports are supported, as that is what standard exports contain.
// "Slack" is a trademark of its owner; it is used here only to describe the file format.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { replaceShortcodes } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { ulid } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';
import { readZip } from '../../lib/zip.js';
import { addMembers, createChannel } from '../channels/service.js';
import { createMessage } from '../messages/service.js';
import { insertUser, isUsernameTaken } from '../users/service.js';

interface SUser {
  id: string;
  name: string;
  deleted?: boolean;
  is_bot?: boolean;
  real_name?: string;
  profile?: { email?: string; real_name?: string; display_name?: string; title?: string };
}
interface SChannel {
  id: string;
  name: string;
  topic?: { value?: string };
  purpose?: { value?: string };
  members?: string[];
  is_archived?: boolean;
}
interface SMessage {
  type: string;
  subtype?: string;
  user?: string;
  username?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  reactions?: { name: string; users: string[] }[];
}

type Source = { list(): string[]; read(name: string): string };

function openSource(input: string): Source {
  if (statSync(input).isDirectory()) {
    const walk = (dir: string, base = ''): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory()
          ? walk(p, path.join(base, f))
          : [path.join(base, f).split(path.sep).join('/')];
      });
    return { list: () => walk(input), read: (n) => readFileSync(path.join(input, n), 'utf8') };
  }
  const entries = readZip(input);
  const map = new Map(entries.map((e) => [e.name, e]));
  return { list: () => [...map.keys()], read: (n) => map.get(n)!.read().toString('utf8') };
}

/** Convert the export's markup (<@U123>, <#C1|name>, <url|label>) to plain markdown. */
function convertText(text: string, users: Map<string, string>) {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => `@${users.get(id) ?? 'unknown'}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '[$2]($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function tsToIso(ts: string) {
  return new Date(Math.floor(Number(ts) * 1000)).toISOString();
}

export async function importSlackExport(
  ctx: Ctx,
  input: string,
  log: (s: string) => void = console.log,
) {
  if (!existsSync(input)) throw new Error(`Not found: ${input}`);
  const src = openSource(input);
  const files = src.list();
  const root = files.find((f) => f.endsWith('users.json'))?.replace(/users\.json$/, '') ?? '';
  const sUsers = JSON.parse(src.read(`${root}users.json`)) as SUser[];
  const sChannels = JSON.parse(src.read(`${root}channels.json`)) as SChannel[];
  const owner = await ctx.db
    .selectFrom('users')
    .selectAll()
    .where('role', '=', 'owner')
    .orderBy('created_at')
    .executeTakeFirst();
  if (!owner) throw new Error('Run first-time setup before importing');

  // Users: match by email, else create deactivated placeholder accounts the admin can invite later.
  const idMap = new Map<string, string>();
  const nameMap = new Map<string, string>();
  let createdUsers = 0;
  for (const u of sUsers) {
    if (u.is_bot) continue;
    const email = u.profile?.email?.toLowerCase() ?? `${u.id.toLowerCase()}@imported.invalid`;
    let row = await ctx.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();
    if (!row) {
      let base =
        (u.name || 'user')
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '')
          .slice(0, 28) || 'user';
      if (base.length < 2) base = `u${base}`;
      let username = base;
      for (let i = 2; await isUsernameTaken(ctx, username); i++) username = `${base}${i}`;
      row = await insertUser(ctx, {
        email,
        username,
        displayName: u.profile?.display_name || u.profile?.real_name || u.real_name || username,
        role: 'member',
        passwordHash: null,
      });
      await ctx.db
        .updateTable('users')
        .set({ deactivated_at: nowIso(), title: u.profile?.title ?? '' })
        .where('id', '=', row.id)
        .execute();
      createdUsers++;
    }
    idMap.set(u.id, row.id);
    nameMap.set(u.id, row.username);
  }
  log(`Users: ${idMap.size} mapped (${createdUsers} created as inactive placeholders)`);

  let messageCount = 0;
  for (const c of sChannels) {
    let name = c.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .slice(0, 80);
    const existing = await ctx.db
      .selectFrom('channels')
      .selectAll()
      .where('name', '=', name)
      .where('kind', 'in', ['public', 'private'])
      .executeTakeFirst();
    if (existing) name = `${name}-imported`.slice(0, 80);
    const channel = await createChannel(ctx, {
      name,
      kind: 'public',
      topic: c.topic?.value ?? '',
      description: c.purpose?.value ?? '',
      createdBy: owner.id,
    });
    const members = (c.members ?? []).map((m) => idMap.get(m)).filter((x): x is string => !!x);
    if (members.length) await addMembers(ctx, channel, members, owner.id, { silent: true });

    const dayFiles = files
      .filter((f) => f.startsWith(`${root}${c.name}/`) && f.endsWith('.json'))
      .sort();
    const tsToId = new Map<string, string>();
    for (const df of dayFiles) {
      const msgs = (JSON.parse(src.read(df)) as SMessage[]).sort(
        (a, b) => Number(a.ts) - Number(b.ts),
      );
      for (const m of msgs) {
        if (
          m.type !== 'message' ||
          (m.subtype && !['bot_message', 'thread_broadcast', 'me_message'].includes(m.subtype))
        )
          continue;
        const text = convertText(m.text ?? '', nameMap);
        if (!text.trim()) continue;
        const isReply = m.thread_ts && m.thread_ts !== m.ts;
        const rootId = isReply ? tsToId.get(m.thread_ts!) : undefined;
        const created = tsToIso(m.ts);
        const id = ulid(Date.parse(created));
        await createMessage(ctx, {
          id,
          channel,
          userId: m.user ? (idMap.get(m.user) ?? null) : null,
          kind: m.user && idMap.has(m.user) ? 'user' : 'bot',
          asName: m.user && idMap.has(m.user) ? null : (m.username ?? 'Imported'),
          body: m.subtype === 'me_message' ? `_${text}_` : text,
          threadRootId: rootId ?? null,
          alsoInChannel: m.subtype === 'thread_broadcast',
          createdAt: created,
          skipNotify: true,
        });
        tsToId.set(m.ts, id);
        for (const r of m.reactions ?? []) {
          for (const uid of r.users) {
            const mapped = idMap.get(uid);
            if (!mapped) continue;
            await ctx.db
              .insertInto('reactions')
              .values({
                message_id: id,
                user_id: mapped,
                emoji: replaceShortcodes(`:${r.name}:`),
                created_at: created,
              })
              .onConflict((oc) => oc.doNothing())
              .execute();
          }
        }
        messageCount++;
      }
    }
    if (c.is_archived)
      await ctx.db
        .updateTable('channels')
        .set({ archived_at: nowIso() })
        .where('id', '=', channel.id)
        .execute();
    log(`#${name}: imported`);
  }
  log(`Done: ${sChannels.length} channels, ${messageCount} messages.`);
  return { channels: sChannels.length, messages: messageCount, users: idMap.size };
}
