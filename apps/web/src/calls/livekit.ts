// SPDX-License-Identifier: AGPL-3.0-only
// SFU calls through a self-hosted LiveKit server (Apache-2.0). The client library is
// loaded on demand, only when the server is configured for LiveKit.
import type { CallInfo } from '@ocpc/shared';
import { t } from '../lib/i18n';
import { toast } from '../lib/store';
import { setRemote, setSpeaking, useCallStore } from './callStore';
import { MediaError } from './media';
import type { CallTransport, DeviceKind } from './transport';

type LK = typeof import('livekit-client');
type Room = import('livekit-client').Room;
type RemoteParticipant = import('livekit-client').RemoteParticipant;

export class LiveKitTransport implements CallTransport {
  private lk!: LK;
  private room!: Room;

  constructor(
    private url: string,
    private token: string,
    private myUserId: string,
    private onDisconnected: () => void,
  ) {}

  async init() {
    this.lk = await import('livekit-client');
    const { Room, RoomEvent } = this.lk;
    this.room = new Room({ adaptiveStream: true, dynacast: true });
    const refresh = (p: RemoteParticipant) => this.refreshParticipant(p);
    this.room
      .on(RoomEvent.TrackSubscribed, (_track, _pub, p) => refresh(p))
      .on(RoomEvent.TrackUnsubscribed, (_track, _pub, p) => refresh(p))
      .on(RoomEvent.TrackMuted, (_pub, p) => p !== this.room.localParticipant && refresh(p as RemoteParticipant))
      .on(RoomEvent.TrackUnmuted, (_pub, p) => p !== this.room.localParticipant && refresh(p as RemoteParticipant))
      .on(RoomEvent.ParticipantDisconnected, (p) => setRemote(p.identity, null))
      .on(RoomEvent.LocalTrackPublished, () => this.publishLocal())
      .on(RoomEvent.LocalTrackUnpublished, () => this.publishLocal())
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const active = new Set(speakers.map((s) => s.identity));
        const known = new Set([this.myUserId, ...this.room.remoteParticipants.keys()]);
        for (const id of known) setSpeaking(id, active.has(id));
      })
      .on(RoomEvent.Disconnected, () => this.onDisconnected());
    await this.room.connect(this.url, this.token);
    useCallStore.setState({ status: 'connected' });
    for (const p of this.room.remoteParticipants.values()) refresh(p);
    try {
      await this.room.localParticipant.setMicrophoneEnabled(!useCallStore.getState().muted, { deviceId: useCallStore.getState().micId || undefined });
    } catch {
      toast(t('Could not access your microphone. You joined listen-only.'), 'error');
      useCallStore.setState({ muted: true });
    }
    this.publishLocal();
  }

  private refreshParticipant(p: RemoteParticipant) {
    const tracks: MediaStreamTrack[] = [];
    for (const pub of p.trackPublications.values()) {
      const track = pub.track?.mediaStreamTrack;
      if (track && pub.isSubscribed && !pub.isMuted) tracks.push(track);
    }
    setRemote(p.identity, { userId: p.identity, key: p.identity, stream: new MediaStream(tracks) });
  }

  private publishLocal() {
    const { Track } = this.lk;
    const lp = this.room.localParticipant;
    const audio = lp.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    const video = (lp.getTrackPublication(Track.Source.ScreenShare) ?? lp.getTrackPublication(Track.Source.Camera))?.track?.mediaStreamTrack;
    const tracks = [audio, video].filter((x): x is MediaStreamTrack => !!x);
    useCallStore.setState({ localStream: tracks.length ? new MediaStream(tracks) : null });
  }

  private async wrap(fn: () => Promise<unknown>, what: string) {
    try {
      await fn();
    } catch (err) {
      const name = (err as { name?: string }).name;
      throw new MediaError(name === 'NotAllowedError' ? t('Permission to use your {what} was denied.', { what }) : t('Could not access your {what}.', { what }));
    }
    this.publishLocal();
  }

  setAudioEnabled(on: boolean) {
    return this.wrap(() => this.room.localParticipant.setMicrophoneEnabled(on), t('microphone'));
  }

  setCamera(on: boolean) {
    return this.wrap(
      () => this.room.localParticipant.setCameraEnabled(on, { deviceId: useCallStore.getState().camId || undefined, resolution: { width: 640, height: 360, frameRate: 24 } }),
      t('camera'),
    );
  }

  setScreen(on: boolean) {
    return this.wrap(() => this.room.localParticipant.setScreenShareEnabled(on), t('screen'));
  }

  async switchDevice(kind: DeviceKind, deviceId: string) {
    await this.room.switchActiveDevice(kind, deviceId);
    this.publishLocal();
  }

  onParticipants(_call: CallInfo) {
    /* LiveKit tracks membership itself. */
  }

  handleSignal() {
    /* Not used in SFU mode. */
  }

  close() {
    this.room?.disconnect().catch(() => {});
  }
}
