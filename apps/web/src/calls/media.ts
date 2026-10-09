// SPDX-License-Identifier: AGPL-3.0-only
// Local media helpers: device capture with friendly errors, and speaking detection.
import { t } from '../lib/i18n';
import { setSpeaking } from './callStore';

export class MediaError extends Error {}

function describe(err: unknown, kind: 'microphone' | 'camera' | 'screen'): MediaError {
  const name = (err as { name?: string })?.name ?? '';
  const what =
    kind === 'microphone' ? t('microphone') : kind === 'camera' ? t('camera') : t('screen');
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MediaError(
      kind === 'screen'
        ? t('Screen sharing was cancelled or blocked.')
        : t(
            'Permission to use your {what} was denied. Allow it in your browser settings and try again.',
            { what },
          ),
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return new MediaError(t('No {what} was found.', { what }));
  if (name === 'NotReadableError')
    return new MediaError(t('Your {what} is in use by another application.', { what }));
  if (!navigator.mediaDevices) return new MediaError(t('Calls need a secure (HTTPS) connection.'));
  return new MediaError(t('Could not access your {what}.', { what }));
}

export async function getMic(deviceId?: string): Promise<MediaStreamTrack> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    return s.getAudioTracks()[0]!;
  } catch (err) {
    throw describe(err, 'microphone');
  }
}

export async function getCamera(deviceId?: string): Promise<MediaStreamTrack> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 24 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    return s.getVideoTracks()[0]!;
  } catch (err) {
    throw describe(err, 'camera');
  }
}

export async function getScreen(): Promise<MediaStreamTrack> {
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15 } },
      audio: false,
    });
    const track = s.getVideoTracks()[0]!;
    track.contentHint = 'detail';
    return track;
  } catch (err) {
    throw describe(err, 'screen');
  }
}

/** Polls audio levels for a set of streams and updates the speaking map (by userId). */
export class SpeakingMonitor {
  private ctx: AudioContext | null = null;
  private entries = new Map<
    string,
    { userId: string; analyser: AnalyserNode; source: MediaStreamAudioSourceNode; trackId: string }
  >();
  private timer: ReturnType<typeof setInterval> | null = null;
  private buf = new Uint8Array(512);

  watch(key: string, userId: string, stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    const cur = this.entries.get(key);
    if (cur && cur.trackId === track?.id) return;
    this.unwatch(key);
    if (!track) return;
    try {
      this.ctx ??= new AudioContext();
      const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.entries.set(key, { userId, analyser, source, trackId: track.id });
      this.timer ??= setInterval(() => this.tick(), 200);
    } catch {
      /* AudioContext unavailable */
    }
  }

  unwatch(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    e.source.disconnect();
    this.entries.delete(key);
    setSpeaking(e.userId, false);
  }

  private tick() {
    for (const e of this.entries.values()) {
      e.analyser.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (const v of this.buf) sum += (v - 128) * (v - 128);
      const rms = Math.sqrt(sum / this.buf.length) / 128;
      setSpeaking(e.userId, rms > 0.04);
    }
  }

  close() {
    for (const k of [...this.entries.keys()]) this.unwatch(k);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
