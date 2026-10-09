// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiScope } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { ulid } from '../../lib/ids.js';
import type { AuthInfo } from '../../lib/route.js';
import { DAY, isoIn, nowIso } from '../../lib/time.js';

export const SESSION_COOKIE = 'ocpc_session';
const SESSION_TTL = 30 * DAY;

export async function createSession(ctx: Ctx, userId: string, req: FastifyRequest, reply: FastifyReply) {
  const token = randomToken();
  const id = ulid();
  await ctx.db
    .insertInto('sessions')
    .values({
      id,
      user_id: userId,
      token_hash: sha256(token),
      user_agent: (req.headers['user-agent'] ?? '').slice(0, 300),
      ip: req.ip,
      created_at: nowIso(),
      last_seen_at: nowIso(),
      expires_at: isoIn(SESSION_TTL),
    })
    .execute();
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.secureCookies,
    maxAge: SESSION_TTL / 1000,
  });
  return id;
}

export function clearSessionCookie(ctx: Ctx, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.config.secureCookies });
}

/** Resolve the caller from a session cookie or `Authorization: Bearer <token>`. */
export async function resolveAuth(ctx: Ctx, req: FastifyRequest): Promise<AuthInfo | null> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    const row = await ctx.db
      .selectFrom('api_tokens as t')
      .innerJoin('users as u', 'u.id', 't.user_id')
      .selectAll('u')
      .select(['t.id as token_id', 't.scopes as token_scopes', 't.expires_at as token_expires', 't.last_used_at as token_used'])
      .where('t.token_hash', '=', sha256(token))
      .executeTakeFirst();
    if (!row || row.deactivated_at) return null;
    if (row.token_expires && row.token_expires < nowIso()) return null;
    if (!row.token_used || Date.parse(row.token_used) < Date.now() - 60_000) {
      await ctx.db.updateTable('api_tokens').set({ last_used_at: nowIso() }).where('id', '=', row.token_id).execute();
    }
    const { token_id, token_scopes, token_expires: _e, token_used: _u, ...user } = row;
    return { user, sessionId: null, tokenId: token_id, scopes: json<ApiScope[]>(token_scopes, ['read']) };
  }
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (!cookie) return null;
  return sessionAuth(ctx, cookie);
}

export async function sessionAuth(ctx: Ctx, token: string): Promise<AuthInfo | null> {
  const row = await ctx.db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .selectAll('u')
    .select(['s.id as session_id', 's.expires_at as session_expires', 's.last_seen_at as session_seen'])
    .where('s.token_hash', '=', sha256(token))
    .executeTakeFirst();
  if (!row || row.deactivated_at || row.session_expires < nowIso()) return null;
  // Sliding expiry, written at most every 10 minutes.
  if (Date.parse(row.session_seen) < Date.now() - 10 * 60_000) {
    await ctx.db
      .updateTable('sessions')
      .set({ last_seen_at: nowIso(), expires_at: isoIn(SESSION_TTL) })
      .where('id', '=', row.session_id)
      .execute();
  }
  const { session_id, session_expires: _e, session_seen: _s, ...user } = row;
  return { user, sessionId: session_id, tokenId: null, scopes: null };
}
