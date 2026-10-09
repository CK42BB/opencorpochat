// SPDX-License-Identifier: AGPL-3.0-only
// WebSocket endpoint: GET /api/v1/ws (session cookie or ?token=<api token>).
import type { FastifyInstance } from 'fastify';
import type { ClientFrame } from '@ocpc/shared';
import type { Ctx } from '../context.js';
import { ulid } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { resolveAuth } from '../modules/auth/sessions.js';
import { relaySignal } from '../modules/calls/routes.js';
import type { Conn } from './hub.js';

const TYPING_THROTTLE_MS = 2500;

export function gatewayRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/ws', { websocket: true }, async (socket, req) => {
    // Browsers can't set headers on WebSocket; bots may pass ?token=.
    const q = req.query as { token?: string };
    if (q.token && !req.headers.authorization) req.headers.authorization = `Bearer ${q.token}`;
    const auth = req.auth ?? (await resolveAuth(ctx, req));
    if (!auth) {
      socket.close(4401, 'unauthorized');
      return;
    }
    const conn: Conn = {
      id: ulid(),
      userId: auth.user.id,
      sessionId: auth.sessionId,
      socket,
      seq: 0,
      away: false,
      lastTyping: new Map(),
    };
    ctx.hub.add(conn);
    ctx.hub.sendToConn(conn.id, 'hello', {
      connectionId: conn.id,
      serverTime: nowIso(),
      userId: auth.user.id,
    });
    await ctx.db
      .updateTable('users')
      .set({ last_seen_at: nowIso() })
      .where('id', '=', auth.user.id)
      .execute();

    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, 30_000);
    socket.on('pong', () => (alive = true));

    socket.on('message', async (raw) => {
      alive = true;
      let frame: ClientFrame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        switch (frame.type) {
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }));
            break;
          case 'presence':
            ctx.hub.setAway(conn, frame.presence === 'away');
            break;
          case 'typing': {
            const key = `${frame.channelId}:${frame.threadRootId ?? ''}`;
            const last = conn.lastTyping.get(key) ?? 0;
            if (Date.now() - last < TYPING_THROTTLE_MS) break;
            conn.lastTyping.set(key, Date.now());
            const member = await ctx.db
              .selectFrom('channel_members')
              .select('user_id')
              .where('channel_id', '=', frame.channelId)
              .where('user_id', '=', conn.userId)
              .executeTakeFirst();
            if (!member) break;
            await ctx.hub.sendToChannel(
              frame.channelId,
              'typing',
              {
                channelId: frame.channelId,
                threadRootId: frame.threadRootId ?? null,
                userId: conn.userId,
              },
              { exceptUser: conn.userId },
            );
            break;
          }
          case 'call.signal':
            relaySignal(ctx, conn, frame);
            break;
        }
      } catch (err) {
        ctx.log.warn({ err }, 'ws frame failed');
      }
    });

    socket.on('close', () => {
      clearInterval(ping);
      ctx.hub.remove(conn);
      ctx.db
        .updateTable('users')
        .set({ last_seen_at: nowIso() })
        .where('id', '=', conn.userId)
        .execute()
        .catch(() => {});
    });
  });
}
