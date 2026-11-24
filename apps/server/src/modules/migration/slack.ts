// SPDX-License-Identifier: AGPL-3.0-only
// Reader for the publicly documented Slack workspace export format: a ZIP with users.json,
// channels.json (public channels) and, in exports that include them, groups.json (private
// channels), dms.json (direct messages) and mpims.json (group direct messages). Each
// conversation has a folder of daily JSON files.
// "Slack" is a trademark of its owner; it is used here only to describe the file format.
import type {
  Archive,
  MigrationSource,
  SourceChannel,
  SourceChannelKind,
  SourceFile,
  SourceMessage,
  SourceUser,
} from './model.js';

interface SUser {
  id: string;
  name: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  real_name?: string;
  profile?: { email?: string; real_name?: string; display_name?: string; title?: string };
}
interface SChannel {
  id: string;
  name?: string;
  topic?: { value?: string };
  purpose?: { value?: string };
  members?: string[];
  is_archived?: boolean;
}
interface SFile {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  size?: number;
  mode?: string;
  url_private?: string;
  url_private_download?: string;
  permalink?: string;
}
interface SMessage {
  type: string;
  subtype?: string;
  user?: string;
  username?: string;
  bot_profile?: { name?: string };
  text?: string;
  ts: string;
  thread_ts?: string;
  edited?: { ts?: string };
  reactions?: { name: string; users: string[] }[];
  files?: SFile[];
}

/** Subtypes that are real messages. Join/leave/topic notices and similar are skipped. */
const KEEP_SUBTYPES = new Set(['bot_message', 'thread_broadcast', 'me_message', 'file_share']);

const tsToIso = (ts: string) => new Date(Math.floor(Number(ts) * 1000)).toISOString();

/** Convert Slack markup to Markdown. User mentions stay as <@ID> for the engine to resolve. */
export function slackToMarkdown(text: string) {
  // Protect code spans and blocks from formatting conversion.
  const code: string[] = [];
  let s = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => {
    code.push(m);
    return `\uE000${code.length - 1}\uE001`;
  });
  s = s
    .replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, '<@$1>')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<#([A-Z0-9]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, '$1')
    .replace(/<!date\^\d+\^[^|>]*\|([^>]+)>/g, '$1')
    .replace(/<(mailto:[^|>]+)\|([^>]+)>/g, '[$2]($1)')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '[$2]($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/(^|[\s(>])\*([^*\n]+?)\*(?=$|[\s).,!?:;])/gm, '$1**$2**')
    .replace(/(^|[\s(>])~([^~\n]+?)~(?=$|[\s).,!?:;])/gm, '$1~~$2~~')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  // Restore code; its entities are still escaped in the export.
  return s.replace(/\uE000(\d+)\uE001/g, (_, i: string) =>
    code[Number(i)]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  );
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

export function readSlack(a: Archive): MigrationSource {
  const root = a.files.find((f) => /(^|\/)users\.json$/.test(f))!.replace(/users\.json$/, '');
  const list = <T>(name: string): T[] =>
    a.has(`${root}${name}`) ? a.json<T[]>(`${root}${name}`) : [];
  const warnings: string[] = [];

  const sUsers = list<SUser>('users.json');
  const users: SourceUser[] = sUsers.map((u) => ({
    id: u.id,
    email: u.profile?.email?.toLowerCase() || undefined,
    username: u.name || u.id.toLowerCase(),
    displayName: u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id,
    title: u.profile?.title,
    isBot: !!u.is_bot || u.id === 'USLACKBOT',
    deleted: !!u.deleted,
  }));
  const nameOf = new Map(users.map((u) => [u.id, u.username]));

  const channels: SourceChannel[] = [];
  const folders = new Map<string, string>();
  const addAll = (file: string, kind: SourceChannelKind) => {
    for (const c of list<SChannel>(file)) {
      let name = c.name ?? '';
      if (kind === 'dm' || kind === 'group_dm') {
        name = (c.members ?? []).map((m) => nameOf.get(m) ?? m).join(', ');
      }
      channels.push({
        id: c.id,
        name: name || c.id,
        kind,
        topic: c.topic?.value ?? '',
        description: c.purpose?.value ?? '',
        memberIds: c.members ?? [],
        archived: !!c.is_archived,
      });
      // DMs are stored in a folder named after the conversation id; channels and
      // group DMs in a folder named after the conversation name.
      const byName = c.name && a.files.some((f) => f.startsWith(`${root}${c.name}/`));
      folders.set(c.id, `${root}${byName ? c.name : c.id}/`);
    }
  };
  addAll('channels.json', 'public');
  addAll('groups.json', 'private');
  addAll('dms.json', 'dm');
  addAll('mpims.json', 'group_dm');
  if (!a.has(`${root}groups.json`) && !a.has(`${root}dms.json`))
    warnings.push(
      'This export contains public channels only. Private channels and direct messages are included only in exports made by an owner with permission to export all conversations.',
    );

  function toFile(f: SFile): SourceFile | null {
    if (f.mode === 'tombstone' || f.mode === 'hidden_by_limit') return null;
    const name = f.name || f.title || f.id;
    return {
      id: f.id,
      name,
      mime: f.mimetype,
      size: f.size,
      url: f.mode === 'external' ? undefined : f.url_private_download || f.url_private,
      link: f.permalink || f.url_private,
    };
  }

  function* messages(channelId: string): Iterable<SourceMessage> {
    const folder = folders.get(channelId);
    if (!folder) return;
    const dayFiles = a.files.filter((f) => f.startsWith(folder) && f.endsWith('.json')).sort();
    const all: SMessage[] = [];
    for (const df of dayFiles) {
      try {
        all.push(...a.json<SMessage[]>(df));
      } catch {
        warnings.push(`Skipped unreadable file ${df}`);
      }
    }
    all.sort((x, y) => Number(x.ts) - Number(y.ts));
    for (const m of all) {
      if (m.type !== 'message' || (m.subtype && !KEEP_SUBTYPES.has(m.subtype))) continue;
      const isReply = !!m.thread_ts && m.thread_ts !== m.ts;
      const text = slackToMarkdown(m.text ?? '');
      yield {
        id: `${channelId}/${m.ts}`,
        userId: m.subtype === 'bot_message' ? undefined : m.user,
        authorName: m.bot_profile?.name || m.username || undefined,
        text: m.subtype === 'me_message' ? `_${text}_` : text,
        createdAt: tsToIso(m.ts),
        editedAt: m.edited?.ts ? tsToIso(m.edited.ts) : undefined,
        threadId: isReply ? `${channelId}/${m.thread_ts}` : undefined,
        alsoInChannel: m.subtype === 'thread_broadcast',
        reactions: (m.reactions ?? []).map((r) => ({
          emoji: `:${r.name.replace(/::skin-tone-\d$/, '')}:`,
          userIds: r.users,
        })),
        files: (m.files ?? []).map(toFile).filter((f): f is SourceFile => !!f),
      };
    }
  }

  return {
    kind: 'slack',
    label: 'Slack-format workspace export',
    users,
    channels: channels.map((c) =>
      c.kind === 'public' || c.kind === 'private' ? { ...c, name: slug(c.name) } : c,
    ),
    messages,
    downloadHosts: ['files.slack.com', 'slack-files.com', 'slack-edge.com'],
    warnings,
    close: () => a.close(),
  };
}
