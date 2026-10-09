// SPDX-License-Identifier: AGPL-3.0-only
// Peer-to-peer mesh calls: one RTCPeerConnection per remote participant. The server only
// relays signaling over the WebSocket. Each connection carries one audio and one video
// transceiver; camera/screen switches use replaceTrack, so most changes need no
// renegotiation. Renegotiation, when it happens, follows the "perfect negotiation" pattern.
import type { CallInfo, CallSignal, IceServer } from '@ocpc/shared';
import { send } from '../lib/realtime';
import { setRemote, useCallStore } from './callStore';
import { getCamera, getMic, getScreen, SpeakingMonitor } from './media';
import { CandidateQueue, isPolite, type CallTransport, type DeviceKind } from './transport';

interface Peer {
  connectionId: string;
  userId: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  candidates: CandidateQueue;
  stream: MediaStream;
}

export class MeshTransport implements CallTransport {
  private peers = new Map<string, Peer>();
  private mic: MediaStreamTrack | null = null;
  private cam: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private monitor = new SpeakingMonitor();
  private closed = false;

  constructor(
    private callId: string,
    private myConnectionId: string,
    private myUserId: string,
    private iceServers: IceServer[],
    private onScreenEnded: () => void,
  ) {}

  /** Acquire the microphone. Failure is non-fatal: the user joins listen-only. */
  async init(): Promise<void> {
    const mic = await getMic(useCallStore.getState().micId || undefined);
    if (this.closed) {
      mic.stop();
      return;
    }
    this.mic = mic;
    this.mic.enabled = !useCallStore.getState().muted;
    this.publishLocal();
    // Peers may already be connected (we don't block signaling on the permission prompt).
    await this.replaceOnAll('audio', this.mic);
  }

  private outgoingVideo() {
    return this.screenTrack ?? this.cam;
  }

  private publishLocal() {
    const tracks = [this.mic, this.outgoingVideo()].filter((x): x is MediaStreamTrack => !!x);
    const stream = tracks.length ? new MediaStream(tracks) : null;
    useCallStore.setState({ localStream: stream });
    if (stream) this.monitor.watch('local', this.myUserId, stream);
  }

  private signal(to: string, signal: CallSignal) {
    send({ type: 'call.signal', callId: this.callId, toConnectionId: to, signal });
  }

  /** Create a connection. The initiator (the newer participant) adds transceivers and offers. */
  connectTo(connectionId: string, userId: string, initiator: boolean): Peer {
    const existing = this.peers.get(connectionId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers as RTCIceServer[] });
    const peer: Peer = {
      connectionId,
      userId,
      pc,
      polite: isPolite(this.myConnectionId, connectionId),
      makingOffer: false,
      ignoreOffer: false,
      candidates: new CandidateQueue(
        () => !!pc.remoteDescription,
        async (c) => {
          try {
            await pc.addIceCandidate(c);
          } catch (err) {
            if (!peer.ignoreOffer) console.warn('addIceCandidate failed', err);
          }
        },
      ),
      stream: new MediaStream(),
    };
    this.peers.set(connectionId, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(connectionId, { kind: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
      // New MediaStream object so React re-binds the element.
      const stream = new MediaStream(peer.stream.getTracks());
      setRemote(connectionId, { userId, key: connectionId, stream });
      this.monitor.watch(connectionId, userId, stream);
      e.track.onunmute = () =>
        setRemote(connectionId, {
          userId,
          key: connectionId,
          stream: new MediaStream(peer.stream.getTracks()),
        });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription)
          this.signal(connectionId, { kind: 'offer', sdp: pc.localDescription.sdp });
      } catch (err) {
        console.warn('negotiation failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      this.updateStatus();
    };
    this.updateStatus();

    if (initiator) {
      pc.addTransceiver(this.mic ?? 'audio', { direction: 'sendrecv' });
      pc.addTransceiver(this.outgoingVideo() ?? 'video', { direction: 'sendrecv' });
    }
    return peer;
  }

  /** Attach our current tracks to transceivers created by the remote offer. */
  private async attachLocal(peer: Peer) {
    for (const tr of peer.pc.getTransceivers()) {
      const kind = tr.receiver.track.kind;
      if (tr.direction === 'stopped') continue;
      tr.direction = 'sendrecv';
      const track = kind === 'audio' ? this.mic : this.outgoingVideo();
      if (tr.sender.track !== track) await tr.sender.replaceTrack(track);
    }
  }

  async handleSignal(fromConnectionId: string, fromUserId: string, signal: CallSignal) {
    if (this.closed) return;
    if (signal.kind === 'media') return; // state also arrives via call.updated
    const peer =
      this.peers.get(fromConnectionId) ?? this.connectTo(fromConnectionId, fromUserId, false);
    const pc = peer.pc;
    try {
      if (signal.kind === 'offer' || signal.kind === 'answer') {
        const collision =
          signal.kind === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });
        await peer.candidates.flush();
        if (signal.kind === 'offer') {
          await this.attachLocal(peer);
          await pc.setLocalDescription();
          if (pc.localDescription)
            this.signal(fromConnectionId, { kind: 'answer', sdp: pc.localDescription.sdp });
        }
      } else if (signal.kind === 'ice') {
        await peer.candidates.push(signal.candidate as RTCIceCandidateInit);
      }
    } catch (err) {
      console.warn('signal handling failed', err);
    }
  }

  onParticipants(call: CallInfo) {
    const present = new Set(call.participants.map((p) => p.connectionId));
    for (const id of [...this.peers.keys()]) if (!present.has(id)) this.removePeer(id);
  }

  private removePeer(connectionId: string) {
    const peer = this.peers.get(connectionId);
    if (!peer) return;
    // Update the UI first; closing the connection can be slow on some platforms.
    this.peers.delete(connectionId);
    setRemote(connectionId, null);
    this.monitor.unwatch(connectionId);
    this.updateStatus();
    setTimeout(() => peer.pc.close(), 0);
  }

  private async replaceOnAll(kind: 'audio' | 'video', track: MediaStreamTrack | null) {
    for (const peer of this.peers.values()) {
      const tr = peer.pc
        .getTransceivers()
        .find((x) => x.receiver.track.kind === kind && x.direction !== 'stopped');
      if (tr) await tr.sender.replaceTrack(track).catch(() => {});
      else if (track) peer.pc.addTrack(track); // triggers (perfect) renegotiation
    }
  }

  private broadcastMedia() {
    const s = useCallStore.getState();
    for (const id of this.peers.keys())
      this.signal(id, { kind: 'media', audio: !s.muted, video: s.camera, screen: s.screen });
  }

  async setAudioEnabled(on: boolean) {
    if (on && !this.mic) {
      this.mic = await getMic(useCallStore.getState().micId || undefined);
      await this.replaceOnAll('audio', this.mic);
    }
    if (this.mic) this.mic.enabled = on;
    this.publishLocal();
    this.broadcastMedia();
  }

  async setCamera(on: boolean) {
    if (on) {
      this.cam = await getCamera(useCallStore.getState().camId || undefined);
    } else {
      this.cam?.stop();
      this.cam = null;
    }
    await this.replaceOnAll('video', this.outgoingVideo());
    this.publishLocal();
    this.broadcastMedia();
  }

  async setScreen(on: boolean) {
    if (on) {
      this.screenTrack = await getScreen();
      this.screenTrack.onended = () => this.onScreenEnded();
    } else {
      this.screenTrack?.stop();
      this.screenTrack = null;
    }
    await this.replaceOnAll('video', this.outgoingVideo());
    this.publishLocal();
    this.broadcastMedia();
  }

  async switchDevice(kind: DeviceKind, deviceId: string) {
    if (kind === 'audioinput') {
      const next = await getMic(deviceId);
      next.enabled = this.mic?.enabled ?? true;
      this.mic?.stop();
      this.mic = next;
      await this.replaceOnAll('audio', next);
    } else if (kind === 'videoinput' && this.cam) {
      const next = await getCamera(deviceId);
      this.cam.stop();
      this.cam = next;
      await this.replaceOnAll('video', this.outgoingVideo());
    }
    this.publishLocal();
  }

  /** "connected" once at least one peer is connected (or we're alone in the call). */
  private updateStatus() {
    const states = [...this.peers.values()].map((p) => p.pc.connectionState);
    const connected = states.length === 0 || states.includes('connected');
    useCallStore.setState({ status: connected ? 'connected' : 'connecting' });
  }

  /** Snapshot for troubleshooting: run `ocpcCallDebug()` in the browser console during a call. */
  async debugInfo() {
    const out = [];
    for (const p of this.peers.values()) {
      const stats = await p.pc.getStats();
      const cands: string[] = [];
      const pairs: string[] = [];
      stats.forEach((r) => {
        if (r.type === 'local-candidate' || r.type === 'remote-candidate')
          cands.push(
            `${r.type === 'local-candidate' ? 'L' : 'R'}:${r.candidateType}:${r.protocol}:${r.address}:${r.port}`,
          );
        if (r.type === 'candidate-pair') pairs.push(`${r.state}${r.nominated ? '*' : ''}`);
      });
      out.push({ ...this.peerInfo(p), candidates: cands, pairs });
    }
    return out;
  }

  private peerInfo(p: Peer) {
    return {
      connectionId: p.connectionId,
      signaling: p.pc.signalingState,
      ice: p.pc.iceConnectionState,
      gathering: p.pc.iceGatheringState,
      connection: p.pc.connectionState,
      transceivers: p.pc
        .getTransceivers()
        .map((t) => `${t.receiver.track.kind}:${t.direction}:${t.currentDirection}`),
      remoteTracks: p.stream.getTracks().map((t) => `${t.kind}:${t.readyState}`),
    };
  }

  close() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    for (const tr of [this.mic, this.cam, this.screenTrack]) tr?.stop();
    this.mic = this.cam = this.screenTrack = null;
    this.monitor.close();
  }
}

/** Ids of other participants a new joiner must offer to. */
export function peersToOffer(call: CallInfo, myConnectionId: string) {
  return call.participants.filter((p) => p.connectionId !== myConnectionId);
}
