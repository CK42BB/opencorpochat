// SPDX-License-Identifier: AGPL-3.0-only
// Local (this browser's) call state. Server-side call membership lives in lib/store `calls`.
import { create } from 'zustand';

export type CallMode = 'mesh' | 'livekit';

export interface RemoteMedia {
  userId: string;
  /** Mesh: the peer's connection id. LiveKit: the participant identity (user id). */
  key: string;
  stream: MediaStream;
}

export interface CallState {
  status: 'idle' | 'connecting' | 'connected';
  channelId: string | null;
  callId: string | null;
  mode: CallMode;
  joinedAt: number | null;
  localStream: MediaStream | null;
  remote: Record<string, RemoteMedia>;
  muted: boolean;
  camera: boolean;
  screen: boolean;
  /** userId → currently speaking. */
  speaking: Record<string, boolean>;
  expanded: boolean;
  sinkId: string;
  micId: string;
  camId: string;
}

export const initialCallState: CallState = {
  status: 'idle',
  channelId: null,
  callId: null,
  mode: 'mesh',
  joinedAt: null,
  localStream: null,
  remote: {},
  muted: false,
  camera: false,
  screen: false,
  speaking: {},
  expanded: false,
  sinkId: '',
  micId: '',
  camId: '',
};

export const useCallStore = create<CallState>(() => ({ ...initialCallState }));

export function setRemote(key: string, media: RemoteMedia | null) {
  useCallStore.setState((s) => {
    const remote = { ...s.remote };
    if (media) remote[key] = media;
    else delete remote[key];
    return { remote };
  });
}

export function setSpeaking(userId: string, on: boolean) {
  const cur = useCallStore.getState().speaking[userId] ?? false;
  if (cur === on) return;
  useCallStore.setState((s) => ({ speaking: { ...s.speaking, [userId]: on } }));
}
