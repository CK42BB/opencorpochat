// SPDX-License-Identifier: AGPL-3.0-only
// Kysely table typings. Conventions (portable across SQLite and PostgreSQL):
//  - ids are ULID text; timestamps are ISO-8601 UTC text (sortable)
//  - booleans are integers 0/1; JSON is stored as text
import type { Generated } from 'kysely';

type Bool = number;

export interface UsersTable {
  id: string;
  email: string;
  username: string;
  display_name: string;
  full_name: string;
  title: string;
  pronouns: string;
  phone: string;
  role: string;
  avatar_file_id: string | null;
  timezone: string;
  status_emoji: string;
  status_text: string;
  status_expires_at: string | null;
  dnd_until: string | null;
  password_hash: string | null;
  totp_secret: string | null;
  totp_enabled: Bool;
  recovery_codes: string | null;
  preferences: string;
  bot_owner_id: string | null;
  bot_description: string;
  deactivated_at: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string;
  ip: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export interface IdentitiesTable {
  user_id: string;
  provider: string;
  subject: string;
  created_at: string;
}

export interface InvitesTable {
  id: string;
  code_hash: string;
  created_by: string;
  role: string;
  email: string | null;
  max_uses: number | null;
  uses: number;
  channel_ids: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ChannelsTable {
  id: string;
  kind: string;
  name: string;
  topic: string;
  description: string;
  created_by: string | null;
  is_default: Bool;
  is_readonly: Bool;
  dm_key: string | null;
  retention_days: number | null;
  archived_at: string | null;
  created_at: string;
  last_message_at: string | null;
}

export interface ChannelMembersTable {
  channel_id: string;
  user_id: string;
  role: string;
  notify_level: string;
  muted: Bool;
  starred: Bool;
  last_read_message_id: string | null;
  joined_at: string;
}

export interface MessagesTable {
  id: string;
  channel_id: string;
  user_id: string | null;
  thread_root_id: string | null;
  body: string;
  kind: string;
  as_name: string | null;
  also_in_channel: Bool;
  reply_count: number;
  last_reply_at: string | null;
  poll: string | null;
  previews: string | null;
  forwarded_from: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface ReactionsTable {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface MentionsTable {
  message_id: string;
  user_id: string;
  channel_id: string;
}

export interface PinsTable {
  channel_id: string;
  message_id: string;
  pinned_by: string;
  created_at: string;
}

export interface SavedItemsTable {
  user_id: string;
  message_id: string;
  created_at: string;
}

export interface ThreadFollowsTable {
  root_id: string;
  user_id: string;
  last_read_at: string | null;
  following: Bool;
}

export interface PollVotesTable {
  message_id: string;
  option_id: string;
  user_id: string;
}

export interface FilesTable {
  id: string;
  uploader_id: string;
  purpose: string; // attachment | avatar | emoji | org_icon
  channel_id: string | null;
  message_id: string | null;
  name: string;
  mime: string;
  size: number;
  storage_key: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface CustomEmojiTable {
  name: string;
  file_id: string;
  created_by: string;
  created_at: string;
}

export interface UserGroupsTable {
  id: string;
  handle: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
}

export interface UserGroupMembersTable {
  group_id: string;
  user_id: string;
}

export interface WebhooksTable {
  id: string;
  kind: string;
  name: string;
  channel_id: string;
  token_hash: string;
  secret: string | null;
  url: string | null;
  trigger_words: string;
  created_by: string;
  created_at: string;
}

export interface ApiTokensTable {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  scopes: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface SlashCommandsTable {
  id: string;
  command: string;
  description: string;
  usage_hint: string;
  url: string;
  secret: string;
  created_by: string;
  created_at: string;
}

export interface PushSubscriptionsTable {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export interface ScheduledMessagesTable {
  id: string;
  user_id: string;
  channel_id: string;
  thread_root_id: string | null;
  body: string;
  send_at: string;
  created_at: string;
}

export interface RemindersTable {
  id: string;
  user_id: string;
  message_id: string | null;
  text: string;
  remind_at: string;
  created_at: string;
}

export interface NotificationsTable {
  id: string;
  user_id: string;
  kind: string;
  channel_id: string | null;
  message_id: string | null;
  actor_id: string | null;
  text: string;
  read_at: string | null;
  emailed_at: string | null;
  created_at: string;
}

export interface AuditLogTable {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: string;
  ip: string | null;
  created_at: string;
}

export interface OrgSettingsTable {
  key: string;
  value: string;
}

export interface KvTable {
  key: string;
  value: string;
  expires_at: string | null;
}

export interface CallsTable {
  id: string;
  channel_id: string;
  started_by: string;
  started_at: string;
  ended_at: string | null;
  participant_ids: string;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  identities: IdentitiesTable;
  invites: InvitesTable;
  channels: ChannelsTable;
  channel_members: ChannelMembersTable;
  messages: MessagesTable;
  reactions: ReactionsTable;
  mentions: MentionsTable;
  pins: PinsTable;
  saved_items: SavedItemsTable;
  thread_follows: ThreadFollowsTable;
  poll_votes: PollVotesTable;
  files: FilesTable;
  custom_emoji: CustomEmojiTable;
  user_groups: UserGroupsTable;
  user_group_members: UserGroupMembersTable;
  webhooks: WebhooksTable;
  api_tokens: ApiTokensTable;
  slash_commands: SlashCommandsTable;
  push_subscriptions: PushSubscriptionsTable;
  scheduled_messages: ScheduledMessagesTable;
  reminders: RemindersTable;
  notifications: NotificationsTable;
  audit_log: AuditLogTable;
  org_settings: OrgSettingsTable;
  kv: KvTable;
  calls: CallsTable;
}

// Re-exported so modules don't need to import kysely types directly.
export type { Generated };
