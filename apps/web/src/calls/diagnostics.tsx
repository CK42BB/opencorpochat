// SPDX-License-Identifier: AGPL-3.0-only
// Call diagnostics: checks STUN/TURN reachability (ICE candidate types) and local devices.
// Referenced from the admin guide's troubleshooting section.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { IceServer } from '@ocpc/shared';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { Modal, Spinner } from '../components/ui';
import { getCamera, getMic } from './media';

interface IceResult {
  servers: IceServer[];
  mode: string;
  types: Set<string>;
  done: boolean;
  error?: string;
}

/** Gather ICE candidates with a throwaway connection and report which types were found. */
export async function gatherCandidateTypes(iceServers: IceServer[], timeoutMs = 8000): Promise<Set<string>> {
  const pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
  const types = new Set<string>();
  pc.createDataChannel('probe');
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          clearTimeout(timer);
          resolve();
          return;
        }
        const type = e.candidate.type ?? /typ (\w+)/.exec(e.candidate.candidate)?.[1];
        if (type) types.add(type);
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o));
    });
  } finally {
    pc.close();
  }
  return types;
}

function Check({ ok, label, hint }: { ok: boolean | null; label: string; hint?: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
      {ok === null ? <Spinner size={18} /> : ok ? <CheckCircle2 size={18} color="var(--success)" /> : <XCircle size={18} color="var(--danger)" />}
      <div>
        <div>{label}</div>
        {hint && <div className="faint small">{hint}</div>}
      </div>
    </div>
  );
}

export function CallDiagnostics({ onClose }: { onClose: () => void }) {
  const [ice, setIce] = useState<IceResult | null>(null);
  const [mic, setMic] = useState<boolean | null>(null);
  const [micError, setMicError] = useState('');
  const [cam, setCam] = useState<boolean | null>(null);
  const [camError, setCamError] = useState('');
  const [level, setLevel] = useState(0);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ iceServers: IceServer[]; mode: string }>('/calls/ice')
      .then(async (r) => {
        if (cancelled) return;
        setIce({ servers: r.iceServers, mode: r.mode, types: new Set(), done: false });
        const types = await gatherCandidateTypes(r.iceServers);
        if (!cancelled) setIce({ servers: r.iceServers, mode: r.mode, types, done: true });
      })
      .catch((err: Error) => !cancelled && setIce({ servers: [], mode: '?', types: new Set(), done: true, error: err.message }));

    const tracks: MediaStreamTrack[] = [];
    let raf = 0;
    let ctx: AudioContext | null = null;
    getMic()
      .then((track) => {
        tracks.push(track);
        if (cancelled) return;
        setMic(true);
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
        const buf = new Uint8Array(512);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += (v - 128) ** 2;
          setLevel(Math.min(1, (Math.sqrt(sum / buf.length) / 128) * 4));
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((err: Error) => {
        setMic(false);
        setMicError(err.message);
      });
    getCamera()
      .then((track) => {
        tracks.push(track);
        if (cancelled) return;
        setCam(true);
        if (video.current) video.current.srcObject = new MediaStream([track]);
      })
      .catch((err: Error) => {
        setCam(false);
        setCamError(err.message);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ctx?.close().catch(() => {});
      for (const tr of tracks) tr.stop();
    };
  }, []);

  const relay = ice?.types.has('relay') ?? false;
  const srflx = ice?.types.has('srflx') ?? false;
  const host = ice?.types.has('host') ?? false;
  const hasTurn = ice?.servers.some((s) => [s.urls].flat().some((u) => u.startsWith('turn'))) ?? false;

  return (
    <Modal title={t('Call diagnostics')} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
      <h4 style={{ margin: '4px 0 8px' }}>{t('Network')}</h4>
      {!ice ? (
        <Spinner />
      ) : ice.error ? (
        <Check ok={false} label={t('Could not load call settings')} hint={ice.error} />
      ) : (
        <>
          <div className="faint small" style={{ marginBottom: 8 }}>
            {t('Mode')}: {ice.mode === 'livekit' ? t('LiveKit media server') : t('peer-to-peer')} · {t('ICE servers')}:{' '}
            {ice.servers.length ? ice.servers.flatMap((s) => [s.urls].flat()).join(', ') : t('none configured')}
          </div>
          <Check ok={ice.done ? host : null} label={t('Local network connectivity')} />
          <Check ok={ice.done ? srflx : null} label={t('Public address discovery (STUN)')} hint={!ice.servers.length ? t('No STUN/TURN servers configured: calls only work on the same network.') : undefined} />
          <Check ok={ice.done ? relay : null} label={t('Relay (TURN)')} hint={ice.done && !relay ? (hasTurn ? t('TURN is configured but not reachable. Check the TURN server, its ports and the shared secret.') : t('No TURN server configured. Calls may fail across strict firewalls.')) : t('Needed for calls across strict firewalls.')} />
        </>
      )}
      <h4 style={{ margin: '12px 0 8px' }}>{t('Devices')}</h4>
      <Check ok={mic} label={t('Microphone')} hint={micError || (mic ? t('Speak to test the level meter.') : undefined)} />
      {mic && (
        <div style={{ height: 8, background: 'var(--bg-sunken)', borderRadius: 4, overflow: 'hidden', margin: '-2px 0 10px 26px' }} aria-label={t('Microphone level')} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
          <div style={{ width: `${level * 100}%`, height: '100%', background: 'var(--success)', transition: 'width 0.08s' }} />
        </div>
      )}
      <Check ok={cam} label={t('Camera')} hint={camError || undefined} />
      {cam && <video ref={video} autoPlay muted playsInline style={{ width: 200, borderRadius: 8, marginLeft: 26, background: '#000' }} />}
    </Modal>
  );
}
