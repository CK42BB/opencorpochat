// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AdminUpdateUserInput,
  canChangeRole,
  CreateInviteInput,
  OrgSettingsInput,
  password,
  type AuditEntry,
  type Invite,
  type Role,
} from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import type { InvitesTable } from '../../db/schema.js';
import { hashPassword, randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { route } from '../../lib/route.js';
import { HOUR, isoIn, nowIso } from '../../lib/time.js';
import { sendMail } from '../notifications/email.js';
import {
  findUserByLogin,
  getUserRow,
  isUsernameTaken,
  publishUser,
  toUser,
} from '../users/service.js';
import { audit } from './audit.js';
import { exportStream } from './export.js';
import { canInvite } from '@ocpc/shared';

function toInvite(i: InvitesTable, code?: string): Invite {
  return {
    id: i.id,
    role: i.role as Role,
    email: i.email,
    maxUses: i.max_uses,
    uses: i.uses,
    expiresAt: i.expires_at,
    createdBy: i.created_by,
    createdAt: i.created_at,
    ...(code ? { code } : {}),
  };
}

export function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  // ----- Org settings -----
  route(app, ctx, {
    method: 'GET',
    url: '/admin/settings',
    summary: 'Organization settings',
    tags: ['admin'],
    auth: 'admin',
    handler: () => ({
      ...ctx.settings.public(),
      server: {
        smtp: !!ctx.config.smtp,
        oidc: !!ctx.config.oidc,
        s3: !!ctx.config.s3,
        turn: ctx.config.turn.urls.length > 0,
        livekit: !!ctx.config.livekit,
        database: ctx.dialect,
        maxUploadCapMb: ctx.config.maxUploadMb,
        publicUrl: ctx.config.publicUrl,
      },
    }),
  });

  route(app, ctx, {
    method: 'PATCH',
    url: '/admin/settings',
    summary: 'Update organization settings',
    tags: ['admin'],
    auth: 'admin',
    body: OrgSettingsInput,
    handler: async ({ user, body, ip }) => {
      if (body.iconFileId) {
        const f = await ctx.db
          .selectFrom('files')
          .select(['mime'])
          .where('id', '=', body.iconFileId)
          .executeTakeFirst();
        if (!f?.mime.startsWith('image/')) throw badRequest('Icon must be an image');
        await ctx.db
          .updateTable('files')
          .set({ purpose: 'org_icon' })
          .where('id', '=', body.iconFileId)
          .execute();
      }
      if (body.ssoOnly && !ctx.config.oidc)
        throw badRequest('Configure OIDC before enabling SSO-only mode');
      await ctx.settings.update(body);
      await audit(ctx, {
        actorId: user.id,
        action: 'settings.updated',
        targetType: 'org',
        ip,
        metadata: body,
      });
      ctx.hub.broadcast('settings.updated', {});
      return ctx.settings.public();
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/admin/test-email',
    summary: 'Send a test email to yourself',
    tags: ['admin'],
    auth: 'admin',
    handler: async ({ user }) => {
      try {
        await sendMail(
          ctx,
          user.email,
          `[${ctx.settings.get().name}] Test email`,
          'Email delivery from OpenCorpoChat is working.',
        );
      } catch (err) {
        throw badRequest(`Email failed: ${(err as Error).message}`);
      }
      return { ok: true };
    },
  });

  // ----- Users -----
  route(app, ctx, {
    method: 'GET',
    url: '/admin/users',
    summary: 'List all accounts with admin details',
    tags: ['admin'],
    auth: 'admin',
    handler: async () => {
      const rows = await ctx.db.selectFrom('users').selectAll().orderBy('username').execute();
      return rows.map((u) => ({
        ...toUser(u),
        email: u.email,
        totpEnabled: !!u.totp_enabled,
        lastSeenAt: u.last_seen_at,
        hasPassword: !!u.password_hash,
        presence: ctx.hub.presenceOf(u.id),
      }));
    },
  });

  route(app, ctx, {
    method: 'PATCH',
    url: '/admin/users/:id',
    summary: 'Change role, deactivate/reactivate, or rename an account',
    tags: ['admin'],
    auth: 'admin',
    body: AdminUpdateUserInput,
    handler: async ({ user, params, body, ip }) => {
      const target = await getUserRow(ctx, params.id!);
      const actor = { id: user.id, role: user.role as Role };
      if (target.role === 'owner' && user.role !== 'owner')
        throw forbidden('Only owners can modify owners');
      if (body.role && body.role !== target.role) {
        if (!canChangeRole(actor, { id: target.id, role: target.role as Role }, body.role))
          throw forbidden();
        if (target.role === 'owner') {
          const owners = await ctx.db
            .selectFrom('users')
            .select('id')
            .where('role', '=', 'owner')
            .where('deactivated_at', 'is', null)
            .execute();
          if (owners.length <= 1) throw badRequest('There must be at least one owner');
        }
      }
      if (body.deactivated !== undefined && target.id === user.id)
        throw badRequest('You cannot deactivate yourself');
      if (
        body.username &&
        body.username !== target.username &&
        (await isUsernameTaken(ctx, body.username, target.id))
      )
        throw conflict('That username is taken');
      if (body.email && body.email !== target.email) {
        const other = await findUserByLogin(ctx, body.email);
        if (other && other.id !== target.id) throw conflict('That email is in use');
      }
      await ctx.db
        .updateTable('users')
        .set({
          role: body.role,
          username: body.username,
          email: body.email,
          display_name: body.displayName,
          deactivated_at:
            body.deactivated === undefined ? undefined : body.deactivated ? nowIso() : null,
        })
        .where('id', '=', target.id)
        .execute();
      if (body.deactivated) {
        await ctx.db.deleteFrom('sessions').where('user_id', '=', target.id).execute();
        ctx.hub.kick({ userId: target.id });
      }
      await audit(ctx, {
        actorId: user.id,
        action: 'user.updated',
        targetType: 'user',
        targetId: target.id,
        ip,
        metadata: body,
      });
      return toUser(await publishUser(ctx, target.id));
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/admin/users/:id/reset-2fa',
    summary: 'Remove two-factor authentication from an account (lost device)',
    tags: ['admin'],
    auth: 'admin',
    handler: async ({ user, params, ip }) => {
      const target = await getUserRow(ctx, params.id!);
      if (target.role === 'owner' && user.role !== 'owner') throw forbidden();
      await ctx.db
        .updateTable('users')
        .set({ totp_enabled: 0, totp_secret: null, recovery_codes: null })
        .where('id', '=', target.id)
        .execute();
      await audit(ctx, {
        actorId: user.id,
        action: 'user.2fa_reset',
        targetType: 'user',
        targetId: target.id,
        ip,
      });
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/admin/users/:id/password-reset',
    summary: 'Create a one-time password reset link (valid 24h) to hand to the person',
    tags: ['admin'],
    auth: 'admin',
    handler: async ({ user, params, ip }) => {
      const target = await getUserRow(ctx, params.id!);
      if (target.role === 'owner' && user.role !== 'owner') throw forbidden();
      if (target.role === 'bot') throw badRequest('Bots do not have passwords');
      const token = randomToken();
      await ctx.db
        .insertInto('kv')
        .values({ key: `pwreset:${sha256(token)}`, value: target.id, expires_at: isoIn(24 * HOUR) })
        .execute();
      await audit(ctx, {
        actorId: user.id,
        action: 'user.password_reset_issued',
        targetType: 'user',
        targetId: target.id,
        ip,
      });
      const link = `${ctx.config.publicUrl}/reset/${token}`;
      let emailed = false;
      if (ctx.config.smtp) {
        try {
          await sendMail(
            ctx,
            target.email,
            `[${ctx.settings.get().name}] Reset your password`,
            `An administrator created a password reset link for you:\n\n${link}\n\nIt expires in 24 hours.`,
          );
          emailed = true;
        } catch {
          /* fall back to showing the link */
        }
      }
      return { link, emailed };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/auth/reset',
    summary: 'Set a new password using a reset link',
    tags: ['auth'],
    auth: 'none',
    body: z.object({ token: z.string().max(200), password }),
    rateLimit: { max: 10, timeWindow: '5 minutes' },
    handler: async ({ body, ip }) => {
      const key = `pwreset:${sha256(body.token)}`;
      const kv = await ctx.db
        .selectFrom('kv')
        .selectAll()
        .where('key', '=', key)
        .executeTakeFirst();
      if (!kv || (kv.expires_at && kv.expires_at < nowIso()))
        throw badRequest('This reset link is invalid or has expired');
      await ctx.db.deleteFrom('kv').where('key', '=', key).execute();
      await ctx.db
        .updateTable('users')
        .set({ password_hash: await hashPassword(body.password) })
        .where('id', '=', kv.value)
        .execute();
      await ctx.db.deleteFrom('sessions').where('user_id', '=', kv.value).execute();
      ctx.hub.kick({ userId: kv.value });
      await audit(ctx, {
        actorId: kv.value,
        action: 'auth.password_reset',
        targetType: 'user',
        targetId: kv.value,
        ip,
      });
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/admin/users/:id/export',
    summary: "Export one person's data (data-subject access request), as NDJSON",
    tags: ['admin'],
    auth: 'admin',
    handler: async ({ user, params, reply, ip }) => {
      const target = await getUserRow(ctx, params.id!);
      await audit(ctx, {
        actorId: user.id,
        action: 'user.exported',
        targetType: 'user',
        targetId: target.id,
        ip,
      });
      reply.header('Content-Type', 'application/x-ndjson');
      reply.header(
        'Content-Disposition',
        `attachment; filename="user-${target.username}-export.ndjson"`,
      );
      return reply.send(exportStream(ctx, { userId: target.id }));
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/admin/users/:id',
    summary: 'Erase an account: removes their messages, files and personal data (irreversible)',
    tags: ['admin'],
    auth: 'admin',
    handler: async ({ user, params, ip }) => {
      const target = await getUserRow(ctx, params.id!);
      if (target.id === user.id) throw badRequest('You cannot erase yourself');
      if (target.role === 'owner') throw forbidden('Demote the owner before erasing them');
      const files = await ctx.db
        .selectFrom('files')
        .select(['storage_key'])
        .where('uploader_id', '=', target.id)
        .execute();
      const tag = `deleted-${target.id.slice(-8).toLowerCase()}`;
      await ctx.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('messages')
          .set({ body: '', deleted_at: nowIso(), poll: null, previews: null, forwarded_from: null })
          .where('user_id', '=', target.id)
          .execute();
        for (const t of [
          'reactions',
          'saved_items',
          'thread_follows',
          'poll_votes',
          'mentions',
          'notifications',
          'push_subscriptions',
          'reminders',
          'scheduled_messages',
          'sessions',
          'api_tokens',
          'identities',
          'user_group_members',
          'channel_members',
        ] as const) {
          await trx.deleteFrom(t).where('user_id', '=', target.id).execute();
        }
        await trx.deleteFrom('files').where('uploader_id', '=', target.id).execute();
        await trx
          .updateTable('users')
          .set({
            email: `${tag}@deleted.invalid`,
            username: tag,
            display_name: 'Deleted user',
            full_name: '',
            title: '',
            pronouns: '',
            phone: '',
            avatar_file_id: null,
            status_emoji: '',
            status_text: '',
            password_hash: null,
            totp_secret: null,
            totp_enabled: 0,
            recovery_codes: null,
            preferences: '{}',
            deactivated_at: nowIso(),
          })
          .where('id', '=', target.id)
          .execute();
      });
      for (const f of files) await ctx.storage.delete(f.storage_key).catch(() => {});
      ctx.hub.kick({ userId: target.id });
      await publishUser(ctx, target.id);
      await audit(ctx, {
        actorId: user.id,
        action: 'user.erased',
        targetType: 'user',
        targetId: target.id,
        ip,
      });
    },
  });

  // ----- Invites -----
  route(app, ctx, {
    method: 'GET',
    url: '/invites',
    summary: 'List active invites (admins see all; members see their own)',
    tags: ['admin'],
    auth: 'member',
    handler: async ({ user }) => {
      let q = ctx.db.selectFrom('invites').selectAll().where('revoked_at', 'is', null);
      if (user.role !== 'admin' && user.role !== 'owner') q = q.where('created_by', '=', user.id);
      return (await q.orderBy('created_at', 'desc').execute()).map((i) => toInvite(i));
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/invites',
    summary: 'Create an invite link (the code is shown once)',
    tags: ['admin'],
    auth: 'member',
    body: CreateInviteInput,
    handler: async ({ user, body, ip }) => {
      if (!canInvite({ id: user.id, role: user.role as Role }, body.role))
        throw forbidden('You cannot create that kind of invite');
      if (body.role === 'guest' && !ctx.settings.get().guestsEnabled)
        throw forbidden('Guest accounts are disabled');
      if (body.role === 'guest' && !body.channelIds.length)
        throw badRequest('Choose at least one channel for the guest');
      const code = randomToken(18);
      const row: InvitesTable = {
        id: ulid(),
        code_hash: sha256(code),
        created_by: user.id,
        role: body.role,
        email: body.email ?? null,
        max_uses: body.email ? 1 : body.maxUses,
        uses: 0,
        channel_ids: JSON.stringify(body.channelIds),
        expires_at: body.expiresInHours ? isoIn(body.expiresInHours * HOUR) : null,
        revoked_at: null,
        created_at: nowIso(),
      };
      await ctx.db.insertInto('invites').values(row).execute();
      await audit(ctx, {
        actorId: user.id,
        action: 'invite.created',
        targetType: 'invite',
        targetId: row.id,
        ip,
        metadata: { role: body.role, email: body.email },
      });
      const link = `${ctx.config.publicUrl}/join/${code}`;
      let emailed = false;
      if (body.email && ctx.config.smtp) {
        try {
          await sendMail(
            ctx,
            body.email,
            `You're invited to ${ctx.settings.get().name}`,
            `${user.display_name} invited you to join ${ctx.settings.get().name} on OpenCorpoChat.\n\nAccept the invite: ${link}\n`,
          );
          emailed = true;
        } catch (err) {
          ctx.log.warn({ err }, 'invite email failed');
        }
      }
      return {
        ...toInvite(row, code),
        link,
        emailed,
        channelIds: json<string[]>(row.channel_ids, []),
      };
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/invites/:id',
    summary: 'Revoke an invite',
    tags: ['admin'],
    auth: 'member',
    handler: async ({ user, params, ip }) => {
      const inv = await ctx.db
        .selectFrom('invites')
        .selectAll()
        .where('id', '=', params.id!)
        .executeTakeFirst();
      if (!inv) throw notFound('Invite');
      if (inv.created_by !== user.id && user.role !== 'admin' && user.role !== 'owner')
        throw forbidden();
      await ctx.db
        .updateTable('invites')
        .set({ revoked_at: nowIso() })
        .where('id', '=', inv.id)
        .execute();
      await audit(ctx, {
        actorId: user.id,
        action: 'invite.revoked',
        targetType: 'invite',
        targetId: inv.id,
        ip,
      });
    },
  });

  // ----- Audit log -----
  route(app, ctx, {
    method: 'GET',
    url: '/admin/audit',
    summary: 'Audit log (newest first)',
    tags: ['admin'],
    auth: 'admin',
    query: z.object({
      before: z.string().max(64).optional(),
      action: z.string().max(80).optional(),
      actorId: z.string().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
    handler: async ({ query }): Promise<AuditEntry[]> => {
      let q = ctx.db.selectFrom('audit_log').selectAll();
      if (query.before) q = q.where('id', '<', query.before);
      if (query.action) q = q.where('action', 'like', `${query.action.replace(/[%_]/g, '')}%`);
      if (query.actorId) q = q.where('actor_id', '=', query.actorId);
      const rows = await q.orderBy('id', 'desc').limit(query.limit).execute();
      return rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        metadata: json(r.metadata, {}),
        ip: r.ip,
        createdAt: r.created_at,
      }));
    },
  });

  // ----- Stats -----
  route(app, ctx, {
    method: 'GET',
    url: '/admin/stats',
    summary: 'Usage statistics (computed locally; nothing is sent anywhere)',
    tags: ['admin'],
    auth: 'admin',
    handler: async () => {
      const count = async (t: 'users' | 'channels' | 'messages' | 'files') =>
        Number(
          (
            await ctx.db
              .selectFrom(t)
              .select((eb) => eb.fn.countAll<number>().as('n'))
              .executeTakeFirst()
          )?.n ?? 0,
        );
      const since = new Date(Date.now() - 30 * 24 * HOUR).toISOString();
      const active = await ctx.db
        .selectFrom('messages')
        .select((eb) => eb.fn.count<number>('user_id').distinct().as('n'))
        .where('created_at', '>=', since)
        .executeTakeFirst();
      const recent = await ctx.db
        .selectFrom('messages')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('created_at', '>=', since)
        .executeTakeFirst();
      const storage = await ctx.db
        .selectFrom('files')
        .select((eb) => eb.fn.sum<number>('size').as('n'))
        .executeTakeFirst();
      const byDay = await ctx.db
        .selectFrom('messages')
        .select(['created_at'])
        .where('created_at', '>=', since)
        .where('kind', '!=', 'system')
        .execute();
      const days: Record<string, number> = {};
      for (const m of byDay) {
        const d = m.created_at.slice(0, 10);
        days[d] = (days[d] ?? 0) + 1;
      }
      return {
        users: await count('users'),
        channels: await count('channels'),
        messages: await count('messages'),
        files: await count('files'),
        storageBytes: Number(storage?.n ?? 0),
        activeUsers30d: Number(active?.n ?? 0),
        messages30d: Number(recent?.n ?? 0),
        messagesByDay: days,
        onlineNow: Object.values(ctx.hub.presenceMap()).filter((p) => p !== 'offline').length,
        connections: ctx.hub.connectionCount(),
      };
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/admin/export',
    summary: 'Export the whole organization as NDJSON',
    tags: ['admin'],
    auth: 'owner',
    handler: async ({ user, reply, ip }) => {
      await audit(ctx, { actorId: user.id, action: 'org.exported', targetType: 'org', ip });
      reply.header('Content-Type', 'application/x-ndjson');
      reply.header(
        'Content-Disposition',
        `attachment; filename="ocpc-export-${new Date().toISOString().slice(0, 10)}.ndjson"`,
      );
      return reply.send(exportStream(ctx));
    },
  });
}
