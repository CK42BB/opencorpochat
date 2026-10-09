// SPDX-License-Identifier: AGPL-3.0-only
// Active calls live in memory: they are inherently tied to live WebSocket connections.
import type { CallInfo } from '@ocpc/shared';

const calls = new Map<string, CallInfo>(); // by channelId

export const activeCalls = () => [...calls.values()];
export const callInChannel = (channelId: string) => calls.get(channelId) ?? null;
export const setCall = (call: CallInfo) => calls.set(call.channelId, call);
export const deleteCall = (channelId: string) => calls.delete(channelId);
export const findCallById = (id: string) => activeCalls().find((c) => c.id === id) ?? null;
export const callsOfConnection = (connectionId: string) =>
  activeCalls().filter((c) => c.participants.some((p) => p.connectionId === connectionId));
