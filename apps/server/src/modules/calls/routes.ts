// SPDX-License-Identifier: AGPL-3.0-only
// Voice/video calls. Mesh mode: browsers connect peer-to-peer (WebRTC) and the server
// only relays signaling over the WebSocket. LiveKit mode: the server mints access tokens
// for a self-hosted LiveKit SFU and the browser connects to it directly.
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CallInfo, IceServer } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { signJwtHs256 } from '../../lib/crypto.js';
import { ulid } from '../../lib/ids.js';
import { route } from '../../lib/route.js';
import { nowIso } from '../../lib/time.js';
import { memberIds, requireMember } from '../channels/service.js';
import { createMessage } from '../messages/service.js';
import { activeCalls, callInChannel, callsOfConnection, deleteCall, setCall } from './state.js';
import type { Conn } from '../../realtime/hub.js';
import type { CallSignal } from '@ocpc/shared';

const MESH_LIMIT = 8;
const SFU_LIMIT = 100;

export function iceServers(ctx: Ctx, userId: string): IceServer[] {
  const out: IceServer[] = [];
  if (ctx.config.turn.stunUrls.length) out.push({ urls: ctx.config.turn.stunUrls });
  if (ctx.config.turn.urls.length) {
    if (ctx.config.turn.secret) {
      // TURN REST API scheme (coturn use-auth-secret): username = expiry:user, credential = HMAC-SHA1.
      const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${userId}`;
      const credential = createHmac('sha1', ctx.config.turn.secret).update(username).digest('base64');
      out.push({ urls: ctx.config.turn.urls, username, credential });
    } else {
      out.push({ urls: ctx.config.turn.urls });
    }
  }
  return out;
}

function liveKitToken(ctx: Ctx, room: string, identity: string, name: string) {
  const lk = ctx.config.livekit!;
  const now = Math.floor(Date.now() / 1000);
  return signJwtHs256(
    {
      iss: lk.apiKey,
      sub: identity,
      nbf: now - 10,
      exp: now + 6 * 3600,
      name,
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    },
    lk.apiSecret,
  );
}

async function publishCall(ctx: Ctx, channelId: string) {
  const call = callInChannel(channelId);
  await ctx.hub.sendToChannel(channelId, 'call.updated', { call, channelId });
}

async function endCall(ctx: Ctx, call: CallInfo) {
  deleteCall(call.channelId);
  const ended = nowIso();
  await ctx.db.updateTable('calls').set({ ended_at: ended }).where('id', '=', call.id).execute();
  const mins = Math.max(1, Math.round((Date.parse(ended) - Date.parse(call.startedAt)) / 60_000));
  const channel = await ctx.db.selectFrom('channels').selectAll().where('id', '=', call.channelId).executeTakeFirst();
  if (channel) {
    await createMessage(ctx, { channel, userId: call.startedBy, kind: 'system', body: `📞 Call ended · ${mins} min`, skipNotify: true });
  }
  await publishCall(ctx, call.channelId);
}

export async function leaveCall(ctx: Ctx, channelId: string, connectionId: string) {
  const call = callInChannel(channelId);
  if (!call) return;
  const before = call.participants.length;
  call.participants = call.participants.filter((p) => p.connectionId !== connectionId);
  if (call.participants.length === before) return;
  if (call.participants.length === 0) await endCall(ctx, call);
  else await publishCall(ctx, channelId);
}

/** Called by the gateway when a socket disconnects. */
export function onConnectionClosed(ctx: Ctx, conn: Conn) {
  for (const call of callsOfConnection(conn.id)) {
    leaveCall(ctx, call.channelId, conn.id).catch((err) => ctx.log.error({ err }, 'leaveCall failed'));
  }
}

/** Relay a WebRTC signaling frame between two participants of the same call. */
export function relaySignal(ctx: Ctx, from: Conn, frame: { callId: string; toConnectionId: string; signal: CallSignal }) {
  const call = activeCalls().find((c) => c.id === frame.callId);
  if (!call) return;
  const me = call.participants.find((p) => p.connectionId === from.id);
  const them = call.participants.find((p) => p.connectionId === frame.toConnectionId);
  if (!me || !them) return;
  if (frame.signal.kind === 'media') {
    me.audio = !!frame.signal.audio;
    me.video = !!frame.signal.video;
    me.screen = !!frame.signal.screen;
  }
  ctx.hub.sendToConn(them.connectionId, 'call.signal', {
    callId: call.id,
    fromUserId: from.userId,
    fromConnectionId: from.id,
    signal: frame.signal,
  });
}

export function callRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/calls/ice',
    summary: 'ICE (STUN/TURN) servers for WebRTC, with short-lived TURN credentials',
    tags: ['calls'],
    handler: ({ user }) => ({ iceServers: iceServers(ctx, user.id), mode: ctx.config.livekit ? 'livekit' : 'mesh' }),
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/call/join',
    summary: 'Start or join the call in a channel or DM',
    tags: ['calls'],
    body: z.object({
      connectionId: z.string().max(64),
      audio: z.boolean().default(true),
      video: z.boolean().default(false),
    }),
    handler: async ({ user, params, body }) => {
      const { channel } = await requireMember(ctx, user, params.id!);
      if (channel.archived_at) throw forbidden('Channel is archived');
      const conn = ctx.hub.getConn(body.connectionId);
      if (!conn || conn.userId !== user.id) throw badRequest('Unknown realtime connection; reconnect and try again');
      let call = callInChannel(channel.id);
      const isNew = !call;
      if (!call) {
        call = { id: ulid(), channelId: channel.id, startedBy: user.id, startedAt: nowIso(), participants: [] };
        setCall(call);
        await ctx.db
          .insertInto('calls')
          .values({ id: call.id, channel_id: channel.id, started_by: user.id, started_at: call.startedAt, ended_at: null, participant_ids: '[]' })
          .execute();
      }
      // One connection per user: joining from a new tab replaces the old one.
      call.participants = call.participants.filter((p) => p.userId !== user.id);
      const limit = ctx.config.livekit ? SFU_LIMIT : MESH_LIMIT;
      if (call.participants.length >= limit) throw forbidden(`This call is full (${limit} people)`);
      call.participants.push({ userId: user.id, connectionId: body.connectionId, joinedAt: nowIso(), audio: body.audio, video: body.video, screen: false });
      const ids = await ctx.db.selectFrom('calls').select('participant_ids').where('id', '=', call.id).executeTakeFirst();
      const set = new Set<string>(JSON.parse(ids?.participant_ids ?? '[]'));
      set.add(user.id);
      await ctx.db.updateTable('calls').set({ participant_ids: JSON.stringify([...set]) }).where('id', '=', call.id).execute();

      if (isNew) {
        const isDm = channel.kind === 'dm' || channel.kind === 'group_dm';
        if (isDm) {
          const others = (await memberIds(ctx, channel.id)).filter((id) => id !== user.id);
          ctx.hub.sendToUsers(others, 'call.ring', { call, fromUserId: user.id });
        } else {
          await createMessage(ctx, { channel, userId: user.id, kind: 'system', body: `📞 @${user.username} started a huddle`, skipNotify: true });
        }
      }
      await publishCall(ctx, channel.id);
      return {
        call,
        mode: ctx.config.livekit ? 'livekit' : 'mesh',
        iceServers: iceServers(ctx, user.id),
        livekit: ctx.config.livekit
          ? { url: ctx.config.livekit.url, token: liveKitToken(ctx, `ocpc-${channel.id}`, user.id, user.display_name) }
          : null,
      };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/call/leave',
    summary: 'Leave the call in a channel',
    tags: ['calls'],
    body: z.object({ connectionId: z.string().max(64) }),
    handler: async ({ user, params, body }) => {
      const call = callInChannel(params.id!);
      const p = call?.participants.find((x) => x.connectionId === body.connectionId);
      if (!p || p.userId !== user.id) return;
      await leaveCall(ctx, params.id!, body.connectionId);
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/call/decline',
    summary: 'Decline an incoming call',
    tags: ['calls'],
    handler: async ({ user, params }) => {
      const call = callInChannel(params.id!);
      if (!call) return;
      ctx.hub.sendToUsers([call.startedBy], 'notification', {
        notification: { id: ulid(), kind: 'call', channelId: call.channelId, messageId: null, actorId: user.id, text: `${user.display_name} declined the call`, createdAt: nowIso(), read: true },
      });
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/channels/:id/call/media',
    summary: 'Update your microphone/camera/screen-share state',
    tags: ['calls'],
    body: z.object({ connectionId: z.string().max(64), audio: z.boolean(), video: z.boolean(), screen: z.boolean() }),
    handler: async ({ user, params, body }) => {
      const call = callInChannel(params.id!);
      const p = call?.participants.find((x) => x.connectionId === body.connectionId && x.userId === user.id);
      if (!p) return;
      p.audio = body.audio;
      p.video = body.video;
      p.screen = body.screen;
      await publishCall(ctx, params.id!);
    },
  });
}
