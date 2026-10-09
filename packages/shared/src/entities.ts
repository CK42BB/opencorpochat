// SPDX-License-Identifier: AGPL-3.0-only
// Wire-format entity types shared by server and clients.

export type Role = 'owner' | 'admin' | 'member' | 'guest' | 'bot';
export type ChannelKind = 'public' | 'private' | 'dm' | 'group_dm';
export type NotifyLevel = 'all' | 'mentions' | 'none';
export type Presence = 'online' | 'away' | 'offline' | 'dnd';
export type MessageKind = 'user' | 'system' | 'bot';

export interface User {
  id: string;
  username: string;
  displayName: string;
  fullName: string;
  title: string;
  pronouns: string;
  role: Role;
  avatarUrl: string | null;
  timezone: string;
  statusEmoji: string;
  statusText: string;
  statusExpiresAt: string | null;
  dndUntil: string | null;
  deactivated: boolean;
  isBot: boolean;
  createdAt: string;
}

/** The signed-in user, with private fields. */
export interface Me extends User {
  email: string;
  totpEnabled: boolean;
  hasPassword: boolean;
  preferences: UserPreferences;
}

export interface UserPreferences {
  theme: 'system' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
  enterToSend: boolean;
  emailNotifications: boolean;
  emailDelayMinutes: number;
  keywords: string[];
  notifySchedule: { enabled: boolean; start: string; end: string; days: number[] };
  sidebarSections: { id: string; name: string; channelIds: string[] }[];
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  density: 'comfortable',
  enterToSend: true,
  emailNotifications: true,
  emailDelayMinutes: 15,
  keywords: [],
  notifySchedule: { enabled: false, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  sidebarSections: [],
};

export interface Channel {
  id: string;
  kind: ChannelKind;
  name: string;
  topic: string;
  description: string;
  createdBy: string | null;
  isDefault: boolean;
  isReadonly: boolean;
  archived: boolean;
  createdAt: string;
  lastMessageAt: string | null;
  memberCount: number;
  /** For DMs / group DMs: the member user ids. */
  dmUserIds?: string[];
}

export interface Membership {
  channelId: string;
  userId: string;
  role: 'admin' | 'member';
  notifyLevel: NotifyLevel;
  muted: boolean;
  starred: boolean;
  lastReadMessageId: string | null;
  joinedAt: string;
}

/** Channel as seen in the sidebar of the current user. */
export interface MyChannel extends Channel {
  membership: Membership;
  unreadCount: number;
  mentionCount: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface FileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  uploaderId: string;
  channelId: string | null;
  messageId: string | null;
  createdAt: string;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  siteName: string;
  imageUrl: string | null;
}

export interface PollOption {
  id: string;
  text: string;
  voterIds: string[];
}

export interface Poll {
  question: string;
  options: PollOption[];
  multiple: boolean;
  anonymous: boolean;
  closed: boolean;
}

export interface Message {
  id: string;
  channelId: string;
  userId: string | null;
  threadRootId: string | null;
  body: string;
  kind: MessageKind;
  /** Display name override for webhook / bot posts. */
  asName: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  replyCount: number;
  lastReplyAt: string | null;
  replyUserIds: string[];
  alsoInChannel: boolean;
  reactions: ReactionSummary[];
  files: FileInfo[];
  pinned: boolean;
  saved: boolean;
  previews: LinkPreview[];
  poll: Poll | null;
  forwardedFrom: { messageId: string; channelId: string; userId: string | null } | null;
}

export interface Invite {
  id: string;
  code?: string;
  role: Role;
  email: string | null;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface UserGroup {
  id: string;
  handle: string;
  name: string;
  description: string;
  memberIds: string[];
}

export interface CustomEmoji {
  name: string;
  url: string;
  createdBy: string;
}

export interface Session {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  userId: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** Only returned once, at creation. */
  token?: string;
}

export interface Webhook {
  id: string;
  kind: 'incoming' | 'outgoing';
  name: string;
  channelId: string;
  url: string | null;
  triggerWords: string[];
  createdBy: string;
  createdAt: string;
  /** Incoming: the full post URL (only at creation). Outgoing: signing secret (only at creation). */
  secret?: string;
  postUrl?: string;
}

export interface SlashCommand {
  id: string;
  command: string;
  description: string;
  usageHint: string;
  url: string;
  createdBy: string;
  createdAt: string;
  secret?: string;
}

export interface ScheduledMessage {
  id: string;
  channelId: string;
  threadRootId: string | null;
  body: string;
  sendAt: string;
}

export interface Reminder {
  id: string;
  messageId: string | null;
  text: string;
  remindAt: string;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export interface OrgSettings {
  name: string;
  iconUrl: string | null;
  allowSignupDomains: string[];
  require2fa: boolean;
  ssoOnly: boolean;
  guestsEnabled: boolean;
  retentionDays: number | null;
  linkPreviews: boolean;
  readReceipts: boolean;
  maxUploadMb: number;
  allowedMimePrefixes: string[];
  defaultChannelIds: string[];
  messageEditWindowMinutes: number | null;
}

export interface ServerInfo {
  setupRequired: boolean;
  orgName: string;
  iconUrl: string | null;
  version: string;
  sourceUrl: string;
  oidc: { enabled: boolean; label: string };
  ssoOnly: boolean;
  calls: { mode: 'mesh' | 'livekit' };
  vapidPublicKey: string | null;
  maxUploadMb: number;
}

export interface Notification {
  id: string;
  kind: 'mention' | 'dm' | 'thread_reply' | 'keyword' | 'reminder' | 'call';
  channelId: string | null;
  messageId: string | null;
  actorId: string | null;
  text: string;
  createdAt: string;
  read: boolean;
}

export interface CallParticipant {
  userId: string;
  connectionId: string;
  joinedAt: string;
  audio: boolean;
  video: boolean;
  screen: boolean;
}

export interface CallInfo {
  id: string;
  channelId: string;
  startedBy: string;
  startedAt: string;
  participants: CallParticipant[];
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
