// SPDX-License-Identifier: AGPL-3.0-only
// Common interface implemented by the peer-to-peer mesh and the LiveKit SFU transports.
import type { CallInfo, CallSignal } from '@ocpc/shared';

export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';

export interface CallTransport {
  setAudioEnabled(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  setScreen(on: boolean): Promise<void>;
  switchDevice(kind: DeviceKind, deviceId: string): Promise<void>;
  /** Server membership changed (mesh prunes peers of participants who left). */
  onParticipants(call: CallInfo): void;
  handleSignal(fromConnectionId: string, fromUserId: string, signal: CallSignal): void;
  close(): void;
}

/** Perfect-negotiation politeness: the peer with the larger connection id yields on collisions. */
export function isPolite(myConnectionId: string, theirConnectionId: string) {
  return myConnectionId > theirConnectionId;
}

/** Buffers ICE candidates that arrive before the remote description is applied. */
export class CandidateQueue {
  private queue: RTCIceCandidateInit[] = [];
  constructor(private hasRemote: () => boolean, private add: (c: RTCIceCandidateInit) => Promise<void>) {}

  async push(c: RTCIceCandidateInit) {
    if (this.hasRemote()) await this.add(c);
    else this.queue.push(c);
  }

  async flush() {
    const pending = this.queue;
    this.queue = [];
    for (const c of pending) await this.add(c);
  }

  get size() {
    return this.queue.length;
  }
}
