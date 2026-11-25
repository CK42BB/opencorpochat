// SPDX-License-Identifier: AGPL-3.0-only
// Collects Microsoft Teams data through the publicly documented Microsoft Graph API and
// writes it, unmodified, into a ZIP archive that `ocpc import` (or the admin console)
// can import. Collecting and importing are separate steps on purpose: the archive can be
// reviewed, checksummed and retained before anything is imported, and the import itself
// runs offline. See docs/migration.md for the app registration and permissions it needs.
import { createHash } from 'node:crypto';
import { VERSION } from '@ocpc/shared';
import { ZipWriter } from '../../lib/zip.js';
import {
  TEAMS_FORMAT,
  TEAMS_MANIFEST,
  type ContentIndex,
  type GChannel,
  type GChat,
  type GMember,
  type GMessage,
  type GTeam,
  type GUser,
  type TeamsManifest,
} from './teams.js';

export interface CollectOptions {
  out: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  /** A ready-made Graph access token (e.g. from the Azure CLI), instead of app credentials. */
  token?: string;
  /** Team ids or names to collect; all teams when empty. */
  teams?: string[];
  includePrivateChannels?: boolean;
  includeChats?: boolean;
  downloadFiles?: boolean;
  maxFileMb?: number;
  /** ISO date: skip threads that started earlier. */
  since?: string;
  log?: (s: string) => void;
  /** For tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';

export class GraphError extends Error {
  constructor(
    public status: number,
    public path: string,
    message: string,
  ) {
    super(message);
  }
}

const seg = encodeURIComponent;
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const folder = (id: string) => sha(id).slice(0, 16);

export async function collectTeams(o: CollectOptions) {
  const log = o.log ?? console.log;
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  if (!o.token && !(o.tenantId && o.clientId && o.clientSecret))
    throw new Error('Provide --token, or --tenant, --client-id and --client-secret');
  const warnings: string[] = [];
  let token = o.token ?? '';
  let tokenExpires = o.token ? Infinity : 0;

  async function authenticate() {
    const res = await doFetch(`${LOGIN}/${seg(o.tenantId!)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: o.clientId!,
        client_secret: o.clientSecret!,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!res.ok || !body.access_token)
      throw new Error(`Sign-in to Microsoft failed: ${body.error_description ?? res.status}`);
    token = body.access_token;
    tokenExpires = Date.now() + ((body.expires_in ?? 3600) - 120) * 1000;
  }

  async function request(url: string, binary = false): Promise<Response> {
    if (!url.startsWith(`${GRAPH}/`) && !url.startsWith('https://graph.microsoft.com/'))
      throw new Error(`Refusing to send credentials to ${new URL(url).host}`);
    for (let attempt = 0; ; attempt++) {
      if (Date.now() > tokenExpires) await authenticate();
      const res = await doFetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: binary ? '*/*' : 'application/json' },
      });
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 6) {
        const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
        log(`  Microsoft Graph asked us to slow down; waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      if (res.status === 401 && o.clientSecret && attempt === 0) {
        tokenExpires = 0;
        continue;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new GraphError(
          res.status,
          url.replace(GRAPH, ''),
          body.error?.message ?? res.statusText,
        );
      }
      return res;
    }
  }

  async function list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = path.startsWith('https://') ? path : `${GRAPH}${path}`;
    while (url) {
      const body = (await (await request(url)).json()) as {
        value?: T[];
        '@odata.nextLink'?: string;
      };
      out.push(...(body.value ?? []));
      url = body['@odata.nextLink'];
    }
    return out;
  }

  async function tryList<T>(path: string, what: string): Promise<T[]> {
    try {
      return await list<T>(path);
    } catch (err) {
      if (!(err instanceof GraphError)) throw err;
      const msg = `Could not read ${what} (${err.status}: ${err.message})`;
      warnings.push(msg);
      log(`  ${msg}`);
      return [];
    }
  }

  const zip = new ZipWriter(o.out);
  const hashes: Record<string, string> = {};
  const put = async (name: string, data: unknown) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data, null, 1));
    hashes[name] = sha(buf);
    await zip.add(name, buf);
  };
  const content: ContentIndex = {};
  const maxBytes = (o.maxFileMb ?? 100) * 1024 * 1024;
  let downloaded = 0;

  async function download(url: string, name: string, graphPath: string) {
    if (content[url]) return;
    try {
      const res = await request(graphPath, true);
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > maxBytes) throw new Error(`larger than ${o.maxFileMb ?? 100} MB`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error(`larger than ${o.maxFileMb ?? 100} MB`);
      const path = `content/${sha(url)}`;
      await put(path, buf);
      content[url] = {
        path,
        name,
        contentType: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!,
        size: buf.length,
      };
      downloaded++;
    } catch (err) {
      warnings.push(`File "${name}" was not downloaded: ${(err as Error).message}`);
    }
  }

  async function collectContent(messages: GMessage[]) {
    for (const m of messages) {
      // Inline images are "hosted contents" of the message, served by Graph itself.
      for (const [, src] of (m.body?.content ?? '').matchAll(/<img[^>]+src="([^"]+)"/g)) {
        const url = src!.replace(/&amp;/g, '&');
        if (
          /^https:\/\/graph\.microsoft\.com\/(v1\.0|beta)\/.+\/hostedContents\/.+\/\$value$/.test(
            url,
          )
        )
          await download(url, 'image.png', url);
      }
      if (!o.downloadFiles) continue;
      for (const att of m.attachments ?? []) {
        if (att.contentType !== 'reference' || !att.contentUrl) continue;
        // Shared files live in SharePoint/OneDrive; the shares API resolves the link.
        const encoded = `u!${Buffer.from(att.contentUrl).toString('base64url')}`;
        await download(
          att.contentUrl,
          att.name ?? 'file',
          `${GRAPH}/shares/${encoded}/driveItem/content`,
        );
      }
    }
  }

  const keep = (m: GMessage) => !o.since || m.createdDateTime >= o.since;

  async function channelMessages(teamId: string, channelId: string) {
    const base = `/teams/${seg(teamId)}/channels/${seg(channelId)}/messages`;
    const roots = await list<
      GMessage & { replies?: GMessage[]; 'replies@odata.nextLink'?: string }
    >(`${base}?$top=50&$expand=replies`);
    const out: GMessage[] = [];
    for (const r of roots.filter(keep)) {
      let replies = r.replies ?? [];
      const isMessage = (r.messageType ?? 'message') === 'message';
      if (isMessage && (!r.replies || r['replies@odata.nextLink'])) {
        try {
          replies = await list<GMessage>(`${base}/${seg(r.id)}/replies?$top=50`);
        } catch (err) {
          if (!(err instanceof GraphError)) throw err;
          warnings.push(
            `Replies to message ${r.id} could not be read (${err.status}: ${err.message})`,
          );
        }
      }
      delete r.replies;
      delete r['replies@odata.nextLink'];
      out.push(r, ...replies.map((x) => ({ ...x, replyToId: x.replyToId ?? r.id })));
    }
    return out;
  }

  // ---- People ----
  log('Reading the user directory…');
  const users = await tryList<GUser>(
    '/users?$select=id,displayName,mail,userPrincipalName,jobTitle,accountEnabled&$top=999',
    'the user directory (needs User.Read.All); people are taken from team members instead',
  );
  if (users.length) await put('users.json', users);

  // ---- Teams and channels ----
  log('Listing teams…');
  let teams = await tryList<GTeam>(
    '/teams?$select=id,displayName,description,isArchived',
    'the list of teams',
  );
  if (o.teams?.length) {
    const want = new Set(o.teams.map((t) => t.toLowerCase()));
    teams = teams.filter(
      (t) => want.has(t.id.toLowerCase()) || want.has((t.displayName ?? '').toLowerCase()),
    );
    if (!teams.length) throw new Error('None of the requested teams were found');
  }
  let messageCount = 0;
  for (const team of teams) {
    log(`Team "${team.displayName}"`);
    const dir = `teams/${folder(team.id)}/`;
    await put(`${dir}team.json`, team);
    await put(
      `${dir}members.json`,
      await tryList<GMember>(`/teams/${seg(team.id)}/members`, `members of ${team.displayName}`),
    );
    const channels = await tryList<GChannel>(
      `/teams/${seg(team.id)}/channels`,
      `channels of ${team.displayName}`,
    );
    for (const ch of channels) {
      const isPrivate = ch.membershipType === 'private' || ch.membershipType === 'shared';
      if (isPrivate && !o.includePrivateChannels) {
        log(`  #${ch.displayName}: private, skipped (use --include-private-channels)`);
        continue;
      }
      const cdir = `${dir}channels/${folder(ch.id)}/`;
      await put(`${cdir}channel.json`, ch);
      if (isPrivate)
        await put(
          `${cdir}members.json`,
          await tryList<GMember>(
            `/teams/${seg(team.id)}/channels/${seg(ch.id)}/members`,
            `members of ${ch.displayName}`,
          ),
        );
      let messages: GMessage[] = [];
      try {
        messages = await channelMessages(team.id, ch.id);
      } catch (err) {
        if (!(err instanceof GraphError)) throw err;
        warnings.push(
          `Messages of ${team.displayName} / ${ch.displayName} could not be read (${err.status}: ${err.message})`,
        );
      }
      await collectContent(messages);
      await put(`${cdir}messages.json`, messages);
      messageCount += messages.length;
      log(`  #${ch.displayName}: ${messages.length} messages`);
    }
  }

  // ---- Chats (1:1, group and meeting chats) ----
  if (o.includeChats) {
    if (!users.length) throw new Error('Collecting chats needs the user directory (User.Read.All)');
    log('Collecting chats…');
    const seen = new Set<string>();
    for (const u of users) {
      for (const chat of await tryList<GChat>(
        `/users/${seg(u.id)}/chats?$select=id,topic,chatType`,
        `chats of ${u.displayName}`,
      )) {
        if (seen.has(chat.id)) continue;
        seen.add(chat.id);
        const dir = `chats/${folder(chat.id)}/`;
        await put(`${dir}chat.json`, chat);
        await put(
          `${dir}members.json`,
          await tryList<GMember>(`/chats/${seg(chat.id)}/members`, 'chat members'),
        );
        const messages = (
          await tryList<GMessage>(`/chats/${seg(chat.id)}/messages?$top=50`, 'chat messages')
        ).filter(keep);
        await collectContent(messages);
        await put(`${dir}messages.json`, messages);
        messageCount += messages.length;
      }
    }
    log(`  ${seen.size} chats`);
  }

  await put('content/index.json', content);
  const manifest: TeamsManifest = {
    format: TEAMS_FORMAT,
    version: 1,
    tenantId: o.tenantId ?? null,
    collectedAt: new Date().toISOString(),
    collector: `OpenCorpoChat ${VERSION}`,
    options: {
      teams: o.teams ?? [],
      includePrivateChannels: !!o.includePrivateChannels,
      includeChats: !!o.includeChats,
      downloadFiles: !!o.downloadFiles,
      since: o.since ?? null,
    },
    files: hashes,
    warnings,
  };
  await zip.add(TEAMS_MANIFEST, JSON.stringify(manifest, null, 1));
  await zip.close();
  log(`Done: ${teams.length} teams, ${messageCount} messages, ${downloaded} files → ${o.out}`);
  for (const w of warnings) log(`Warning: ${w}`);
  return { teams: teams.length, messages: messageCount, files: downloaded, warnings };
}
