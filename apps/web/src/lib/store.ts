// SPDX-License-Identifier: AGPL-3.0-only
// Client state (zustand). Server data arrives via REST (bootstrap, paging) and is kept
// fresh by realtime events applied in applyEvent().
import { create } from 'zustand';
import {
  parseMentions,
  type CallInfo,
  type Channel,
  type CustomEmoji,
  type Me,
  type Message,
  type MyChannel,
  type OrgSettings,
  type Presence,
  type ServerEvent,
  type ServerInfo,
  type User,
  type UserGroup,
} from '@ocpc/shared';
import { api } from './api';

export interface MessageList {
  ids: string[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  loading: boolean;
  loaded: boolean;
}

export interface ThreadState {
  replyIds: string[];
  loaded: boolean;
  following: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

export interface State {
  info: ServerInfo | null;
  me: Me | null;
  users: Record<string, User>;
  channels: Record<string, MyChannel>;
  groups: Record<string, UserGroup>;
  emoji: CustomEmoji[];
  settings: OrgSettings | null;
  presence: Record<string, Presence>;
  calls: Record<string, CallInfo>;
  connectionId: string | null;
  connected: boolean;
  messages: Record<string, Message>;
  lists: Record<string, MessageList>;
  threads: Record<string, ThreadState>;
  typing: Record<string, Record<string, number>>;
  unreadThreads: number;
  unreadNotifications: number;
  activeChannelId: string | null;
  openThreadId: string | null;
  focused: boolean;
  ringing: { call: CallInfo; fromUserId: string } | null;
  toasts: Toast[];
  /** Message id the user asked to edit via keyboard (↑ in an empty composer). */
  editRequest: string | null;
}

export const useStore = create<State>(() => ({
  info: null,
  me: null,
  users: {},
  channels: {},
  groups: {},
  emoji: [],
  settings: null,
  presence: {},
  calls: {},
  connectionId: null,
  connected: false,
  messages: {},
  lists: {},
  threads: {},
  typing: {},
  unreadThreads: 0,
  unreadNotifications: 0,
  activeChannelId: null,
  openThreadId: null,
  focused: typeof document !== 'undefined' ? document.hasFocus() : true,
  ringing: null,
  toasts: [],
  editRequest: null,
}));

const set = useStore.setState;
const get = useStore.getState;

// ---------- toasts ----------
let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, kind, action }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), kind === 'error' ? 7000 : 4000);
}
export function toastError(err: unknown) {
  toast(err instanceof Error ? err.message : String(err), 'error');
}

// ---------- bootstrap ----------
export interface Bootstrap {
  me: Me;
  users: User[];
  channels: MyChannel[];
  groups: UserGroup[];
  emoji: CustomEmoji[];
  settings: OrgSettings;
  presence: Record<string, Presence>;
  calls: CallInfo[];
  unreadThreads: number;
  unreadNotifications: number;
}

export async function loadBootstrap() {
  const b = await api.get<Bootstrap>('/bootstrap');
  set({
    me: b.me,
    users: Object.fromEntries(b.users.map((u) => [u.id, u])),
    channels: Object.fromEntries(b.channels.map((c) => [c.id, c])),
    groups: Object.fromEntries(b.groups.map((g) => [g.id, g])),
    emoji: b.emoji,
    settings: b.settings,
    presence: b.presence,
    calls: Object.fromEntries(b.calls.map((c) => [c.channelId, c])),
    unreadThreads: b.unreadThreads,
    unreadNotifications: b.unreadNotifications,
  });
  return b;
}

// ---------- messages ----------
function mergeMessage(m: Message): Message {
  const prev = get().messages[m.id];
  // Broadcast payloads don't carry per-viewer "saved"; keep what we know.
  return prev ? { ...m, saved: prev.saved } : m;
}

function putMessages(msgs: Message[]) {
  if (!msgs.length) return;
  set((s) => {
    const messages = { ...s.messages };
    for (const m of msgs) messages[m.id] = s.messages[m.id] ? { ...m, saved: m.saved || s.messages[m.id]!.saved } : m;
    return { messages };
  });
}

interface Page {
  messages: Message[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export async function loadLatest(channelId: string) {
  const cur = get().lists[channelId];
  if (cur?.loading) return;
  set((s) => ({ lists: { ...s.lists, [channelId]: { ...(cur ?? { ids: [], hasMoreBefore: true, hasMoreAfter: false, loaded: false }), loading: true } } }));
  try {
    const page = await api.get<Page>(`/channels/${channelId}/messages?limit=50`);
    putMessages(page.messages);
    set((s) => ({
      lists: { ...s.lists, [channelId]: { ids: page.messages.map((m) => m.id), hasMoreBefore: page.hasMoreBefore, hasMoreAfter: false, loading: false, loaded: true } },
    }));
  } catch (err) {
    set((s) => ({ lists: { ...s.lists, [channelId]: { ...(s.lists[channelId] ?? { ids: [], hasMoreBefore: false, hasMoreAfter: false, loaded: true }), loading: false } } }));
    throw err;
  }
}

export async function loadOlder(channelId: string) {
  const cur = get().lists[channelId];
  if (!cur || cur.loading || !cur.hasMoreBefore || !cur.ids.length) return;
  set((s) => ({ lists: { ...s.lists, [channelId]: { ...cur, loading: true } } }));
  const page = await api.get<Page>(`/channels/${channelId}/messages?limit=50&before=${cur.ids[0]}`);
  putMessages(page.messages);
  set((s) => {
    const l = s.lists[channelId]!;
    const ids = [...page.messages.map((m) => m.id).filter((id) => !l.ids.includes(id)), ...l.ids];
    return { lists: { ...s.lists, [channelId]: { ...l, ids, hasMoreBefore: page.hasMoreBefore, loading: false } } };
  });
}

export async function loadNewer(channelId: string) {
  const cur = get().lists[channelId];
  if (!cur || cur.loading || !cur.hasMoreAfter || !cur.ids.length) return;
  set((s) => ({ lists: { ...s.lists, [channelId]: { ...cur, loading: true } } }));
  const page = await api.get<Page>(`/channels/${channelId}/messages?limit=50&after=${cur.ids[cur.ids.length - 1]}`);
  putMessages(page.messages);
  set((s) => {
    const l = s.lists[channelId]!;
    const ids = [...l.ids, ...page.messages.map((m) => m.id).filter((id) => !l.ids.includes(id))];
    return { lists: { ...s.lists, [channelId]: { ...l, ids, hasMoreAfter: page.hasMoreAfter, loading: false } } };
  });
}

export async function loadAround(channelId: string, messageId: string) {
  const page = await api.get<Page>(`/channels/${channelId}/messages?limit=60&around=${messageId}`);
  putMessages(page.messages);
  set((s) => ({
    lists: { ...s.lists, [channelId]: { ids: page.messages.map((m) => m.id), hasMoreBefore: page.hasMoreBefore, hasMoreAfter: page.hasMoreAfter, loading: false, loaded: true } },
  }));
}

export async function loadThread(rootId: string) {
  const r = await api.get<{ root: Message; replies: Message[]; following: boolean }>(`/messages/${rootId}/thread`);
  putMessages([r.root, ...r.replies]);
  set((s) => ({ threads: { ...s.threads, [r.root.id]: { replyIds: r.replies.map((m) => m.id), loaded: true, following: r.following } } }));
  return r.root;
}

/** Optimistically insert a pending message, replaced when the server confirms. */
export function addPending(m: Message) {
  set((s) => ({ messages: { ...s.messages, [m.id]: m } }));
  insertIntoLists(m);
}
export function removeMessage(id: string) {
  set((s) => {
    const lists = { ...s.lists };
    for (const [k, l] of Object.entries(lists)) if (l.ids.includes(id)) lists[k] = { ...l, ids: l.ids.filter((x) => x !== id) };
    const threads = { ...s.threads };
    for (const [k, th] of Object.entries(threads)) if (th.replyIds.includes(id)) threads[k] = { ...th, replyIds: th.replyIds.filter((x) => x !== id) };
    const messages = { ...s.messages };
    delete messages[id];
    return { lists, threads, messages };
  });
}

function insertIntoLists(m: Message) {
  set((s) => {
    const patch: Partial<State> = {};
    const inChannel = !m.threadRootId || m.alsoInChannel;
    const list = s.lists[m.channelId];
    if (inChannel && list?.loaded && !list.hasMoreAfter && !list.ids.includes(m.id)) {
      const ids = [...list.ids, m.id];
      // Keep pending (client-) messages at the end in send order.
      ids.sort((a, b) => (a.startsWith('pending-') ? 1 : 0) - (b.startsWith('pending-') ? 1 : 0) || (a < b ? -1 : a > b ? 1 : 0));
      patch.lists = { ...s.lists, [m.channelId]: { ...list, ids } };
    }
    if (m.threadRootId) {
      const th = s.threads[m.threadRootId];
      if (th?.loaded && !th.replyIds.includes(m.id)) {
        patch.threads = { ...s.threads, [m.threadRootId]: { ...th, replyIds: [...th.replyIds, m.id] } };
      }
    }
    return patch;
  });
}

// ---------- mentions ----------
export function mentionsMe(m: Message, me: Me, groups: Record<string, UserGroup>) {
  const p = parseMentions(m.body);
  if (p.channel || p.here) return true;
  if (p.usernames.includes(me.username)) return true;
  return Object.values(groups).some((g) => p.usernames.includes(g.handle) && g.memberIds.includes(me.id));
}

// ---------- realtime ----------
export function applyEvent(e: ServerEvent) {
  const s = get();
  switch (e.type) {
    case 'hello':
      set({ connectionId: e.data.connectionId });
      break;
    case 'message.created': {
      const m = mergeMessage(e.data.message);
      set((st) => ({ messages: { ...st.messages, [m.id]: m } }));
      insertIntoLists(m);
      const ch = s.channels[m.channelId];
      if (ch) {
        const inChannel = !m.threadRootId || m.alsoInChannel;
        const mine = m.userId === s.me?.id;
        const viewing = s.activeChannelId === m.channelId && s.focused;
        const patch: Partial<MyChannel> = {};
        if (inChannel) patch.lastMessageAt = m.createdAt;
        if (inChannel && !mine && !viewing && m.kind !== 'system') {
          patch.unreadCount = ch.unreadCount + 1;
          const isDm = ch.kind === 'dm' || ch.kind === 'group_dm';
          if (isDm || (s.me && mentionsMe(m, s.me, s.groups))) patch.mentionCount = ch.mentionCount + 1;
        }
        if (mine && inChannel) patch.membership = { ...ch.membership, lastReadMessageId: m.id };
        set((st) => ({ channels: { ...st.channels, [ch.id]: { ...st.channels[ch.id]!, ...patch } } }));
      }
      // Clear typing indicator for the author.
      if (m.userId) clearTyping(m.channelId, m.threadRootId, m.userId);
      break;
    }
    case 'message.updated': {
      const m = mergeMessage(e.data.message);
      set((st) => ({ messages: { ...st.messages, [m.id]: m } }));
      break;
    }
    case 'message.deleted': {
      const prev = s.messages[e.data.messageId];
      if (!prev) break;
      // Keep tombstones for thread roots with replies; drop plain messages.
      if (prev.replyCount > 0 && !prev.threadRootId) {
        set((st) => ({ messages: { ...st.messages, [prev.id]: { ...prev, deleted: true, body: '', files: [], reactions: [] } } }));
      } else if (prev.threadRootId) {
        set((st) => ({ messages: { ...st.messages, [prev.id]: { ...prev, deleted: true, body: '', files: [], reactions: [] } } }));
        if (prev.alsoInChannel) {
          const l = s.lists[prev.channelId];
          if (l) set((st) => ({ lists: { ...st.lists, [prev.channelId]: { ...l, ids: l.ids.filter((x) => x !== prev.id) } } }));
        }
      } else {
        removeMessage(prev.id);
      }
      break;
    }
    case 'reaction.updated': {
      const prev = s.messages[e.data.messageId];
      if (prev) set((st) => ({ messages: { ...st.messages, [prev.id]: { ...prev, reactions: e.data.reactions } } }));
      break;
    }
    case 'pin.updated': {
      const prev = s.messages[e.data.messageId];
      if (prev) set((st) => ({ messages: { ...st.messages, [prev.id]: { ...prev, pinned: e.data.pinned } } }));
      break;
    }
    case 'saved.updated': {
      const prev = s.messages[e.data.messageId];
      if (prev) set((st) => ({ messages: { ...st.messages, [prev.id]: { ...prev, saved: e.data.saved } } }));
      break;
    }
    case 'channel.created':
      set((st) => ({ channels: { ...st.channels, [e.data.channel.id]: e.data.channel } }));
      break;
    case 'channel.updated': {
      const ch = s.channels[e.data.channel.id];
      if (ch) set((st) => ({ channels: { ...st.channels, [ch.id]: { ...ch, ...(e.data.channel as Channel) } } }));
      break;
    }
    case 'channel.removed': {
      set((st) => {
        const channels = { ...st.channels };
        delete channels[e.data.channelId];
        return { channels };
      });
      break;
    }
    case 'channel.member_joined':
    case 'channel.member_left': {
      const ch = s.channels[e.data.channelId];
      if (ch) {
        let dmUserIds = ch.dmUserIds;
        if (dmUserIds) {
          dmUserIds = e.type === 'channel.member_joined' ? [...new Set([...dmUserIds, e.data.userId])] : dmUserIds.filter((u) => u !== e.data.userId);
        }
        set((st) => ({ channels: { ...st.channels, [ch.id]: { ...ch, memberCount: e.data.memberCount, ...(dmUserIds ? { dmUserIds } : {}) } } }));
      }
      break;
    }
    case 'membership.updated': {
      const ch = s.channels[e.data.membership.channelId];
      if (ch) {
        set((st) => ({
          channels: { ...st.channels, [ch.id]: { ...ch, membership: e.data.membership, unreadCount: e.data.unreadCount, mentionCount: e.data.mentionCount } },
        }));
      }
      break;
    }
    case 'typing': {
      if (e.data.userId === s.me?.id) break;
      const key = `${e.data.channelId}:${e.data.threadRootId ?? ''}`;
      set((st) => ({ typing: { ...st.typing, [key]: { ...(st.typing[key] ?? {}), [e.data.userId]: Date.now() + 6000 } } }));
      setTimeout(() => clearTyping(e.data.channelId, e.data.threadRootId, e.data.userId, true), 6100);
      break;
    }
    case 'presence':
      set((st) => ({ presence: { ...st.presence, [e.data.userId]: e.data.presence } }));
      break;
    case 'user.updated':
    case 'user.created':
      set((st) => ({
        users: { ...st.users, [e.data.user.id]: e.data.user },
        me: st.me && st.me.id === e.data.user.id ? { ...st.me, ...e.data.user } : st.me,
      }));
      break;
    case 'notification':
      if (e.data.notification.kind !== 'call') set((st) => ({ unreadNotifications: st.unreadNotifications + (e.data.notification.read ? 0 : 1) }));
      window.dispatchEvent(new CustomEvent('ocpc:notification', { detail: e.data.notification }));
      if (e.data.notification.kind === 'thread_reply') set((st) => ({ unreadThreads: st.unreadThreads + 1 }));
      break;
    case 'thread.updated':
      if (!e.data.unread) set((st) => ({ unreadThreads: Math.max(0, st.unreadThreads - 1) }));
      break;
    case 'group.updated':
      set((st) => ({ groups: { ...st.groups, [e.data.group.id]: e.data.group } }));
      break;
    case 'group.deleted':
      set((st) => {
        const groups = { ...st.groups };
        delete groups[e.data.groupId];
        return { groups };
      });
      break;
    case 'emoji.updated':
      set({ emoji: e.data.emoji });
      break;
    case 'settings.updated':
      api.get<OrgSettings>('/bootstrap').then((b) => set({ settings: (b as unknown as Bootstrap).settings })).catch(() => {});
      break;
    case 'call.updated':
      set((st) => {
        const calls = { ...st.calls };
        if (e.data.call) calls[e.data.channelId] = e.data.call;
        else delete calls[e.data.channelId];
        const ringing = st.ringing && (!e.data.call || st.ringing.call.id !== e.data.call.id) && st.ringing.call.channelId === e.data.channelId ? null : st.ringing;
        return { calls, ringing };
      });
      window.dispatchEvent(new CustomEvent('ocpc:call-updated', { detail: e.data }));
      break;
    case 'call.ring':
      set({ ringing: e.data });
      break;
    case 'call.signal':
      window.dispatchEvent(new CustomEvent('ocpc:call-signal', { detail: e.data }));
      break;
    case 'session.revoked':
      window.location.href = '/login';
      break;
  }
}

function clearTyping(channelId: string, threadRootId: string | null, userId: string, onlyIfExpired = false) {
  const key = `${channelId}:${threadRootId ?? ''}`;
  set((st) => {
    const cur = st.typing[key];
    if (!cur?.[userId]) return {};
    if (onlyIfExpired && cur[userId]! > Date.now()) return {};
    const next = { ...cur };
    delete next[userId];
    return { typing: { ...st.typing, [key]: next } };
  });
}

// ---------- selectors / helpers ----------
export function displayName(u: User | undefined | null) {
  return u ? u.displayName || u.username : 'Unknown';
}

export function channelTitle(ch: Pick<Channel, 'kind' | 'name' | 'dmUserIds'>, meId?: string, users: Record<string, User> = get().users) {
  if (ch.kind === 'dm' || ch.kind === 'group_dm') {
    const others = (ch.dmUserIds ?? []).filter((id) => id !== meId);
    if (!others.length) return `${displayName(users[meId ?? ''])} (you)`;
    return others.map((id) => displayName(users[id])).join(', ');
  }
  return ch.name;
}

export function isDm(ch: Pick<Channel, 'kind'>) {
  return ch.kind === 'dm' || ch.kind === 'group_dm';
}
