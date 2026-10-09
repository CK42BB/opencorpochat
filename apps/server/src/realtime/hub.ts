// SPDX-License-Identifier: AGPL-3.0-only
// In-memory connection registry and event fan-out. Single-node by design; a fork that
// needs several nodes can replace `publish` with Redis or Postgres LISTEN/NOTIFY.
import type { Presence, ServerEventMap, ServerEventType } from '@ocpc/shared';
import type { WebSocket } from 'ws';

export interface Conn {
  id: string;
  userId: string;
  sessionId: string | null;
  socket: WebSocket;
  seq: number;
  away: boolean;
  lastTyping: Map<string, number>;
}

type MemberLookup = (channelId: string) => Promise<string[]>;

export class Hub {
  private conns = new Map<string, Conn>();
  private byUser = new Map<string, Set<Conn>>();
  /** Users whose DND is currently active (maintained by the users module). */
  dndUsers = new Set<string>();
  onPresenceChange: (userId: string, presence: Presence) => void = () => {};
  onDisconnect: (conn: Conn) => void = () => {};

  constructor(private members: MemberLookup) {}

  add(conn: Conn) {
    const before = this.presenceOf(conn.userId);
    this.conns.set(conn.id, conn);
    let set = this.byUser.get(conn.userId);
    if (!set) this.byUser.set(conn.userId, (set = new Set()));
    set.add(conn);
    this.emitPresenceIfChanged(conn.userId, before);
  }

  remove(conn: Conn) {
    if (!this.conns.has(conn.id)) return;
    const before = this.presenceOf(conn.userId);
    this.conns.delete(conn.id);
    const set = this.byUser.get(conn.userId);
    set?.delete(conn);
    if (set && set.size === 0) this.byUser.delete(conn.userId);
    this.onDisconnect(conn);
    this.emitPresenceIfChanged(conn.userId, before);
  }

  setAway(conn: Conn, away: boolean) {
    const before = this.presenceOf(conn.userId);
    conn.away = away;
    this.emitPresenceIfChanged(conn.userId, before);
  }

  setDnd(userId: string, on: boolean) {
    const before = this.presenceOf(userId);
    if (on) this.dndUsers.add(userId);
    else this.dndUsers.delete(userId);
    this.emitPresenceIfChanged(userId, before);
  }

  private emitPresenceIfChanged(userId: string, before: Presence) {
    const after = this.presenceOf(userId);
    if (after !== before) this.onPresenceChange(userId, after);
  }

  presenceOf(userId: string): Presence {
    const set = this.byUser.get(userId);
    if (!set || set.size === 0) return 'offline';
    if (this.dndUsers.has(userId)) return 'dnd';
    for (const c of set) if (!c.away) return 'online';
    return 'away';
  }

  presenceMap(): Record<string, Presence> {
    const out: Record<string, Presence> = {};
    for (const userId of this.byUser.keys()) out[userId] = this.presenceOf(userId);
    return out;
  }

  isOnline(userId: string) {
    return this.byUser.has(userId);
  }

  getConn(id: string) {
    return this.conns.get(id);
  }

  connectionsOf(userId: string) {
    return [...(this.byUser.get(userId) ?? [])];
  }

  connectionCount() {
    return this.conns.size;
  }

  private send(conn: Conn, type: string, data: unknown) {
    if (conn.socket.readyState !== 1) return;
    conn.seq += 1;
    conn.socket.send(JSON.stringify({ type, seq: conn.seq, data }));
  }

  sendToConn<K extends ServerEventType>(connId: string, type: K, data: ServerEventMap[K]) {
    const c = this.conns.get(connId);
    if (c) this.send(c, type, data);
  }

  sendToUsers<K extends ServerEventType>(
    userIds: Iterable<string>,
    type: K,
    data: ServerEventMap[K],
    exceptConn?: string,
  ) {
    for (const uid of new Set(userIds)) {
      for (const c of this.byUser.get(uid) ?? []) if (c.id !== exceptConn) this.send(c, type, data);
    }
  }

  async sendToChannel<K extends ServerEventType>(
    channelId: string,
    type: K,
    data: ServerEventMap[K],
    opts: { exceptUser?: string } = {},
  ) {
    const ids = await this.members(channelId);
    this.sendToUsers(
      ids.filter((id) => id !== opts.exceptUser),
      type,
      data,
    );
  }

  broadcast<K extends ServerEventType>(type: K, data: ServerEventMap[K]) {
    for (const c of this.conns.values()) this.send(c, type, data);
  }

  /** Disconnect all sockets for a session (logout / revoke) or a whole user (deactivation). */
  kick(filter: { sessionId?: string; userId?: string }) {
    for (const c of [...this.conns.values()]) {
      if (
        (filter.sessionId && c.sessionId === filter.sessionId) ||
        (filter.userId && c.userId === filter.userId)
      ) {
        this.send(c, 'session.revoked', {});
        c.socket.close(4001, 'session revoked');
        this.remove(c);
      }
    }
  }

  closeAll() {
    for (const c of this.conns.values()) c.socket.close(1001, 'server shutting down');
    this.conns.clear();
    this.byUser.clear();
  }
}
