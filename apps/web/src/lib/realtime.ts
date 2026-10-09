// SPDX-License-Identifier: AGPL-3.0-only
// WebSocket connection with exponential backoff, idle detection and gap-fill on reconnect.
import type { ClientFrame, ServerEvent } from '@ocpc/shared';
import { applyEvent, loadBootstrap, loadLatest, useStore } from './store';

let ws: WebSocket | null = null;
let attempts = 0;
let everConnected = false;
let stopped = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function send(frame: ClientFrame) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

async function resync() {
  // After a disconnect we may have missed events: refresh what the user can see.
  await loadBootstrap();
  const { lists, activeChannelId } = useStore.getState();
  useStore.setState({ lists: activeChannelId && lists[activeChannelId] ? { [activeChannelId]: lists[activeChannelId] } : {}, threads: {} });
  if (activeChannelId) await loadLatest(activeChannelId);
}

export function connect() {
  stopped = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/api/v1/ws`);
  ws.onopen = () => {
    attempts = 0;
    useStore.setState({ connected: true });
    if (everConnected) resync().catch(() => {});
    everConnected = true;
    reportPresence();
  };
  ws.onmessage = (ev) => {
    try {
      const e = JSON.parse(ev.data) as ServerEvent | { type: 'pong' };
      if (e.type !== 'pong') applyEvent(e as ServerEvent);
    } catch (err) {
      console.error('bad realtime frame', err);
    }
  };
  ws.onclose = (ev) => {
    useStore.setState({ connected: false, connectionId: null });
    ws = null;
    if (stopped || ev.code === 4001 || ev.code === 4401) return;
    const delay = Math.min(30_000, 500 * 2 ** attempts) * (0.75 + Math.random() / 2);
    attempts++;
    retryTimer = setTimeout(connect, delay);
  };
}

export function disconnect() {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  ws?.close();
}

// ---------- presence: away after 5 minutes idle or 10 minutes hidden ----------
let lastActivity = Date.now();
let reportedAway: boolean | null = null;

function reportPresence() {
  const idle = Date.now() - lastActivity > 5 * 60_000;
  const away = idle;
  if (away !== reportedAway || reportedAway === null) {
    reportedAway = away;
    send({ type: 'presence', presence: away ? 'away' : 'online' });
  }
}

if (typeof window !== 'undefined') {
  for (const evt of ['mousemove', 'keydown', 'pointerdown', 'focus', 'touchstart']) {
    window.addEventListener(
      evt,
      () => {
        lastActivity = Date.now();
        if (reportedAway) reportPresence();
      },
      { passive: true },
    );
  }
  setInterval(reportPresence, 30_000);
  setInterval(() => send({ type: 'ping' }), 25_000);
  window.addEventListener('online', () => {
    if (!ws && !stopped) {
      if (retryTimer) clearTimeout(retryTimer);
      attempts = 0;
      connect();
    }
  });
}
