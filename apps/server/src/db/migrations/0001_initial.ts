// SPDX-License-Identifier: AGPL-3.0-only
// Initial schema. Uses only portable column types (text / integer / bigint) so the
// same migration runs on SQLite and PostgreSQL. Search indexes are dialect-specific.
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '../index.js';

export async function up(db: Kysely<any>, dialect: Dialect): Promise<void> {
  const s = db.schema;

  await s
    .createTable('users')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('email', 'text', (c) => c.notNull())
    .addColumn('username', 'text', (c) => c.notNull())
    .addColumn('display_name', 'text', (c) => c.notNull())
    .addColumn('full_name', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('title', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('pronouns', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('phone', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('role', 'text', (c) => c.notNull())
    .addColumn('avatar_file_id', 'text')
    .addColumn('timezone', 'text', (c) => c.notNull().defaultTo('UTC'))
    .addColumn('status_emoji', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('status_text', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('status_expires_at', 'text')
    .addColumn('dnd_until', 'text')
    .addColumn('password_hash', 'text')
    .addColumn('totp_secret', 'text')
    .addColumn('totp_enabled', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('recovery_codes', 'text')
    .addColumn('preferences', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('bot_owner_id', 'text')
    .addColumn('bot_description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('deactivated_at', 'text')
    .addColumn('last_seen_at', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await s.createIndex('users_email_uq').on('users').column('email').unique().execute();
  await s.createIndex('users_username_uq').on('users').column('username').unique().execute();

  await s
    .createTable('sessions')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('token_hash', 'text', (c) => c.notNull())
    .addColumn('user_agent', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('ip', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('last_seen_at', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'text', (c) => c.notNull())
    .execute();
  await s.createIndex('sessions_token_uq').on('sessions').column('token_hash').unique().execute();
  await s.createIndex('sessions_user_idx').on('sessions').column('user_id').execute();

  await s
    .createTable('identities')
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('provider', 'text', (c) => c.notNull())
    .addColumn('subject', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('identities_pk', ['provider', 'subject'])
    .execute();

  await s
    .createTable('invites')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('code_hash', 'text', (c) => c.notNull())
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('role', 'text', (c) => c.notNull())
    .addColumn('email', 'text')
    .addColumn('max_uses', 'integer')
    .addColumn('uses', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('channel_ids', 'text', (c) => c.notNull().defaultTo('[]'))
    .addColumn('expires_at', 'text')
    .addColumn('revoked_at', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await s.createIndex('invites_code_uq').on('invites').column('code_hash').unique().execute();

  await s
    .createTable('channels')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('topic', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('created_by', 'text')
    .addColumn('is_default', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('is_readonly', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('dm_key', 'text')
    .addColumn('retention_days', 'integer')
    .addColumn('archived_at', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('last_message_at', 'text')
    .execute();
  await s.createIndex('channels_dm_key_uq').on('channels').column('dm_key').unique().execute();
  await s.createIndex('channels_kind_name_idx').on('channels').columns(['kind', 'name']).execute();

  await s
    .createTable('channel_members')
    .addColumn('channel_id', 'text', (c) => c.notNull().references('channels.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('role', 'text', (c) => c.notNull().defaultTo('member'))
    .addColumn('notify_level', 'text', (c) => c.notNull().defaultTo('all'))
    .addColumn('muted', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('starred', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_read_message_id', 'text')
    .addColumn('joined_at', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('channel_members_pk', ['channel_id', 'user_id'])
    .execute();
  await s.createIndex('channel_members_user_idx').on('channel_members').column('user_id').execute();

  await s
    .createTable('messages')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('channel_id', 'text', (c) => c.notNull().references('channels.id').onDelete('cascade'))
    .addColumn('user_id', 'text')
    .addColumn('thread_root_id', 'text')
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull().defaultTo('user'))
    .addColumn('as_name', 'text')
    .addColumn('also_in_channel', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('reply_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_reply_at', 'text')
    .addColumn('poll', 'text')
    .addColumn('previews', 'text')
    .addColumn('forwarded_from', 'text')
    .addColumn('edited_at', 'text')
    .addColumn('deleted_at', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await s.createIndex('messages_channel_idx').on('messages').columns(['channel_id', 'thread_root_id', 'id']).execute();
  await s.createIndex('messages_thread_idx').on('messages').columns(['thread_root_id', 'id']).execute();
  await s.createIndex('messages_user_idx').on('messages').columns(['user_id', 'id']).execute();

  await s
    .createTable('reactions')
    .addColumn('message_id', 'text', (c) => c.notNull().references('messages.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('emoji', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('reactions_pk', ['message_id', 'user_id', 'emoji'])
    .execute();

  await s
    .createTable('mentions')
    .addColumn('message_id', 'text', (c) => c.notNull().references('messages.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('channel_id', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('mentions_pk', ['message_id', 'user_id'])
    .execute();
  await s.createIndex('mentions_user_idx').on('mentions').columns(['user_id', 'channel_id', 'message_id']).execute();

  await s
    .createTable('pins')
    .addColumn('channel_id', 'text', (c) => c.notNull())
    .addColumn('message_id', 'text', (c) => c.notNull().references('messages.id').onDelete('cascade'))
    .addColumn('pinned_by', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('pins_pk', ['channel_id', 'message_id'])
    .execute();

  await s
    .createTable('saved_items')
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('message_id', 'text', (c) => c.notNull().references('messages.id').onDelete('cascade'))
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('saved_items_pk', ['user_id', 'message_id'])
    .execute();

  await s
    .createTable('thread_follows')
    .addColumn('root_id', 'text', (c) => c.notNull().references('messages.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('last_read_at', 'text')
    .addColumn('following', 'integer', (c) => c.notNull().defaultTo(1))
    .addPrimaryKeyConstraint('thread_follows_pk', ['root_id', 'user_id'])
    .execute();
  await s.createIndex('thread_follows_user_idx').on('thread_follows').column('user_id').execute();

  await s
    .createTable('poll_votes')
    .addColumn('message_id', 'text', (c) => c.notNull().references('messages.id').onDelete('cascade'))
    .addColumn('option_id', 'text', (c) => c.notNull())
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('poll_votes_pk', ['message_id', 'option_id', 'user_id'])
    .execute();

  await s
    .createTable('files')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('uploader_id', 'text', (c) => c.notNull())
    .addColumn('purpose', 'text', (c) => c.notNull().defaultTo('attachment'))
    .addColumn('channel_id', 'text')
    .addColumn('message_id', 'text')
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('mime', 'text', (c) => c.notNull())
    .addColumn('size', 'bigint', (c) => c.notNull())
    .addColumn('storage_key', 'text', (c) => c.notNull())
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await s.createIndex('files_message_idx').on('files').column('message_id').execute();
  await s.createIndex('files_channel_idx').on('files').columns(['channel_id', 'id']).execute();

  await s
    .createTable('custom_emoji')
    .addColumn('name', 'text', (c) => c.primaryKey())
    .addColumn('file_id', 'text', (c) => c.notNull())
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();

  await s
    .createTable('user_groups')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('handle', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await s
    .createTable('user_group_members')
    .addColumn('group_id', 'text', (c) => c.notNull().references('user_groups.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('user_group_members_pk', ['group_id', 'user_id'])
    .execute();

  await s
    .createTable('webhooks')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('channel_id', 'text', (c) => c.notNull().references('channels.id').onDelete('cascade'))
    .addColumn('token_hash', 'text', (c) => c.notNull())
    .addColumn('secret', 'text')
    .addColumn('url', 'text')
    .addColumn('trigger_words', 'text', (c) => c.notNull().defaultTo('[]'))
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();

  await s
    .createTable('api_tokens')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('token_hash', 'text', (c) => c.notNull().unique())
    .addColumn('scopes', 'text', (c) => c.notNull())
    .addColumn('last_used_at', 'text')
    .addColumn('expires_at', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();

  await s
    .createTable('slash_commands')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('command', 'text', (c) => c.notNull().unique())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('usage_hint', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('url', 'text', (c) => c.notNull())
    .addColumn('secret', 'text', (c) => c.notNull())
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();

  await s
    .createTable('push_subscriptions')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('endpoint', 'text', (c) => c.notNull().unique())
    .addColumn('p256dh', 'text', (c) => c.notNull())
    .addColumn('auth', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();

  await s
    .createTable('scheduled_messages')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('channel_id', 'text', (c) => c.notNull().references('channels.id').onDelete('cascade'))
    .addColumn('thread_root_id', 'text')
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('send_at', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await s.createIndex('scheduled_send_idx').on('scheduled_messages').column('send_at').execute();

  await s
    .createTable('reminders')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('message_id', 'text')
    .addColumn('text', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('remind_at', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await s.createIndex('reminders_at_idx').on('reminders').column('remind_at').execute();

  await s
    .createTable('notifications')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('channel_id', 'text')
    .addColumn('message_id', 'text')
    .addColumn('actor_id', 'text')
    .addColumn('text', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('read_at', 'text')
    .addColumn('emailed_at', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await s.createIndex('notifications_user_idx').on('notifications').columns(['user_id', 'id']).execute();

  await s
    .createTable('audit_log')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('actor_id', 'text')
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('target_type', 'text', (c) => c.notNull())
    .addColumn('target_id', 'text')
    .addColumn('metadata', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('ip', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();

  await s
    .createTable('org_settings')
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('value', 'text', (c) => c.notNull())
    .execute();

  await s
    .createTable('kv')
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'text')
    .execute();

  await s
    .createTable('calls')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('channel_id', 'text', (c) => c.notNull())
    .addColumn('started_by', 'text', (c) => c.notNull())
    .addColumn('started_at', 'text', (c) => c.notNull())
    .addColumn('ended_at', 'text')
    .addColumn('participant_ids', 'text', (c) => c.notNull().defaultTo('[]'))
    .execute();

  // ----- Full-text search -----
  if (dialect === 'sqlite') {
    await sql`CREATE VIRTUAL TABLE messages_fts USING fts5(body, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`.execute(db);
    await sql`CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body); END`.execute(db);
    await sql`CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body); END`.execute(db);
    await sql`CREATE TRIGGER messages_fts_au AFTER UPDATE OF body ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
      INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body); END`.execute(db);
  } else {
    await sql`ALTER TABLE messages ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED`.execute(db);
    await sql`CREATE INDEX messages_search_idx ON messages USING GIN (search)`.execute(db);
  }
}
