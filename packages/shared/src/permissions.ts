// SPDX-License-Identifier: AGPL-3.0-only
// Pure authorization rules. The server is the authority; clients use these to hide UI.
import type { Channel, Membership, Role } from './entities.js';

export interface Actor {
  id: string;
  role: Role;
}

export const isAdmin = (a: Actor) => a.role === 'owner' || a.role === 'admin';
export const isGuest = (a: Actor) => a.role === 'guest';

export function canViewChannel(a: Actor, ch: Pick<Channel, 'kind'>, member: Membership | null) {
  if (member) return true;
  if (ch.kind === 'public') return !isGuest(a);
  return false;
}

export function canJoinChannel(a: Actor, ch: Pick<Channel, 'kind' | 'archived'>) {
  return ch.kind === 'public' && !ch.archived && !isGuest(a);
}

export function canPostInChannel(
  a: Actor,
  ch: Pick<Channel, 'kind' | 'archived' | 'isReadonly'>,
  member: Membership | null,
) {
  if (!member || ch.archived) return false;
  if (ch.isReadonly) return isAdmin(a) || member.role === 'admin';
  return true;
}

export function canManageChannel(
  a: Actor,
  ch: Pick<Channel, 'kind' | 'createdBy'>,
  member: Membership | null,
) {
  if (ch.kind === 'dm' || ch.kind === 'group_dm') return false;
  return isAdmin(a) || member?.role === 'admin' || (ch.createdBy === a.id && !!member);
}

export function canAddMembers(a: Actor, ch: Pick<Channel, 'kind' | 'archived'>, member: Membership | null) {
  if (ch.archived || ch.kind === 'dm' || ch.kind === 'group_dm') return false;
  if (isGuest(a)) return false;
  if (ch.kind === 'public') return !!member || isAdmin(a);
  return !!member;
}

export function canEditMessage(
  a: Actor,
  msg: { userId: string | null; createdAt: string },
  editWindowMinutes: number | null,
  now = Date.now(),
) {
  if (msg.userId !== a.id) return false;
  if (editWindowMinutes == null) return true;
  return now - Date.parse(msg.createdAt) <= editWindowMinutes * 60_000;
}

export function canDeleteMessage(a: Actor, msg: { userId: string | null }, member: Membership | null) {
  return msg.userId === a.id || isAdmin(a) || member?.role === 'admin';
}

export function canCreateChannel(a: Actor) {
  return !isGuest(a);
}

export function canInvite(a: Actor, role: Role) {
  if (isGuest(a) || a.role === 'bot') return false;
  if (role === 'admin' || role === 'owner') return isAdmin(a);
  return true;
}

export function canChangeRole(a: Actor, target: Actor, newRole: Role) {
  if (a.id === target.id) return false;
  if (target.role === 'owner' || newRole === 'owner') return a.role === 'owner';
  return isAdmin(a);
}
