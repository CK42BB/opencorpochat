// SPDX-License-Identifier: AGPL-3.0-only
// API tokens, bot accounts, incoming/outgoing webhooks.
import type { FastifyInstance } from 'fastify';
import {
  CreateBotInput,
  CreateTokenInput,
  CreateWebhookInput,
  IncomingWebhookPayload,
  type ApiToken,
  type Webhook,
} from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import type { ApiTokensTable, WebhooksTable } from '../../db/schema.js';
import { hmacSha256, randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { formatZodError, route } from '../../lib/route.js';
import { postJson } from '../../lib/safe-fetch.js';
import { DAY, isoIn, nowIso } from '../../lib/time.js';
import { audit } from '../admin/audit.js';
import { requireMember } from '../channels/service.js';
import { createMessage } from '../messages/service.js';
import { insertUser, isUsernameTaken, toUser } from '../users/service.js';

function toToken(t: ApiTokensTable, secret?: string): ApiToken {
  return {
    id: t.id,
    name: t.name,
    scopes: json<string[]>(t.scopes, []),
    userId: t.user_id,
    lastUsedAt: t.last_used_at,
    expiresAt: t.expires_at,
    createdAt: t.created_at,
    ...(secret ? { token: secret } : {}),
  };
}

function toWebhook(ctx: Ctx, w: WebhooksTable, secret?: string): Webhook {
  return {
    id: w.id,
    kind: w.kind as Webhook['kind'],
    name: w.name,
    channelId: w.channel_id,
    url: w.url,
    triggerWords: json<string[]>(w.trigger_words, []),
    createdBy: w.created_by,
    createdAt: w.created_at,
    ...(secret && w.kind === 'incoming'
      ? { postUrl: `${ctx.config.publicUrl}/api/v1/hooks/${w.id}/${secret}` }
      : {}),
    ...(secret && w.kind === 'outgoing' ? { secret } : {}),
  };
}

async function issueToken(
  ctx: Ctx,
  userId: string,
  name: string,
  scopes: string[],
  expiresInDays: number | null,
) {
  const secret = `ocpc_${randomToken(32)}`;
  const row: ApiTokensTable = {
    id: ulid(),
    user_id: userId,
    name,
    token_hash: sha256(secret),
    scopes: JSON.stringify(scopes),
    last_used_at: null,
    expires_at: expiresInDays ? isoIn(expiresInDays * DAY) : null,
    created_at: nowIso(),
  };
  await ctx.db.insertInto('api_tokens').values(row).execute();
  return toToken(row, secret);
}

/** Sign an outgoing request: X-OCPC-Signature = sha256=HMAC(secret, `${timestamp}.${body}`). */
export function signatureHeaders(secret: string, body: unknown) {
  const ts = Math.floor(Date.now() / 1000).toString();
  return {
    'x-ocpc-timestamp': ts,
    'x-ocpc-signature': `sha256=${hmacSha256(secret, `${ts}.${JSON.stringify(body)}`)}`,
  };
}

/** Message-created hook: deliver to matching outgoing webhooks. */
export async function runOutgoingWebhooks(ctx: Ctx, messageId: string) {
  const msg = await ctx.db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', messageId)
    .executeTakeFirst();
  if (!msg || msg.kind !== 'user' || msg.edited_at || msg.deleted_at) return;
  const hooks = await ctx.db
    .selectFrom('webhooks')
    .selectAll()
    .where('kind', '=', 'outgoing')
    .where('channel_id', '=', msg.channel_id)
    .execute();
  if (!hooks.length) return;
  const [user, channel] = await Promise.all([
    ctx.db
      .selectFrom('users')
      .select(['id', 'username'])
      .where('id', '=', msg.user_id ?? '')
      .executeTakeFirst(),
    ctx.db
      .selectFrom('channels')
      .selectAll()
      .where('id', '=', msg.channel_id)
      .executeTakeFirstOrThrow(),
  ]);
  for (const h of hooks) {
    const triggers = json<string[]>(h.trigger_words, []);
    const first = msg.body.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const trigger = triggers.find((t) => first === t.toLowerCase()) ?? null;
    if (triggers.length && !trigger) continue;
    const payload = {
      event: 'message.created',
      webhook_id: h.id,
      channel_id: channel.id,
      channel_name: channel.name,
      message_id: msg.id,
      thread_root_id: msg.thread_root_id,
      user_id: user?.id ?? null,
      user_name: user?.username ?? null,
      text: msg.body,
      trigger_word: trigger,
      timestamp: msg.created_at,
    };
    try {
      const res = await postJson(h.url!, payload, signatureHeaders(h.secret ?? '', payload));
      const reply = res.data as { text?: string; username?: string } | null;
      if (res.status < 300 && reply?.text) {
        await createMessage(ctx, {
          channel,
          userId: null,
          kind: 'bot',
          asName: (reply.username ?? h.name).slice(0, 80),
          body: reply.text.slice(0, 40_000),
          threadRootId: msg.thread_root_id,
        });
      }
    } catch (err) {
      ctx.log.warn({ err, webhook: h.id }, 'outgoing webhook failed');
    }
  }
}

export function integrationRoutes(app: FastifyInstance, ctx: Ctx) {
  // ----- Personal access tokens -----
  route(app, ctx, {
    method: 'GET',
    url: '/tokens',
    summary: 'List your personal API tokens',
    tags: ['integrations'],
    handler: async ({ user }) =>
      (
        await ctx.db
          .selectFrom('api_tokens')
          .selectAll()
          .where('user_id', '=', user.id)
          .orderBy('created_at', 'desc')
          .execute()
      ).map((t) => toToken(t)),
  });

  route(app, ctx, {
    method: 'POST',
    url: '/tokens',
    summary: 'Create a personal API token (shown once)',
    tags: ['integrations'],
    body: CreateTokenInput,
    handler: async ({ user, body, auth, ip }) => {
      if (auth.tokenId) throw forbidden('Tokens cannot create other tokens');
      if (body.scopes.includes('admin') && user.role !== 'admin' && user.role !== 'owner')
        throw forbidden('Only admins can create admin-scoped tokens');
      const t = await issueToken(ctx, user.id, body.name, body.scopes, body.expiresInDays);
      await audit(ctx, {
        actorId: user.id,
        action: 'token.created',
        targetType: 'token',
        targetId: t.id,
        ip,
        metadata: { scopes: body.scopes },
      });
      return t;
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/tokens/:id',
    summary: 'Revoke a token',
    tags: ['integrations'],
    handler: async ({ user, params, ip }) => {
      const t = await ctx.db
        .selectFrom('api_tokens')
        .selectAll()
        .where('id', '=', params.id!)
        .executeTakeFirst();
      if (!t) throw notFound('Token');
      const isOwnerOfBot = await ctx.db
        .selectFrom('users')
        .select('id')
        .where('id', '=', t.user_id)
        .where('bot_owner_id', '=', user.id)
        .executeTakeFirst();
      if (t.user_id !== user.id && !isOwnerOfBot && user.role !== 'admin' && user.role !== 'owner')
        throw forbidden();
      await ctx.db.deleteFrom('api_tokens').where('id', '=', t.id).execute();
      await audit(ctx, {
        actorId: user.id,
        action: 'token.revoked',
        targetType: 'token',
        targetId: t.id,
        ip,
      });
    },
  });

  // ----- Bots -----
  route(app, ctx, {
    method: 'GET',
    url: '/bots',
    summary: 'List bot accounts',
    tags: ['integrations'],
    auth: 'member',
    handler: async () => {
      const bots = await ctx.db
        .selectFrom('users')
        .selectAll()
        .where('role', '=', 'bot')
        .orderBy('username')
        .execute();
      return bots.map((b) => ({
        ...toUser(b),
        ownerId: b.bot_owner_id,
        description: b.bot_description,
      }));
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/bots',
    summary: 'Create a bot account (admins). Add it to channels, then create a token for it.',
    tags: ['integrations'],
    auth: 'admin',
    body: CreateBotInput,
    handler: async ({ user, body, ip }) => {
      if (await isUsernameTaken(ctx, body.username)) throw conflict('That username is taken');
      const bot = await insertUser(ctx, {
        email: `${body.username}@bots.invalid`,
        username: body.username,
        displayName: body.displayName,
        role: 'bot',
        passwordHash: null,
        botOwnerId: user.id,
        botDescription: body.description,
      });
      await audit(ctx, {
        actorId: user.id,
        action: 'bot.created',
        targetType: 'user',
        targetId: bot.id,
        ip,
      });
      const token = await issueToken(ctx, bot.id, 'default', ['read', 'write'], null);
      return { bot: toUser(bot), token };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/bots/:id/tokens',
    summary: 'Issue a new token for a bot',
    tags: ['integrations'],
    auth: 'admin',
    body: CreateTokenInput,
    handler: async ({ user, params, body, ip }) => {
      const bot = await ctx.db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', params.id!)
        .where('role', '=', 'bot')
        .executeTakeFirst();
      if (!bot) throw notFound('Bot');
      const t = await issueToken(
        ctx,
        bot.id,
        body.name,
        body.scopes.filter((s) => s !== 'admin'),
        body.expiresInDays,
      );
      await audit(ctx, {
        actorId: user.id,
        action: 'token.created',
        targetType: 'token',
        targetId: t.id,
        ip,
        metadata: { botId: bot.id },
      });
      return t;
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/bots/:id/tokens',
    summary: "List a bot's tokens",
    tags: ['integrations'],
    auth: 'admin',
    handler: async ({ params }) =>
      (
        await ctx.db
          .selectFrom('api_tokens')
          .selectAll()
          .where('user_id', '=', params.id!)
          .orderBy('created_at', 'desc')
          .execute()
      ).map((t) => toToken(t)),
  });

  // ----- Webhooks -----
  route(app, ctx, {
    method: 'GET',
    url: '/webhooks',
    summary: 'List webhooks (admins see all; members see their own)',
    tags: ['integrations'],
    auth: 'member',
    handler: async ({ user }) => {
      let q = ctx.db.selectFrom('webhooks').selectAll();
      if (user.role !== 'admin' && user.role !== 'owner') q = q.where('created_by', '=', user.id);
      return (await q.orderBy('created_at', 'desc').execute()).map((w) => toWebhook(ctx, w));
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/webhooks',
    summary: 'Create an incoming (post into a channel) or outgoing (notify a URL) webhook',
    tags: ['integrations'],
    auth: 'member',
    body: CreateWebhookInput,
    handler: async ({ user, body, ip }) => {
      await requireMember(ctx, user, body.channelId);
      if (body.kind === 'outgoing') {
        if (user.role !== 'admin' && user.role !== 'owner')
          throw forbidden('Only admins can create outgoing webhooks');
        if (!body.url) throw badRequest('Outgoing webhooks need a URL');
      }
      const secret = randomToken(24);
      const row: WebhooksTable = {
        id: ulid(),
        kind: body.kind,
        name: body.name,
        channel_id: body.channelId,
        token_hash: sha256(secret),
        secret: body.kind === 'outgoing' ? secret : null,
        url: body.kind === 'outgoing' ? body.url! : null,
        trigger_words: JSON.stringify(body.triggerWords),
        created_by: user.id,
        created_at: nowIso(),
      };
      await ctx.db.insertInto('webhooks').values(row).execute();
      await audit(ctx, {
        actorId: user.id,
        action: 'webhook.created',
        targetType: 'webhook',
        targetId: row.id,
        ip,
        metadata: { kind: body.kind, channelId: body.channelId },
      });
      return toWebhook(ctx, row, secret);
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/webhooks/:id',
    summary: 'Delete a webhook',
    tags: ['integrations'],
    auth: 'member',
    handler: async ({ user, params, ip }) => {
      const w = await ctx.db
        .selectFrom('webhooks')
        .selectAll()
        .where('id', '=', params.id!)
        .executeTakeFirst();
      if (!w) throw notFound('Webhook');
      if (w.created_by !== user.id && user.role !== 'admin' && user.role !== 'owner')
        throw forbidden();
      await ctx.db.deleteFrom('webhooks').where('id', '=', w.id).execute();
      await audit(ctx, {
        actorId: user.id,
        action: 'webhook.deleted',
        targetType: 'webhook',
        targetId: w.id,
        ip,
      });
    },
  });

  // Incoming webhook endpoint: no session; the secret in the URL authenticates.
  route(app, ctx, {
    method: 'POST',
    url: '/hooks/:id/:token',
    summary: 'Post a message via an incoming webhook. Body: {"text": "...", "username"?: "..."}',
    tags: ['integrations'],
    auth: 'none',
    rateLimit: { max: 60, timeWindow: '1 minute' },
    handler: async ({ params, req }) => {
      const w = await ctx.db
        .selectFrom('webhooks')
        .selectAll()
        .where('id', '=', params.id!)
        .where('kind', '=', 'incoming')
        .executeTakeFirst();
      if (!w || w.token_hash !== sha256(params.token!)) throw unauthorized('Invalid webhook');
      const parsed = IncomingWebhookPayload.safeParse(req.body ?? {});
      if (!parsed.success) throw badRequest(formatZodError(parsed.error));
      const p = parsed.data;
      const parts: string[] = [];
      if (p.text) parts.push(p.text);
      for (const a of p.attachments ?? []) {
        if (a.pretext) parts.push(a.pretext);
        if (a.title)
          parts.push(a.title_link ? `**[${a.title}](${a.title_link})**` : `**${a.title}**`);
        if (a.text) parts.push(a.text);
        else if (!a.title && a.fallback) parts.push(a.fallback);
      }
      const body = parts.join('\n').trim();
      if (!body) throw badRequest('Nothing to post: include "text"');
      const channel = await ctx.db
        .selectFrom('channels')
        .selectAll()
        .where('id', '=', w.channel_id)
        .executeTakeFirstOrThrow();
      if (channel.archived_at) throw forbidden('Channel is archived');
      const msg = await createMessage(ctx, {
        channel,
        userId: null,
        kind: 'bot',
        asName: (p.username ?? w.name).slice(0, 80),
        body,
      });
      return { ok: true, messageId: msg.id };
    },
  });
}
