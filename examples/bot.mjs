// SPDX-License-Identifier: AGPL-3.0-only
// A tiny bot that listens on the realtime API and answers "!ping" with "pong".
// Usage: OCPC_URL=https://chat.example.com OCPC_TOKEN=ocpc_xxx node examples/bot.mjs
// Requires Node 22+ (global WebSocket and fetch).
const base = process.env.OCPC_URL ?? 'http://localhost:8080';
const token = process.env.OCPC_TOKEN;
if (!token) throw new Error('Set OCPC_TOKEN to a bot token');

const api = (path, init = {}) =>
  fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  }).then((r) => r.json());

const me = await api('/me');
const ws = new WebSocket(
  `${base.replace(/^http/, 'ws')}/api/v1/ws?token=${encodeURIComponent(token)}`,
);
ws.onopen = () => console.log(`connected as @${me.username}`);
ws.onmessage = async (ev) => {
  const e = JSON.parse(ev.data);
  if (e.type !== 'message.created') return;
  const m = e.data.message;
  if (m.userId === me.id || m.body.trim() !== '!ping') return;
  await api(`/channels/${m.channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: 'pong 🏓', threadRootId: m.threadRootId }),
  });
};
ws.onclose = () => console.log('disconnected');
