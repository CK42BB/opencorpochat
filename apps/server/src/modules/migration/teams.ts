// SPDX-License-Identifier: AGPL-3.0-only
// Reader for Microsoft Teams archives made by `ocpc collect-teams` (teams-collect.ts).
// The archive holds unmodified JSON from the publicly documented Microsoft Graph API
// (team, channel, chat, conversationMember, chatMessage and user resources), so it can
// be inspected and kept as a record of exactly what was collected.
// "Microsoft Teams" is a trademark of Microsoft; it is used here only to describe the source.
import { htmlToMarkdown } from './html.js';
import type {
  Archive,
  MigrationSource,
  SourceChannel,
  SourceFile,
  SourceMessage,
  SourceUser,
} from './model.js';

export const TEAMS_MANIFEST = 'ocpc-teams-manifest.json';
export const TEAMS_FORMAT = 'ocpc-teams-archive';

export interface TeamsManifest {
  format: typeof TEAMS_FORMAT;
  version: 1;
  tenantId: string | null;
  collectedAt: string;
  collector: string;
  options: Record<string, unknown>;
  /** Archive path → SHA-256 of its contents. */
  files: Record<string, string>;
  warnings: string[];
}

/** Downloaded file and image contents, keyed by the URL they came from. */
export type ContentIndex = Record<
  string,
  { path: string; name: string; contentType: string; size: number }
>;

export interface GUser {
  id: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  jobTitle?: string | null;
  accountEnabled?: boolean | null;
}
export interface GMember {
  userId?: string | null;
  displayName?: string | null;
  email?: string | null;
  roles?: string[];
}
export interface GTeam {
  id: string;
  displayName?: string | null;
  description?: string | null;
  isArchived?: boolean | null;
}
export interface GChannel {
  id: string;
  displayName?: string | null;
  description?: string | null;
  membershipType?: 'standard' | 'private' | 'shared' | string | null;
}
export interface GChat {
  id: string;
  topic?: string | null;
  chatType?: 'oneOnOne' | 'group' | 'meeting' | string;
}
export interface GIdentity {
  id?: string | null;
  displayName?: string | null;
}
export interface GMessage {
  id: string;
  replyToId?: string | null;
  messageType?: string;
  createdDateTime: string;
  lastEditedDateTime?: string | null;
  deletedDateTime?: string | null;
  subject?: string | null;
  from?: {
    user?: GIdentity | null;
    application?: GIdentity | null;
    device?: GIdentity | null;
  } | null;
  body?: { contentType?: 'html' | 'text'; content?: string | null };
  attachments?: {
    id?: string;
    contentType?: string;
    contentUrl?: string | null;
    name?: string | null;
  }[];
  mentions?: { id: number; mentionText?: string; mentioned?: { user?: GIdentity | null } | null }[];
  reactions?: {
    reactionType: string;
    displayName?: string | null;
    user?: { user?: GIdentity | null } | null;
  }[];
}

/** Legacy reaction names; newer reactions are already Unicode emoji. */
const REACTIONS: Record<string, string> = {
  like: '👍',
  heart: '❤️',
  laugh: '😆',
  surprised: '😮',
  sad: '😢',
  angry: '😡',
};

export function readTeams(a: Archive): MigrationSource {
  const prefix = a.files.find((f) => f.endsWith(TEAMS_MANIFEST))!.slice(0, -TEAMS_MANIFEST.length);
  const p = (n: string) => `${prefix}${n}`;
  const manifest = a.json<TeamsManifest>(p(TEAMS_MANIFEST));
  if (manifest.format !== TEAMS_FORMAT || manifest.version !== 1)
    throw new Error('Unsupported Teams archive version');
  const warnings = [...(manifest.warnings ?? [])];
  const content: ContentIndex = a.has(p('content/index.json'))
    ? a.json<ContentIndex>(p('content/index.json'))
    : {};

  // People: the directory if it was collected, plus anyone seen as a member.
  const users = new Map<string, SourceUser>();
  const addUser = (
    id: string | null | undefined,
    name?: string | null,
    email?: string | null,
    extra: Partial<SourceUser> = {},
  ) => {
    if (!id) return;
    const prev = users.get(id);
    const mail = (email || prev?.email || '').toLowerCase() || undefined;
    users.set(id, {
      id,
      email: mail,
      username:
        prev?.username ??
        (mail?.split('@')[0] || (name ?? '').replace(/\s+/g, '.') || id.slice(0, 8)),
      displayName: prev?.displayName ?? (name || mail || id),
      ...prev,
      ...extra,
      ...(mail ? { email: mail } : {}),
    });
  };
  if (a.has(p('users.json'))) {
    for (const u of a.json<GUser[]>(p('users.json'))) {
      const mail = u.mail || (u.userPrincipalName?.includes('#EXT#') ? null : u.userPrincipalName);
      addUser(u.id, u.displayName, mail, {
        title: u.jobTitle ?? undefined,
        deleted: u.accountEnabled === false,
        username: (mail?.split('@')[0] ?? u.displayName ?? u.id).toLowerCase(),
        displayName: u.displayName || mail || u.id,
      });
    }
  }
  const members = (file: string) => (a.has(file) ? a.json<GMember[]>(file) : []);

  const channels: SourceChannel[] = [];
  const folders = new Map<string, string>();
  for (const teamFile of a.files.filter(
    (f) => f.startsWith(p('teams/')) && f.endsWith('/team.json'),
  )) {
    const dir = teamFile.slice(0, -'team.json'.length);
    const team = a.json<GTeam>(teamFile);
    const teamMembers = members(`${dir}members.json`);
    for (const m of teamMembers) addUser(m.userId, m.displayName, m.email);
    const teamName = team.displayName || 'team';
    for (const chFile of a.files.filter(
      (f) => f.startsWith(`${dir}channels/`) && f.endsWith('/channel.json'),
    )) {
      const cdir = chFile.slice(0, -'channel.json'.length);
      const ch = a.json<GChannel>(chFile);
      const isPrivate = ch.membershipType === 'private' || ch.membershipType === 'shared';
      const chMembers = isPrivate ? members(`${cdir}members.json`) : teamMembers;
      for (const m of chMembers) addUser(m.userId, m.displayName, m.email);
      const general = (ch.displayName ?? '').toLowerCase() === 'general';
      channels.push({
        id: ch.id,
        name: general ? teamName : `${teamName}-${ch.displayName ?? 'channel'}`,
        kind: isPrivate ? 'private' : 'public',
        topic: '',
        description: (general ? team.description : ch.description) ?? '',
        memberIds: chMembers.map((m) => m.userId).filter((x): x is string => !!x),
        archived: !!team.isArchived,
        group: teamName,
      });
      folders.set(ch.id, cdir);
    }
  }
  for (const chatFile of a.files.filter(
    (f) => f.startsWith(p('chats/')) && f.endsWith('/chat.json'),
  )) {
    const dir = chatFile.slice(0, -'chat.json'.length);
    const chat = a.json<GChat>(chatFile);
    const chatMembers = members(`${dir}members.json`);
    for (const m of chatMembers) addUser(m.userId, m.displayName, m.email);
    const ids = chatMembers.map((m) => m.userId).filter((x): x is string => !!x);
    channels.push({
      id: chat.id,
      name:
        chat.topic ||
        chatMembers
          .map((m) => m.displayName ?? '')
          .filter(Boolean)
          .join(', ') ||
        'chat',
      kind: chat.chatType === 'oneOnOne' ? 'dm' : 'group_dm',
      memberIds: ids,
      group: 'Chats',
    });
    folders.set(chat.id, dir);
  }

  function file(url: string, fallbackName: string): SourceFile {
    const hit = content[url];
    return {
      id: hit?.path ?? url,
      name: hit?.name || fallbackName,
      mime: hit?.contentType,
      size: hit?.size,
      read: hit ? () => a.read(p(hit.path)) : undefined,
      link: /^https:\/\/graph\.microsoft\.com\//.test(url) ? undefined : url,
    };
  }

  function* messages(channelId: string): Iterable<SourceMessage> {
    const dir = folders.get(channelId);
    if (!dir || !a.has(`${dir}messages.json`)) return;
    const all = a
      .json<GMessage[]>(`${dir}messages.json`)
      .filter((m) => (m.messageType ?? 'message') === 'message' && !m.deletedDateTime)
      .sort((x, y) =>
        x.createdDateTime < y.createdDateTime ? -1 : x.createdDateTime > y.createdDateTime ? 1 : 0,
      );
    for (const m of all) {
      const files: SourceFile[] = [];
      const mentions = new Map((m.mentions ?? []).map((x) => [String(x.id), x]));
      const raw = m.body?.content ?? '';
      let text =
        m.body?.contentType === 'text'
          ? raw
          : htmlToMarkdown(raw, {
              mention: (id) => {
                const userId = mentions.get(id)?.mentioned?.user?.id;
                return userId ? `<@${userId}>` : undefined;
              },
              image: (src, alt) => {
                if (!src) return alt;
                files.push(file(src, alt || 'image.png'));
                return '';
              },
            });
      if (m.subject) text = `**${m.subject}**\n${text}`;
      for (const att of m.attachments ?? []) {
        if (att.contentType === 'reference' && att.contentUrl)
          files.push(file(att.contentUrl, att.name || 'file'));
        else if (att.contentType?.startsWith('application/vnd.microsoft.card'))
          text = [text, '_(A card from an app was not imported.)_'].filter(Boolean).join('\n');
      }
      const user = m.from?.user;
      yield {
        id: `${channelId}/${m.id}`,
        userId: user?.id ?? undefined,
        authorName: (m.from?.application?.displayName || user?.displayName) ?? undefined,
        text,
        createdAt: new Date(m.createdDateTime).toISOString(),
        editedAt: m.lastEditedDateTime ? new Date(m.lastEditedDateTime).toISOString() : undefined,
        threadId: m.replyToId ? `${channelId}/${m.replyToId}` : undefined,
        reactions: Object.values(
          (m.reactions ?? []).reduce<Record<string, { emoji: string; userIds: string[] }>>(
            (acc, r) => {
              const emoji = REACTIONS[r.reactionType] ?? r.reactionType;
              const uid = r.user?.user?.id;
              if (!uid || !emoji) return acc;
              (acc[emoji] ??= { emoji, userIds: [] }).userIds.push(uid);
              return acc;
            },
            {},
          ),
        ),
        files,
      };
    }
  }

  return {
    kind: 'teams',
    label: `Microsoft Teams${manifest.tenantId ? ` tenant ${manifest.tenantId}` : ''}, collected ${manifest.collectedAt.slice(0, 10)}`,
    users: [...users.values()],
    channels,
    messages,
    downloadHosts: [],
    warnings,
    close: () => a.close(),
  };
}
