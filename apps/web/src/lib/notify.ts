// SPDX-License-Identifier: AGPL-3.0-only
// Desktop notifications, Web Push subscription, tab title/badge and sounds.
import type { Notification as Note } from '@ocpc/shared';
import { api } from './api';
import { channelTitle, displayName, useStore } from './store';

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string') {
        window.dispatchEvent(new CustomEvent('ocpc:navigate', { detail: e.data.url }));
      }
    });
    return reg;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

/** Ask for permission and subscribe this browser to Web Push. */
export async function enableNotifications() {
  if (!('Notification' in window)) return 'unsupported' as const;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  await subscribePush().catch(() => {});
  return perm;
}

export async function subscribePush() {
  const key = useStore.getState().info?.vapidPublicKey;
  if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub)
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
}

// A short, original two-tone chime synthesised at runtime (no bundled audio assets).
let audioCtx: AudioContext | null = null;
export function chime(kind: 'message' | 'ring' = 'message') {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const notes = kind === 'ring' ? [660, 880, 660, 880] : [880, 1320];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.3);
    });
  } catch {
    /* audio not available */
  }
}

/** Show an OS notification for an activity item when the app isn't focused. */
export function showDesktopNotification(n: Note, navigate: (url: string) => void) {
  const s = useStore.getState();
  if (s.me?.dndUntil && s.me.dndUntil > new Date().toISOString()) return;
  if (document.hasFocus()) return;
  chime();
  if (notificationPermission() !== 'granted') return;
  const actor = n.actorId ? displayName(s.users[n.actorId]) : '';
  const ch = n.channelId ? s.channels[n.channelId] : undefined;
  const where = ch ? (ch.kind === 'dm' || ch.kind === 'group_dm' ? '' : ` in #${ch.name}`) : '';
  const title = n.kind === 'reminder' ? '⏰ Reminder' : `${actor}${where}`;
  const url = n.channelId
    ? `/c/${n.channelId}${n.messageId ? `#${n.messageId}` : ''}`
    : '/activity';
  try {
    const note = new Notification(title || s.info?.orgName || 'OpenCorpoChat', {
      body: n.text,
      tag: n.id,
      icon: '/icon-192.png',
    });
    note.onclick = () => {
      window.focus();
      navigate(url);
      note.close();
    };
  } catch {
    /* some browsers only allow notifications from the service worker */
  }
}

/** Keep the document title and app badge in sync with unread state. */
export function syncTitle() {
  const s = useStore.getState();
  let mentions = 0;
  let unread = false;
  for (const c of Object.values(s.channels)) {
    if (c.membership.muted) continue;
    mentions += c.mentionCount;
    if (c.unreadCount > 0) unread = true;
  }
  const active = s.activeChannelId ? s.channels[s.activeChannelId] : undefined;
  const name = active
    ? active.kind === 'dm' || active.kind === 'group_dm'
      ? channelTitle(active, s.me?.id)
      : `#${active.name}`
    : '';
  const org = s.info?.orgName ?? 'OpenCorpoChat';
  document.title = `${mentions ? `(${mentions}) ` : unread ? '• ' : ''}${name ? `${name} – ` : ''}${org}`;
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (mentions) nav.setAppBadge?.(mentions).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
}
