// SPDX-License-Identifier: AGPL-3.0-only
// Realtime WebSocket protocol. Server → client frames are `ServerEvent`,
// client → server frames are `ClientFrame`. See docs/api/realtime.md.
import type {
  CallInfo,
  Channel,
  Membership,
  Message,
  MyChannel,
  Notification,
  Presence,
  ReactionSummary,
  User,
  UserGroup,
  CustomEmoji,
} from './entities.js';

export interface ServerEventMap {
  hello: { connectionId: string; serverTime: string; userId: string };
  'message.created': { message: Message };
  'message.updated': { message: Message };
  'message.deleted': { messageId: string; channelId: string; threadRootId: string | null };
  'reaction.updated': { messageId: string; channelId: string; reactions: ReactionSummary[] };
  'channel.created': { channel: MyChannel };
  'channel.updated': { channel: Channel };
  'channel.removed': { channelId: string };
  'channel.member_joined': { channelId: string; userId: string; memberCount: number };
  'channel.member_left': { channelId: string; userId: string; memberCount: number };
  'membership.updated': { membership: Membership; unreadCount: number; mentionCount: number };
  typing: { channelId: string; threadRootId: string | null; userId: string };
  presence: { userId: string; presence: Presence };
  'user.updated': { user: User };
  'user.created': { user: User };
  'pin.updated': { channelId: string; messageId: string; pinned: boolean };
  'saved.updated': { messageId: string; saved: boolean };
  notification: { notification: Notification };
  'thread.updated': { rootId: string; channelId: string; unread: boolean };
  'group.updated': { group: UserGroup };
  'group.deleted': { groupId: string };
  'emoji.updated': { emoji: CustomEmoji[] };
  'settings.updated': Record<string, never>;
  'call.updated': { call: CallInfo | null; channelId: string };
  'call.ring': { call: CallInfo; fromUserId: string };
  'call.signal': {
    callId: string;
    fromUserId: string;
    fromConnectionId: string;
    signal: CallSignal;
  };
  'session.revoked': Record<string, never>;
}

export type ServerEventType = keyof ServerEventMap;
export type ServerEvent = {
  [K in ServerEventType]: { type: K; seq: number; data: ServerEventMap[K] };
}[ServerEventType];

export type CallSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: unknown }
  | { kind: 'media'; audio: boolean; video: boolean; screen: boolean };

export type ClientFrame =
  | { type: 'typing'; channelId: string; threadRootId?: string | null }
  | { type: 'presence'; presence: 'online' | 'away' }
  | { type: 'ping' }
  | {
      type: 'call.signal';
      callId: string;
      toConnectionId: string;
      signal: CallSignal;
    };
