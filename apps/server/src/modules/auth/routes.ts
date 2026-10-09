// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  SetupInput,
  TotpDisableInput,
  TotpEnableInput,
  VERSION,
  type ServerInfo,
  type Session,
} from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  sha256,
  verifyPassword,
  verifyTotp,
} from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../lib/errors.js';
import { route } from '../../lib/route.js';
import { isoIn, nowIso } from '../../lib/time.js';
import { audit } from '../admin/audit.js';
import { createChannel, joinDefaultChannels } from '../channels/service.js';
import { createMessage } from '../messages/service.js';
import { findUserByLogin, insertUser, isUsernameTaken, toMe } from '../users/service.js';
import { finishOidc, startOidc, type OidcState } from './oidc.js';
import { clearSessionCookie, createSession } from './sessions.js';

const LOGIN_LIMIT = { max: 10, timeWindow: '5 minutes' };

export async function userCount(ctx: Ctx) {
  const r = await ctx.db.selectFrom('users').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
  return Number(r?.n ?? 0);
}

export async function findInvite(ctx: Ctx, code: string) {
  const inv = await ctx.db.selectFrom('invites').selectAll().where('code_hash', '=', sha256(code)).executeTakeFirst();
  if (!inv || inv.revoked_at) return null;
  if (inv.expires_at && inv.expires_at < nowIso()) return null;
  if (inv.max_uses != null && inv.uses >= inv.max_uses) return null;
  return inv;
}

function emailDomainAllowed(ctx: Ctx, email: string) {
  const domains = ctx.settings.get().allowSignupDomains;
  if (!domains.length) return true;
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  return domains.includes(d);
}

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/info',
    summary: 'Public server information (used by the login screen)',
    tags: ['auth'],
    auth: 'none',
    handler: async (): Promise<ServerInfo> => {
      const s = ctx.settings.get();
      return {
        setupRequired: !s.setupComplete && (await userCount(ctx)) === 0,
        orgName: s.name,
        iconUrl: s.iconUrl,
        version: VERSION,
        sourceUrl: ctx.config.sourceUrl,
        oidc: { enabled: !!ctx.config.oidc, label: ctx.config.oidc?.label ?? '' },
        ssoOnly: s.ssoOnly && !!ctx.config.oidc,
        calls: { mode: ctx.config.livekit ? 'livekit' : 'mesh' },
        vapidPublicKey: ctx.config.vapid.publicKey,
        maxUploadMb: s.maxUploadMb,
      };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/setup',
    summary: 'First-run setup: create the organization and its owner account',
    tags: ['auth'],
    auth: 'none',
    body: SetupInput,
    rateLimit: LOGIN_LIMIT,
    handler: async ({ body, req, reply }) => {
      if ((await userCount(ctx)) > 0) throw conflict('Setup has already been completed');
      const owner = await insertUser(ctx, {
        email: body.email,
        username: body.username,
        displayName: body.displayName,
        role: 'owner',
        passwordHash: await hashPassword(body.password),
      });
      await ctx.settings.update({ name: body.orgName, setupComplete: true });
      const general = await createChannel(ctx, {
        name: 'general',
        kind: 'public',
        topic: 'Company-wide announcements and work-based matters',
        isDefault: true,
        createdBy: owner.id,
      });
      await createChannel(ctx, {
        name: 'random',
        kind: 'public',
        topic: 'Non-work banter and water-cooler conversation',
        isDefault: true,
        createdBy: owner.id,
      });
      await createMessage(ctx, {
        channel: general,
        userId: owner.id,
        kind: 'system',
        body: `Welcome to ${body.orgName}! This is the start of #general.`,
        skipNotify: true,
      });
      await audit(ctx, { actorId: owner.id, action: 'org.setup', targetType: 'org', ip: req.ip });
      await createSession(ctx, owner.id, req, reply);
      return { me: toMe(owner) };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/auth/login',
    summary: 'Sign in with email/username and password',
    tags: ['auth'],
    auth: 'none',
    body: LoginInput,
    rateLimit: LOGIN_LIMIT,
    handler: async ({ body, req, reply }) => {
      const user = await findUserByLogin(ctx, body.login);
      const ok = await verifyPassword(body.password, user?.password_hash);
      if (!user || !ok || user.role === 'bot') {
        await audit(ctx, { actorId: user?.id ?? null, action: 'auth.login_failed', targetType: 'user', targetId: user?.id, ip: req.ip, metadata: { login: body.login } });
        throw new HttpError(401, 'invalid_credentials', 'Incorrect email/username or password');
      }
      if (user.deactivated_at) throw new HttpError(403, 'deactivated', 'This account has been deactivated');
      if (ctx.settings.get().ssoOnly && ctx.config.oidc && user.role !== 'owner') {
        throw new HttpError(403, 'sso_only', 'Password sign-in is disabled. Use single sign-on.');
      }
      if (user.totp_enabled) {
        if (!body.totp) throw new HttpError(401, 'totp_required', 'Enter your two-factor authentication code');
        let passed = verifyTotp(user.totp_secret ?? '', body.totp);
        if (!passed) {
          // Recovery codes are single-use.
          const codes = json<string[]>(user.recovery_codes, []);
          const h = sha256(body.totp.trim().toLowerCase());
          if (codes.includes(h)) {
            passed = true;
            await ctx.db
              .updateTable('users')
              .set({ recovery_codes: JSON.stringify(codes.filter((c) => c !== h)) })
              .where('id', '=', user.id)
              .execute();
          }
        }
        if (!passed) throw new HttpError(401, 'totp_invalid', 'That two-factor code is not valid');
      }
      await createSession(ctx, user.id, req, reply);
      await audit(ctx, { actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ip: req.ip });
      return { me: toMe(user) };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/auth/logout',
    summary: 'Sign out of the current session',
    tags: ['auth'],
    auth: 'optional',
    handler: async ({ req, reply }) => {
      if (req.auth?.sessionId) {
        await ctx.db.deleteFrom('sessions').where('id', '=', req.auth.sessionId).execute();
        ctx.hub.kick({ sessionId: req.auth.sessionId });
      }
      clearSessionCookie(ctx, reply);
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/auth/invite/:code',
    summary: 'Look up an invite link before registering',
    tags: ['auth'],
    auth: 'none',
    handler: async ({ params }) => {
      const inv = await findInvite(ctx, params.code!);
      if (!inv) throw notFound('Invite');
      return { orgName: ctx.settings.get().name, role: inv.role, email: inv.email };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/auth/register',
    summary: 'Create an account using an invite code',
    tags: ['auth'],
    auth: 'none',
    body: RegisterInput,
    rateLimit: LOGIN_LIMIT,
    handler: async ({ body, req, reply }) => {
      const inv = await findInvite(ctx, body.inviteCode);
      if (!inv) throw badRequest('This invite link is invalid or has expired');
      if (inv.email && inv.email !== body.email) throw badRequest('This invite is for a different email address');
      if (!inv.email && !emailDomainAllowed(ctx, body.email)) throw badRequest('Sign-ups are restricted to approved email domains');
      if (inv.role === 'guest' && !ctx.settings.get().guestsEnabled) throw forbidden('Guest accounts are disabled');
      if (ctx.settings.get().ssoOnly && ctx.config.oidc) throw forbidden('Accounts are created through single sign-on');
      if (await findUserByLogin(ctx, body.email)) throw conflict('An account with that email already exists');
      if (await isUsernameTaken(ctx, body.username)) throw conflict('That username is taken');
      const user = await insertUser(ctx, {
        email: body.email,
        username: body.username,
        displayName: body.displayName,
        role: inv.role as 'member',
        passwordHash: await hashPassword(body.password),
      });
      await ctx.db.updateTable('invites').set((eb) => ({ uses: eb('uses', '+', 1) })).where('id', '=', inv.id).execute();
      await joinDefaultChannels(ctx, user.id, json<string[]>(inv.channel_ids, []));
      await audit(ctx, { actorId: user.id, action: 'user.registered', targetType: 'user', targetId: user.id, ip: req.ip, metadata: { inviteId: inv.id, role: inv.role } });
      await createSession(ctx, user.id, req, reply);
      return { me: toMe(user) };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/auth/password',
    summary: 'Change your password',
    tags: ['auth'],
    body: ChangePasswordInput,
    rateLimit: LOGIN_LIMIT,
    handler: async ({ body, user, auth, ip }) => {
      if (user.password_hash && !(await verifyPassword(body.currentPassword ?? '', user.password_hash))) {
        throw new HttpError(401, 'invalid_credentials', 'Your current password is incorrect');
      }
      await ctx.db.updateTable('users').set({ password_hash: await hashPassword(body.newPassword) }).where('id', '=', user.id).execute();
      // Sign out every other session.
      let q = ctx.db.deleteFrom('sessions').where('user_id', '=', user.id);
      if (auth.sessionId) q = q.where('id', '!=', auth.sessionId);
      await q.execute();
      await audit(ctx, { actorId: user.id, action: 'auth.password_changed', targetType: 'user', targetId: user.id, ip });
    },
  });

  // ----- TOTP 2FA -----
  route(app, ctx, {
    method: 'POST',
    url: '/auth/totp/setup',
    summary: 'Begin two-factor setup: returns a new secret and otpauth URI',
    tags: ['auth'],
    handler: async ({ user }) => {
      const secret = generateTotpSecret();
      const label = encodeURIComponent(`${ctx.settings.get().name}:${user.email}`);
      const issuer = encodeURIComponent(ctx.settings.get().name);
      return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/auth/totp/enable',
    summary: 'Confirm two-factor setup with a code; returns recovery codes',
    tags: ['auth'],
    body: TotpEnableInput,
    handler: async ({ body, user, ip }) => {
      if (!verifyTotp(body.secret, body.code)) throw badRequest('That code is not valid. Check your device clock and try again.');
      const codes = generateRecoveryCodes();
      await ctx.db
        .updateTable('users')
        .set({ totp_secret: body.secret, totp_enabled: 1, recovery_codes: JSON.stringify(codes.map((c) => sha256(c))) })
        .where('id', '=', user.id)
        .execute();
      await audit(ctx, { actorId: user.id, action: 'auth.2fa_enabled', targetType: 'user', targetId: user.id, ip });
      return { recoveryCodes: codes };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/auth/totp/disable',
    summary: 'Turn off two-factor authentication',
    tags: ['auth'],
    body: TotpDisableInput,
    handler: async ({ body, user, ip }) => {
      if (ctx.settings.get().require2fa) throw forbidden('Your organization requires two-factor authentication');
      if (!user.totp_enabled || !verifyTotp(user.totp_secret ?? '', body.code)) throw badRequest('That code is not valid');
      await ctx.db
        .updateTable('users')
        .set({ totp_secret: null, totp_enabled: 0, recovery_codes: null })
        .where('id', '=', user.id)
        .execute();
      await audit(ctx, { actorId: user.id, action: 'auth.2fa_disabled', targetType: 'user', targetId: user.id, ip });
    },
  });

  // ----- Sessions -----
  route(app, ctx, {
    method: 'GET',
    url: '/auth/sessions',
    summary: 'List your active sessions',
    tags: ['auth'],
    handler: async ({ user, auth }): Promise<Session[]> => {
      const rows = await ctx.db
        .selectFrom('sessions')
        .selectAll()
        .where('user_id', '=', user.id)
        .where('expires_at', '>', nowIso())
        .orderBy('last_seen_at', 'desc')
        .execute();
      return rows.map((s) => ({
        id: s.id,
        userAgent: s.user_agent,
        ip: s.ip,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        current: s.id === auth.sessionId,
      }));
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/auth/sessions/:id',
    summary: 'Revoke one of your sessions',
    tags: ['auth'],
    handler: async ({ user, params }) => {
      await ctx.db.deleteFrom('sessions').where('id', '=', params.id!).where('user_id', '=', user.id).execute();
      ctx.hub.kick({ sessionId: params.id! });
    },
  });

  // ----- OIDC SSO -----
  route(app, ctx, {
    method: 'GET',
    url: '/auth/oidc/start',
    summary: 'Start single sign-on (browser redirect)',
    tags: ['auth'],
    auth: 'none',
    query: z.object({ returnTo: z.string().max(500).optional() }),
    handler: async ({ reply, query }) => {
      if (!ctx.config.oidc) throw notFound('SSO');
      const returnTo = query.returnTo?.startsWith('/') && !query.returnTo.startsWith('//') ? query.returnTo : '/';
      const { url, state } = await startOidc(ctx.config, returnTo);
      await ctx.db
        .insertInto('kv')
        .values({ key: `oidc:${state.state}`, value: JSON.stringify(state), expires_at: isoIn(10 * 60_000) })
        .execute();
      reply.setCookie('ocpc_oidc', state.state, {
        path: '/api/v1/auth/oidc',
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.config.secureCookies,
        maxAge: 600,
      });
      return reply.redirect(url);
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/auth/oidc/callback',
    summary: 'Single sign-on callback (browser redirect)',
    tags: ['auth'],
    auth: 'none',
    query: z.object({ code: z.string().max(4000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }),
    handler: async ({ req, reply, query }) => {
      const fail = (msg: string) => reply.redirect(`/login?error=${encodeURIComponent(msg)}`);
      if (!ctx.config.oidc) throw notFound('SSO');
      if (query.error) return fail(`Sign-in was cancelled (${query.error})`);
      if (!query.code || !query.state || req.cookies.ocpc_oidc !== query.state) return fail('Sign-in session expired. Please try again.');
      const kv = await ctx.db.selectFrom('kv').selectAll().where('key', '=', `oidc:${query.state}`).executeTakeFirst();
      await ctx.db.deleteFrom('kv').where('key', '=', `oidc:${query.state}`).execute();
      if (!kv || (kv.expires_at && kv.expires_at < nowIso())) return fail('Sign-in session expired. Please try again.');
      let claims;
      try {
        claims = await finishOidc(ctx.config, query.code, JSON.parse(kv.value) as OidcState);
      } catch (err) {
        ctx.log.warn({ err }, 'OIDC sign-in failed');
        return fail('Single sign-on failed. Contact your administrator.');
      }
      const st = JSON.parse(kv.value) as OidcState;
      const provider = ctx.config.oidc.issuer;
      const email = claims.email?.toLowerCase();
      const ident = await ctx.db
        .selectFrom('identities')
        .select('user_id')
        .where('provider', '=', provider)
        .where('subject', '=', claims.sub)
        .executeTakeFirst();
      let user = ident ? await ctx.db.selectFrom('users').selectAll().where('id', '=', ident.user_id).executeTakeFirst() : undefined;
      if (!user && email) {
        if (claims.email_verified === false) return fail('Your SSO email address is not verified.');
        const domains = ctx.config.oidc.allowedDomains;
        if (domains.length && !domains.includes(email.split('@')[1] ?? '')) return fail('Your email domain is not allowed here.');
        user = await findUserByLogin(ctx, email);
        if (!user && ctx.config.oidc.autoCreate) {
          let base = (claims.preferred_username ?? email.split('@')[0] ?? 'user').toLowerCase().replace(/@.*/, '').replace(/[^a-z0-9._-]/g, '');
          if (base.length < 2) base = `user${base}`;
          base = base.slice(0, 28);
          let username = base;
          for (let i = 2; await isUsernameTaken(ctx, username); i++) username = `${base}${i}`;
          user = await insertUser(ctx, {
            email,
            username,
            displayName: claims.name ?? ([claims.given_name, claims.family_name].filter(Boolean).join(' ') || username),
            role: 'member',
            passwordHash: null,
          });
          await joinDefaultChannels(ctx, user.id);
          await audit(ctx, { actorId: user.id, action: 'user.registered', targetType: 'user', targetId: user.id, ip: req.ip, metadata: { via: 'oidc' } });
        }
        if (user) {
          await ctx.db
            .insertInto('identities')
            .values({ user_id: user.id, provider, subject: claims.sub, created_at: nowIso() })
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
      }
      if (!user) return fail('No account exists for you yet. Ask an administrator for an invite.');
      if (user.deactivated_at) return fail('This account has been deactivated.');
      await createSession(ctx, user.id, req, reply);
      await audit(ctx, { actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ip: req.ip, metadata: { via: 'oidc' } });
      return reply.redirect(st.returnTo || '/');
    },
  });
}

