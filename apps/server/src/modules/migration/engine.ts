// SPDX-License-Identifier: AGPL-3.0-only
// Migration engine: previews and runs an import from any MigrationSource, and undoes it.
//
// Compliance properties (see docs/migration.md):
// - Nothing is written until an admin has seen the preview and chosen what to import.
// - Private channels and direct messages are excluded unless explicitly included and
//   acknowledged; the choice is recorded in the audit log.
// - Data can be limited by channel and date range (data minimization).
// - Original authors and timestamps are kept; imported history does not notify anyone.
// - The archive's SHA-256 checksum, the options and the counts are kept in the import
//   record and audit log, and a full report can be downloaded.
// - Re-running is safe: already imported items are skipped, so a second run at cut-over
//   only adds what is new. Any import can be undone.
// - People are created as inactive accounts. They claim them with an email-bound invite
//   or single sign-on, so nobody can take over someone else's history.
import { Readable } from 'node:stream';
import { replaceShortcodes } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import type { ChannelsTable, MessagesTable } from '../../db/schema.js';
import { ulid } from '../../lib/ids.js';
import { safeFetch } from '../../lib/safe-fetch.js';
import { DAY, nowIso } from '../../lib/time.js';
import { isUsernameTaken, insertUser } from '../users/service.js';
import type {
  MigrationSource,
  SourceChannel,
  SourceFile,
  SourceMessage,
  SourceUser,
} from './model.js';

export interface ImportOptions {
  /** Source channel ids to import. Omit to import every channel the other options allow. */
  channelIds?: string[];
  includePrivate: boolean;
  includeDirect: boolean;
  /** Required when includePrivate or includeDirect is set. */
  acknowledgePrivate?: boolean;
  /** ISO dates; threads are kept whole and filtered by their first message. */
  since?: string;
  until?: string;
  /** Import file contents (bundled, or downloaded from the source's file hosts). */
  files: boolean;
  /**
   * Add history to an existing channel with the same name and type (e.g. #general)
   * instead of creating a renamed copy. Defaults to true.
   */
  mergeExisting?: boolean;
}

export interface PreviewUser {
  id: string;
  name: string;
  email: string | null;
  match: 'existing' | 'new' | 'bot';
  deleted: boolean;
}

export interface PreviewChannel {
  id: string;
  name: string;
  kind: SourceChannel['kind'];
  group: string | null;
  members: number;
  messages: number;
  files: number;
  firstAt: string | null;
  lastAt: string | null;
  archived: boolean;
  /** Messages already imported by an earlier run (these are skipped). */
  alreadyImported: number;
}

export interface Preview {
  source: string;
  label: string;
  users: PreviewUser[];
  channels: PreviewChannel[];
  totals: { messages: number; files: number; users: number; newUsers: number; channels: number };
  retention: { days: number; olderMessages: number } | null;
  warnings: string[];
}

export interface Progress {
  phase: 'users' | 'channels' | 'done';
  channelsDone: number;
  channelsTotal: number;
  messages: number;
  current: string | null;
}

export interface ChannelReport {
  id: string;
  name: string;
  kind: string;
  localId: string;
  created: boolean;
  messages: number;
  skippedExisting: number;
  files: number;
}

export interface ImportReport {
  users: { created: number; matched: number; bots: number };
  channels: ChannelReport[];
  totals: { messages: number; files: number; reactions: number; skippedExisting: number };
  skipped: { item: string; reason: string }[];
  warnings: string[];
}

const BATCH = 500;
const MAX_BODY = 40_000;

export function isPrivateKind(kind: SourceChannel['kind']) {
  return kind !== 'public';
}

export function validateOptions(o: ImportOptions) {
  if ((o.includePrivate || o.includeDirect) && !o.acknowledgePrivate)
    throw new Error(
      'Importing private channels or direct messages requires acknowledging that you have the authority and a lawful basis to do so',
    );
}

function selected(c: SourceChannel, o: ImportOptions) {
  if (o.channelIds && !o.channelIds.includes(c.id)) return false;
  if (c.kind === 'private') return o.includePrivate;
  if (c.kind === 'dm' || c.kind === 'group_dm') return o.includeDirect;
  return true;
}

function inRange(createdAt: string, o: Pick<ImportOptions, 'since' | 'until'>) {
  if (o.since && createdAt < o.since) return false;
  if (o.until && createdAt > o.until) return false;
  return true;
}

/** Thread replies follow their root: a thread is in range if its first message is. */
function* filtered(
  src: MigrationSource,
  channelId: string,
  o: Pick<ImportOptions, 'since' | 'until'>,
) {
  const roots = new Map<string, boolean>();
  for (const m of src.messages(channelId)) {
    let keep: boolean;
    if (m.threadId && roots.has(m.threadId)) keep = roots.get(m.threadId)!;
    else keep = inRange(m.createdAt, o);
    if (!m.threadId) roots.set(m.id, keep);
    if (keep) yield m;
  }
}

async function existingItems(ctx: Ctx, source: string, kind: string, ids: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    if (!chunk.length) continue;
    const rows = await ctx.db
      .selectFrom('import_items')
      .select(['source_id', 'local_id'])
      .where('source', '=', source)
      .where('kind', '=', kind)
      .where('source_id', 'in', chunk)
      .execute();
    for (const r of rows) out.set(r.source_id, r.local_id);
  }
  return out;
}

async function emailMatches(ctx: Ctx, emails: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < emails.length; i += BATCH) {
    const chunk = emails.slice(i, i + BATCH);
    if (!chunk.length) continue;
    const rows = await ctx.db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('email', 'in', chunk)
      .execute();
    for (const r of rows) out.set(r.email.toLowerCase(), r.id);
  }
  return out;
}

export async function previewImport(ctx: Ctx, src: MigrationSource): Promise<Preview> {
  const known = await existingItems(
    ctx,
    src.kind,
    'user',
    src.users.map((u) => u.id),
  );
  const byEmail = await emailMatches(
    ctx,
    src.users.map((u) => u.email).filter((e): e is string => !!e),
  );
  const users: PreviewUser[] = src.users.map((u) => ({
    id: u.id,
    name: u.displayName,
    email: u.email ?? null,
    match: u.isBot
      ? 'bot'
      : known.has(u.id) || (u.email && byEmail.has(u.email))
        ? 'existing'
        : 'new',
    deleted: !!u.deleted,
  }));

  const retentionDays = ctx.settings.get().retentionDays;
  const cutoff = retentionDays ? new Date(Date.now() - retentionDays * DAY).toISOString() : null;
  let olderMessages = 0;
  const channels: PreviewChannel[] = [];
  for (const c of src.channels) {
    let messages = 0;
    let files = 0;
    let firstAt: string | null = null;
    let lastAt: string | null = null;
    const ids: string[] = [];
    for (const m of src.messages(c.id)) {
      messages++;
      files += m.files.length;
      firstAt ??= m.createdAt;
      lastAt = m.createdAt;
      ids.push(m.id);
      if (cutoff && m.createdAt < cutoff) olderMessages++;
    }
    const already = (await existingItems(ctx, src.kind, 'message', ids)).size;
    channels.push({
      id: c.id,
      name: c.name,
      kind: c.kind,
      group: c.group ?? null,
      members: c.memberIds.length,
      messages,
      files,
      firstAt,
      lastAt,
      archived: !!c.archived,
      alreadyImported: already,
    });
  }
  return {
    source: src.kind,
    label: src.label,
    users,
    channels,
    totals: {
      messages: channels.reduce((n, c) => n + c.messages, 0),
      files: channels.reduce((n, c) => n + c.files, 0),
      users: users.filter((u) => u.match !== 'bot').length,
      newUsers: users.filter((u) => u.match === 'new').length,
      channels: channels.length,
    },
    retention: retentionDays ? { days: retentionDays, olderMessages } : null,
    warnings: [...src.warnings],
  };
}

async function record(
  ctx: Ctx,
  importId: string,
  source: string,
  kind: string,
  sourceId: string,
  localId: string,
  created: boolean,
  former = false,
) {
  await ctx.db
    .insertInto('import_items')
    .values({
      source,
      kind,
      source_id: sourceId,
      import_id: importId,
      local_id: localId,
      created: created ? 1 : 0,
      claimed_at: null,
      former: former ? 1 : 0,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

function baseUsername(s: string) {
  let base =
    s
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 28) || 'user';
  if (base.length < 2) base = `u${base}`;
  return base;
}

async function uniqueUsername(ctx: Ctx, s: string) {
  const base = baseUsername(s);
  let username = base;
  for (let i = 2; await isUsernameTaken(ctx, username); i++) username = `${base}${i}`;
  return username;
}

async function mapUsers(ctx: Ctx, src: MigrationSource, importId: string, report: ImportReport) {
  const map = new Map<string, { id: string; username: string }>();
  const known = await existingItems(
    ctx,
    src.kind,
    'user',
    src.users.map((u) => u.id),
  );
  for (const u of src.users) {
    if (u.isBot) {
      report.users.bots++;
      continue;
    }
    let localId = known.get(u.id);
    let row = localId
      ? await ctx.db
          .selectFrom('users')
          .select(['id', 'username'])
          .where('id', '=', localId)
          .executeTakeFirst()
      : undefined;
    if (!row && u.email) {
      row = await ctx.db
        .selectFrom('users')
        .select(['id', 'username'])
        .where('email', '=', u.email)
        .executeTakeFirst();
      if (row) {
        await record(ctx, importId, src.kind, 'user', u.id, row.id, false);
        report.users.matched++;
      }
    } else if (row) {
      report.users.matched++;
    }
    if (!row) {
      row = await createPlaceholder(ctx, src.kind, u);
      await record(ctx, importId, src.kind, 'user', u.id, row.id, true, !!u.deleted);
      report.users.created++;
    }
    localId = row.id;
    map.set(u.id, { id: localId, username: row.username });
  }
  return map;
}

async function createPlaceholder(ctx: Ctx, source: string, u: SourceUser) {
  const email =
    u.email ?? `${source}-${u.id.toLowerCase().replace(/[^a-z0-9-]/g, '')}@imported.invalid`;
  const row = await insertUser(ctx, {
    email,
    username: await uniqueUsername(ctx, u.username),
    displayName: u.displayName.slice(0, 80) || u.username,
    role: 'member',
    passwordHash: null,
  });
  await ctx.db
    .updateTable('users')
    .set({ deactivated_at: nowIso(), title: (u.title ?? '').slice(0, 100) })
    .where('id', '=', row.id)
    .execute();
  return row;
}

async function channelFor(
  ctx: Ctx,
  src: MigrationSource,
  c: SourceChannel,
  users: Map<string, { id: string }>,
  ownerId: string,
  importId: string,
  mergeExisting: boolean,
): Promise<{ row: ChannelsTable; created: boolean }> {
  const prior = (await existingItems(ctx, src.kind, 'channel', [c.id])).get(c.id);
  if (prior) {
    const row = await ctx.db
      .selectFrom('channels')
      .selectAll()
      .where('id', '=', prior)
      .executeTakeFirst();
    if (row) return { row, created: false };
  }
  const memberIds = [
    ...new Set(c.memberIds.map((m) => users.get(m)?.id).filter((x): x is string => !!x)),
  ];
  let dmKey: string | null = null;
  if (c.kind === 'dm' || c.kind === 'group_dm') {
    dmKey = [...memberIds].sort().join(':');
    const existing = await ctx.db
      .selectFrom('channels')
      .selectAll()
      .where('dm_key', '=', dmKey)
      .executeTakeFirst();
    if (existing) {
      await record(ctx, importId, src.kind, 'channel', c.id, existing.id, false);
      return { row: existing, created: false };
    }
  }
  let name = '';
  if (!dmKey) {
    const base =
      c.name
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 72) || 'imported';
    if (mergeExisting) {
      // Only ever merge into a channel of the same type, so private history never
      // lands in a public channel (or the other way round).
      const same = await ctx.db
        .selectFrom('channels')
        .selectAll()
        .where('name', '=', base)
        .where('kind', '=', c.kind)
        .where('archived_at', 'is', null)
        .executeTakeFirst();
      if (same) {
        await record(ctx, importId, src.kind, 'channel', c.id, same.id, false);
        await addImportedMembers(ctx, same.id, memberIds, true);
        return { row: same, created: false };
      }
    }
    name = base;
    for (let i = 2; ; i++) {
      const taken = await ctx.db
        .selectFrom('channels')
        .select('id')
        .where('name', '=', name)
        .where('kind', 'in', ['public', 'private'])
        .executeTakeFirst();
      if (!taken) break;
      name = `${base}-${i === 2 ? 'imported' : `imported-${i - 1}`}`;
    }
  }
  const row: ChannelsTable = {
    id: ulid(),
    kind: dmKey ? (memberIds.length <= 2 ? 'dm' : 'group_dm') : c.kind,
    name,
    topic: (c.topic ?? '').slice(0, 250),
    description: (c.description ?? '').slice(0, 1000),
    created_by: ownerId,
    is_default: 0,
    is_readonly: 0,
    dm_key: dmKey,
    retention_days: null,
    archived_at: null,
    created_at: nowIso(),
    last_message_at: null,
  };
  await ctx.db.insertInto('channels').values(row).execute();
  await record(ctx, importId, src.kind, 'channel', c.id, row.id, true);
  const members = dmKey ? memberIds : [...new Set([ownerId, ...memberIds])];
  await addImportedMembers(ctx, row.id, members, !dmKey, ownerId);
  return { row, created: true };
}

/**
 * Imported people are inactive until they claim their account, so add members directly
 * rather than through the normal (active-only, notifying) path.
 */
async function addImportedMembers(
  ctx: Ctx,
  channelId: string,
  userIds: string[],
  isChannel: boolean,
  adminId?: string,
) {
  const joinedAt = nowIso();
  for (let i = 0; i < userIds.length; i += BATCH) {
    await ctx.db
      .insertInto('channel_members')
      .values(
        userIds.slice(i, i + BATCH).map((uid) => ({
          channel_id: channelId,
          user_id: uid,
          role: uid === adminId && isChannel ? 'admin' : 'member',
          notify_level: isChannel ? 'mentions' : 'all',
          muted: 0,
          starred: 0,
          last_read_message_id: null,
          joined_at: joinedAt,
        })),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}

function resolveText(
  text: string,
  users: Map<string, { username: string }>,
  names: Map<string, string>,
) {
  return text.replace(/<@([^>\s]+)>/g, (_, id: string) => {
    const u = users.get(id);
    return u ? `@${u.username}` : `@${names.get(id) ?? 'unknown'}`;
  });
}

function hostAllowed(url: string, hosts: string[]) {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
    );
  } catch {
    return false;
  }
}

async function fetchFile(ctx: Ctx, src: MigrationSource, f: SourceFile): Promise<Buffer | null> {
  if (f.read) return f.read();
  if (!f.url || !hostAllowed(f.url, src.downloadHosts)) return null;
  const max = ctx.config.maxUploadMb * 1024 * 1024;
  const res = await safeFetch(f.url, {
    maxBytes: max + 1,
    timeoutMs: 60_000,
    maxRedirects: 5,
    accept: '*/*',
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (/text\/html/.test(res.contentType) && !/html/.test(f.mime ?? ''))
    throw new Error('Got a web page instead of the file (the link may need a sign-in)');
  if (res.body.length > max) throw new Error(`Larger than ${ctx.config.maxUploadMb} MB`);
  return res.body;
}

function sanitizeName(n: string) {
  return n.replace(/[\\/\0\r\n]/g, '_').slice(0, 200) || 'file';
}

export async function runImport(
  ctx: Ctx,
  src: MigrationSource,
  opts: {
    importId: string;
    actorId: string;
    options: ImportOptions;
    onProgress?: (p: Progress) => void | Promise<void>;
  },
): Promise<ImportReport> {
  const o = opts.options;
  validateOptions(o);
  const report: ImportReport = {
    users: { created: 0, matched: 0, bots: 0 },
    channels: [],
    totals: { messages: 0, files: 0, reactions: 0, skippedExisting: 0 },
    skipped: [],
    warnings: [...src.warnings],
  };
  const progress: Progress = {
    phase: 'users',
    channelsDone: 0,
    channelsTotal: 0,
    messages: 0,
    current: null,
  };
  const tick = async () => {
    await opts.onProgress?.({ ...progress });
  };
  await tick();
  const users = await mapUsers(ctx, src, opts.importId, report);
  const names = new Map(src.users.map((u) => [u.id, baseUsername(u.username)]));
  const chosen = src.channels.filter((c) => selected(c, o));
  progress.phase = 'channels';
  progress.channelsTotal = chosen.length;
  await tick();

  for (const c of chosen) {
    progress.current = c.name;
    await tick();
    const { row: channel, created } = await channelFor(
      ctx,
      src,
      c,
      users,
      opts.actorId,
      opts.importId,
      o.mergeExisting ?? true,
    );
    const cr: ChannelReport = {
      id: c.id,
      name: c.name,
      kind: c.kind,
      localId: channel.id,
      created,
      messages: 0,
      skippedExisting: 0,
      files: 0,
    };
    // Source thread id -> local message id, for this channel.
    const local = new Map<string, string>();
    const touchedRoots = new Set<string>();
    let latestTop: MessagesTable | null = null;

    const pending: SourceMessage[] = [];
    const flush = async () => {
      if (!pending.length) return;
      const done = await existingItems(
        ctx,
        src.kind,
        'message',
        pending.map((m) => m.id),
      );
      for (const [sid, lid] of done) local.set(sid, lid);
      const threadIds = pending
        .map((m) => m.threadId)
        .filter((t): t is string => !!t && !local.has(t));
      for (const [sid, lid] of await existingItems(ctx, src.kind, 'message', [
        ...new Set(threadIds),
      ]))
        local.set(sid, lid);

      const rows: MessagesTable[] = [];
      const reactions: {
        message_id: string;
        user_id: string;
        emoji: string;
        created_at: string;
      }[] = [];
      const items: { sid: string; lid: string }[] = [];
      const files: { m: SourceMessage; msgId: string; uploader: string | null }[] = [];
      for (const m of pending) {
        if (done.has(m.id)) {
          cr.skippedExisting++;
          continue;
        }
        const author = m.userId ? users.get(m.userId) : undefined;
        let body = resolveText(m.text, users, names).trim();
        const linkOnly = o.files ? [] : m.files;
        if (linkOnly.length)
          body = [
            body,
            ...linkOnly.map((f) => (f.link ? `📎 [${f.name}](${f.link})` : `📎 ${f.name}`)),
          ]
            .filter(Boolean)
            .join('\n');
        if (!body && !(o.files && m.files.length)) {
          report.skipped.push({ item: m.id, reason: 'empty message' });
          continue;
        }
        if (body.length > MAX_BODY) {
          body = `${body.slice(0, MAX_BODY - 20)}\n…(truncated)`;
          report.skipped.push({
            item: m.id,
            reason: 'message longer than 40,000 characters was truncated',
          });
        }
        const rootId = m.threadId ? local.get(m.threadId) : undefined;
        if (m.threadId && !rootId)
          report.skipped.push({
            item: m.id,
            reason: 'thread reply without its first message; imported as a normal message',
          });
        const id = ulid(Date.parse(m.createdAt));
        const row: MessagesTable = {
          id,
          channel_id: channel.id,
          user_id: author?.id ?? null,
          thread_root_id: rootId ?? null,
          body,
          kind: author ? 'user' : 'bot',
          as_name: author
            ? null
            : (m.authorName ?? names.get(m.userId ?? '') ?? 'Imported').slice(0, 80),
          also_in_channel: rootId && m.alsoInChannel ? 1 : 0,
          reply_count: 0,
          last_reply_at: null,
          poll: null,
          previews: null,
          forwarded_from: null,
          edited_at: m.editedAt ?? null,
          deleted_at: null,
          created_at: m.createdAt,
        };
        rows.push(row);
        local.set(m.id, id);
        items.push({ sid: m.id, lid: id });
        if (rootId) touchedRoots.add(rootId);
        if (!rootId || row.also_in_channel) {
          if (!latestTop || row.id > latestTop.id) latestTop = row;
        }
        const seen = new Set<string>();
        for (const r of m.reactions) {
          const emoji = replaceShortcodes(r.emoji);
          for (const su of r.userIds) {
            const uid = users.get(su)?.id;
            if (!uid || seen.has(`${uid}:${emoji}`)) continue;
            seen.add(`${uid}:${emoji}`);
            reactions.push({ message_id: id, user_id: uid, emoji, created_at: m.createdAt });
          }
        }
        if (o.files && m.files.length) files.push({ m, msgId: id, uploader: author?.id ?? null });
      }
      await ctx.db.transaction().execute(async (trx) => {
        for (let i = 0; i < rows.length; i += 100)
          await trx
            .insertInto('messages')
            .values(rows.slice(i, i + 100))
            .execute();
        for (let i = 0; i < reactions.length; i += 200)
          await trx
            .insertInto('reactions')
            .values(reactions.slice(i, i + 200))
            .onConflict((oc) => oc.doNothing())
            .execute();
        for (let i = 0; i < items.length; i += 200)
          await trx
            .insertInto('import_items')
            .values(
              items.slice(i, i + 200).map((it) => ({
                source: src.kind,
                kind: 'message',
                source_id: it.sid,
                import_id: opts.importId,
                local_id: it.lid,
                created: 1,
                claimed_at: null,
              })),
            )
            .onConflict((oc) => oc.doNothing())
            .execute();
      });
      cr.messages += rows.length;
      report.totals.messages += rows.length;
      report.totals.reactions += reactions.length;
      report.totals.skippedExisting += done.size;
      progress.messages += rows.length;

      for (const { m, msgId, uploader } of files) {
        const failed: SourceFile[] = [];
        for (const f of m.files) {
          try {
            const data = await fetchFile(ctx, src, f);
            if (!data) {
              failed.push(f);
              continue;
            }
            const fid = ulid(Date.parse(m.createdAt));
            const key = `${fid.slice(0, 2)}/${fid}`;
            const mime = (f.mime || 'application/octet-stream').toLowerCase();
            await ctx.storage.put(key, Readable.from(data), data.length, mime);
            await ctx.db
              .insertInto('files')
              .values({
                id: fid,
                uploader_id: uploader ?? opts.actorId,
                purpose: 'attachment',
                channel_id: channel.id,
                message_id: msgId,
                name: sanitizeName(f.name),
                mime,
                size: data.length,
                storage_key: key,
                width: null,
                height: null,
                created_at: m.createdAt,
              })
              .execute();
            await record(ctx, opts.importId, src.kind, 'file', `${m.id}/${f.id}`, fid, true);
            cr.files++;
            report.totals.files++;
          } catch (err) {
            failed.push(f);
            report.skipped.push({
              item: `${m.id}/${f.id}`,
              reason: `file "${f.name}" not imported: ${(err as Error).message}`,
            });
          }
        }
        if (failed.length) {
          // Keep a visible trace of files that could not be copied.
          const row = await ctx.db
            .selectFrom('messages')
            .select('body')
            .where('id', '=', msgId)
            .executeTakeFirstOrThrow();
          const note = failed
            .map((f) => (f.link ? `📎 [${f.name}](${f.link})` : `📎 ${f.name} (not imported)`))
            .join('\n');
          await ctx.db
            .updateTable('messages')
            .set({ body: [row.body, note].filter(Boolean).join('\n').slice(0, MAX_BODY) })
            .where('id', '=', msgId)
            .execute();
        }
      }
      pending.length = 0;
      await tick();
    };

    for (const m of filtered(src, c.id, o)) {
      pending.push(m);
      // Keep a thread's replies in the same batch as (or after) their root.
      if (pending.length >= BATCH) await flush();
    }
    await flush();

    await finishChannel(ctx, channel, created, [...touchedRoots], latestTop);
    if (created && c.archived)
      await ctx.db
        .updateTable('channels')
        .set({ archived_at: nowIso() })
        .where('id', '=', channel.id)
        .execute();
    report.channels.push(cr);
    progress.channelsDone++;
    await tick();
  }
  progress.phase = 'done';
  progress.current = null;
  await tick();
  return report;
}

/** Fix up derived data (thread counts, unread markers) after bulk-inserting messages. */
async function finishChannel(
  ctx: Ctx,
  channel: ChannelsTable,
  created: boolean,
  roots: string[],
  latestTop: MessagesTable | null,
) {
  for (const rootId of roots) {
    const replies = await ctx.db
      .selectFrom('messages')
      .select(['user_id', 'created_at'])
      .where('thread_root_id', '=', rootId)
      .where('deleted_at', 'is', null)
      .execute();
    const root = await ctx.db
      .selectFrom('messages')
      .select(['user_id'])
      .where('id', '=', rootId)
      .executeTakeFirst();
    const last = replies.reduce<string | null>(
      (a, r) => (!a || r.created_at > a ? r.created_at : a),
      null,
    );
    await ctx.db
      .updateTable('messages')
      .set({ reply_count: replies.length, last_reply_at: last })
      .where('id', '=', rootId)
      .execute();
    const participants = new Set(
      [root?.user_id, ...replies.map((r) => r.user_id)].filter((x): x is string => !!x),
    );
    for (const uid of participants) {
      await ctx.db
        .insertInto('thread_follows')
        .values({ root_id: rootId, user_id: uid, last_read_at: nowIso(), following: 1 })
        .onConflict((oc) => oc.columns(['root_id', 'user_id']).doNothing())
        .execute();
    }
  }
  if (latestTop) {
    if (!channel.last_message_at || latestTop.created_at > channel.last_message_at)
      await ctx.db
        .updateTable('channels')
        .set({ last_message_at: latestTop.created_at })
        .where('id', '=', channel.id)
        .execute();
    // Imported history starts out read, so nobody gets a flood of unread badges.
    let q = ctx.db
      .updateTable('channel_members')
      .set({ last_read_message_id: latestTop.id })
      .where('channel_id', '=', channel.id);
    if (!created) q = q.where('last_read_message_id', 'is', null);
    await q.execute();
  }
}

/** Remove everything an import created. People who already claimed their account are kept. */
export async function undoImport(ctx: Ctx, importId: string) {
  const items = await ctx.db
    .selectFrom('import_items')
    .selectAll()
    .where('import_id', '=', importId)
    .where('created', '=', 1)
    .execute();
  const ids = (kind: string) => items.filter((i) => i.kind === kind).map((i) => i.local_id);
  const counts = { channels: 0, messages: 0, files: 0, users: 0 };

  const deleteFiles = async (rows: { id: string; storage_key: string }[]) => {
    for (const f of rows) await ctx.storage.delete(f.storage_key).catch(() => {});
    for (let i = 0; i < rows.length; i += BATCH)
      await ctx.db
        .deleteFrom('files')
        .where(
          'id',
          'in',
          rows.slice(i, i + BATCH).map((f) => f.id),
        )
        .execute();
    counts.files += rows.length;
  };

  // Channels created by the import go entirely (messages, members and reactions cascade).
  const channelIds = ids('channel');
  for (const cid of channelIds) {
    await deleteFiles(
      await ctx.db
        .selectFrom('files')
        .select(['id', 'storage_key'])
        .where('channel_id', '=', cid)
        .execute(),
    );
    const n = await ctx.db
      .selectFrom('messages')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('channel_id', '=', cid)
      .executeTakeFirst();
    counts.messages += Number(n?.n ?? 0);
    await ctx.db.deleteFrom('channels').where('id', '=', cid).execute();
    counts.channels++;
  }
  // Messages added to channels that already existed (incremental runs, existing DMs).
  const messageIds = ids('message');
  const roots = new Set<string>();
  for (let i = 0; i < messageIds.length; i += BATCH) {
    const chunk = messageIds.slice(i, i + BATCH);
    const rows = await ctx.db
      .selectFrom('messages')
      .select(['id', 'thread_root_id'])
      .where('id', 'in', chunk)
      .execute();
    if (!rows.length) continue;
    for (const r of rows) if (r.thread_root_id) roots.add(r.thread_root_id);
    await deleteFiles(
      await ctx.db
        .selectFrom('files')
        .select(['id', 'storage_key'])
        .where(
          'message_id',
          'in',
          rows.map((r) => r.id),
        )
        .execute(),
    );
    // Replies first, then roots.
    await ctx.db
      .deleteFrom('messages')
      .where(
        'thread_root_id',
        'in',
        rows.map((r) => r.id),
      )
      .execute();
    await ctx.db
      .deleteFrom('messages')
      .where(
        'id',
        'in',
        rows.map((r) => r.id),
      )
      .execute();
    counts.messages += rows.length;
  }
  for (const rootId of roots) {
    const replies = await ctx.db
      .selectFrom('messages')
      .select(['created_at'])
      .where('thread_root_id', '=', rootId)
      .execute();
    await ctx.db
      .updateTable('messages')
      .set({
        reply_count: replies.length,
        last_reply_at: replies.reduce<string | null>(
          (a, r) => (!a || r.created_at > a ? r.created_at : a),
          null,
        ),
      })
      .where('id', '=', rootId)
      .execute();
  }
  // Placeholder accounts nobody claimed, and that no remaining message refers to.
  for (const it of items.filter((i) => i.kind === 'user' && !i.claimed_at)) {
    const used = await ctx.db
      .selectFrom('messages')
      .select('id')
      .where('user_id', '=', it.local_id)
      .executeTakeFirst();
    const user = await ctx.db
      .selectFrom('users')
      .select(['id', 'deactivated_at'])
      .where('id', '=', it.local_id)
      .executeTakeFirst();
    if (!user || used || !user.deactivated_at) continue;
    await ctx.db.deleteFrom('reactions').where('user_id', '=', it.local_id).execute();
    await ctx.db.deleteFrom('thread_follows').where('user_id', '=', it.local_id).execute();
    await ctx.db.deleteFrom('users').where('id', '=', it.local_id).execute();
    counts.users++;
  }
  await ctx.db.deleteFrom('import_items').where('import_id', '=', importId).execute();
  return counts;
}

/** An inactive account created by an import that its owner has not claimed yet. */
export async function claimablePlaceholder(ctx: Ctx, userId: string) {
  const row = await ctx.db
    .selectFrom('import_items')
    .select(['source', 'source_id'])
    .where('kind', '=', 'user')
    .where('local_id', '=', userId)
    .where('created', '=', 1)
    .where('claimed_at', 'is', null)
    .where('former', '=', 0)
    .executeTakeFirst();
  return !!row;
}

export async function markClaimed(ctx: Ctx, userId: string) {
  await ctx.db
    .updateTable('import_items')
    .set({ claimed_at: nowIso() })
    .where('kind', '=', 'user')
    .where('local_id', '=', userId)
    .execute();
}

/** Imported people who have not claimed their account yet and can be invited by email. */
export async function unclaimedPeople(ctx: Ctx) {
  return ctx.db
    .selectFrom('import_items')
    .innerJoin('users', 'users.id', 'import_items.local_id')
    .select(['users.id', 'users.email', 'users.display_name', 'users.username'])
    .where('import_items.kind', '=', 'user')
    .where('import_items.created', '=', 1)
    .where('import_items.claimed_at', 'is', null)
    .where('import_items.former', '=', 0)
    .where('users.deactivated_at', 'is not', null)
    .where('users.email', 'not like', '%@imported.invalid')
    .execute();
}
