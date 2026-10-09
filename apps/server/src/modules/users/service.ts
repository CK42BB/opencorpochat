// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_PREFERENCES, type Me, type Role, type User, type UserPreferences } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { bool, json } from '../../db/index.js';
import type { UsersTable } from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';

export function toUser(row: UsersTable): User {
  const statusActive = !row.status_expires_at || row.status_expires_at > nowIso();
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    fullName: row.full_name,
    title: row.title,
    pronouns: row.pronouns,
    role: row.role as Role,
    avatarUrl: row.avatar_file_id ? `/api/v1/files/${row.avatar_file_id}/avatar` : null,
    timezone: row.timezone,
    statusEmoji: statusActive ? row.status_emoji : '',
    statusText: statusActive ? row.status_text : '',
    statusExpiresAt: statusActive ? row.status_expires_at : null,
    dndUntil: row.dnd_until && row.dnd_until > nowIso() ? row.dnd_until : null,
    deactivated: !!row.deactivated_at,
    isBot: row.role === 'bot',
    createdAt: row.created_at,
  };
}

export function preferencesOf(row: UsersTable): UserPreferences {
  return { ...DEFAULT_PREFERENCES, ...json<Partial<UserPreferences>>(row.preferences, {}) };
}

export function toMe(row: UsersTable): Me {
  return {
    ...toUser(row),
    email: row.email,
    totpEnabled: bool(row.totp_enabled),
    hasPassword: !!row.password_hash,
    preferences: preferencesOf(row),
  };
}

export async function getUserRow(ctx: Ctx, id: string) {
  const row = await ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('User');
  return row;
}

export async function findUserByLogin(ctx: Ctx, login: string) {
  const l = login.trim().toLowerCase();
  return ctx.db
    .selectFrom('users')
    .selectAll()
    .where((eb) => eb.or([eb('email', '=', l), eb('username', '=', l.replace(/^@/, ''))]))
    .executeTakeFirst();
}

/** Users the given user is allowed to see. Guests only see people they share a channel with. */
export async function visibleUsers(ctx: Ctx, viewer: UsersTable): Promise<UsersTable[]> {
  if (viewer.role !== 'guest') {
    return ctx.db.selectFrom('users').selectAll().orderBy('username').execute();
  }
  return ctx.db
    .selectFrom('users')
    .selectAll()
    .where('id', 'in', (eb) =>
      eb
        .selectFrom('channel_members as a')
        .innerJoin('channel_members as b', 'a.channel_id', 'b.channel_id')
        .select('b.user_id')
        .where('a.user_id', '=', viewer.id),
    )
    .orderBy('username')
    .execute();
}

export async function canSeeUser(ctx: Ctx, viewer: UsersTable, targetId: string) {
  if (viewer.role !== 'guest' || viewer.id === targetId) return true;
  const shared = await ctx.db
    .selectFrom('channel_members as a')
    .innerJoin('channel_members as b', 'a.channel_id', 'b.channel_id')
    .select('a.channel_id')
    .where('a.user_id', '=', viewer.id)
    .where('b.user_id', '=', targetId)
    .executeTakeFirst();
  return !!shared;
}

export async function isUsernameTaken(ctx: Ctx, username: string, exceptId?: string) {
  let q = ctx.db.selectFrom('users').select('id').where('username', '=', username);
  if (exceptId) q = q.where('id', '!=', exceptId);
  const groupQ = ctx.db.selectFrom('user_groups').select('id').where('handle', '=', username);
  return !!(await q.executeTakeFirst()) || !!(await groupQ.executeTakeFirst()) || RESERVED.has(username);
}

const RESERVED = new Set(['channel', 'here', 'everyone', 'admin', 'system', 'ocpc']);

export interface NewUser {
  email: string;
  username: string;
  displayName: string;
  role: Role;
  passwordHash: string | null;
  botOwnerId?: string | null;
  botDescription?: string;
}

export async function insertUser(ctx: Ctx, u: NewUser): Promise<UsersTable> {
  const row: UsersTable = {
    id: ulid(),
    email: u.email,
    username: u.username,
    display_name: u.displayName,
    full_name: '',
    title: '',
    pronouns: '',
    phone: '',
    role: u.role,
    avatar_file_id: null,
    timezone: 'UTC',
    status_emoji: '',
    status_text: '',
    status_expires_at: null,
    dnd_until: null,
    password_hash: u.passwordHash,
    totp_secret: null,
    totp_enabled: 0,
    recovery_codes: null,
    preferences: '{}',
    bot_owner_id: u.botOwnerId ?? null,
    bot_description: u.botDescription ?? '',
    deactivated_at: null,
    last_seen_at: null,
    created_at: nowIso(),
  };
  await ctx.db.insertInto('users').values(row).execute();
  ctx.hub.broadcast('user.created', { user: toUser(row) });
  return row;
}

/** Notify everyone that a user's public profile changed. */
export async function publishUser(ctx: Ctx, id: string) {
  const row = await getUserRow(ctx, id);
  ctx.hub.broadcast('user.updated', { user: toUser(row) });
  ctx.hub.setDnd(id, !!(row.dnd_until && row.dnd_until > nowIso()));
  return row;
}
