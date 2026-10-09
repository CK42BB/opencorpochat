// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Settings2,
  Video,
  VideoOff,
} from 'lucide-react';
import type { CallParticipant } from '@ocpc/shared';
import { channelTitle, displayName, useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { Avatar, Popover } from '../components/ui';
import { useCallStore } from './callStore';
import { leaveCall, switchDevice, toggleCamera, toggleMute, toggleScreen } from './controller';
import { CallDiagnostics } from './diagnostics';

type SinkElement = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

function StreamVideo({
  stream,
  className,
  mirror,
}: {
  stream: MediaStream;
  className?: string;
  mirror?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      playsInline
      muted
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}

/** Plays a remote participant's audio (video elements are muted so camera-off still plays sound). */
function StreamAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  const sinkId = useCallStore((s) => s.sinkId);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  useEffect(() => {
    const el = ref.current as SinkElement | null;
    if (el?.setSinkId && sinkId) el.setSinkId(sinkId).catch(() => {});
  }, [sinkId]);
  return <audio ref={ref} autoPlay />;
}

function useElapsed(since: number | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!since) return '';
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

function Tile({
  p,
  stream,
  local,
}: {
  p: CallParticipant;
  stream: MediaStream | null;
  local: boolean;
}) {
  const user = useStore((s) => s.users[p.userId]);
  const speaking = useCallStore((s) => !!s.speaking[p.userId]);
  const showVideo = !!stream && (p.video || p.screen) && stream.getVideoTracks().length > 0;
  return (
    <div className={`call-tile ${speaking && p.audio ? 'speaking' : ''}`}>
      {showVideo ? (
        <StreamVideo
          stream={stream!}
          className={p.screen ? 'screen' : undefined}
          mirror={local && !p.screen}
        />
      ) : (
        <Avatar user={user} size={64} />
      )}
      {!local && stream && stream.getAudioTracks().length > 0 && <StreamAudio stream={stream} />}
      <span className="tile-name">
        {!p.audio && <MicOff size={12} aria-label={t('Muted')} />}
        {p.screen && <MonitorUp size={12} aria-label={t('Sharing screen')} />}
        {local ? t('You') : displayName(user)}
      </span>
    </div>
  );
}

function DeviceSettings({
  anchor,
  onClose,
  onDiagnostics,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onDiagnostics: () => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const { micId, camId, sinkId } = useCallStore();
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then(setDevices)
      .catch(() => {});
  }, []);
  const canSink = 'setSinkId' in HTMLMediaElement.prototype;
  const select = (kind: MediaDeviceKind, label: string, value: string) => {
    const list = devices.filter((d) => d.kind === kind && d.deviceId);
    if (!list.length) return null;
    return (
      <div className="field">
        <label htmlFor={`dev-${kind}`}>{label}</label>
        <select
          id={`dev-${kind}`}
          className="select"
          value={value}
          onChange={(e) => switchDevice(kind, e.target.value)}
        >
          <option value="">{t('System default')}</option>
          {list.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        </select>
      </div>
    );
  };
  return (
    <Popover anchor={anchor} onClose={onClose} placement="top-end">
      <div style={{ padding: 14, width: 300 }}>
        {select('audioinput', t('Microphone'), micId)}
        {select('videoinput', t('Camera'), camId)}
        {canSink && select('audiooutput', t('Speaker'), sinkId)}
        <button
          className="btn btn-sm btn-block"
          onClick={() => {
            onClose();
            onDiagnostics();
          }}
        >
          {t('Call diagnostics')}
        </button>
      </div>
    </Popover>
  );
}

export function CallWindow() {
  const st = useCallStore();
  const call = useStore((s) => (st.channelId ? s.calls[st.channelId] : undefined));
  const channel = useStore((s) => (st.channelId ? s.channels[st.channelId] : undefined));
  const me = useStore((s) => s.me);
  const myConn = useStore((s) => s.connectionId);
  const elapsed = useElapsed(call ? Date.parse(call.startedAt) : st.joinedAt);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const [diagnostics, setDiagnostics] = useState(false);

  if (st.status === 'idle' || !st.channelId)
    return diagnostics ? <CallDiagnostics onClose={() => setDiagnostics(false)} /> : null;

  const title = channel
    ? channel.kind === 'public' || channel.kind === 'private'
      ? `#${channel.name}`
      : channelTitle(channel, me?.id)
    : t('Call');
  // Server membership drives tiles; fall back to a local-only tile while joining.
  const participants: CallParticipant[] = call?.participants.length
    ? call.participants
    : [
        {
          userId: me!.id,
          connectionId: myConn ?? 'local',
          joinedAt: '',
          audio: !st.muted,
          video: st.camera,
          screen: st.screen,
        },
      ];
  const ordered = [...participants].sort((a, b) => Number(b.screen) - Number(a.screen));

  return (
    <section
      className={`call-window ${st.expanded ? 'expanded' : ''}`}
      aria-label={t('Call in {name}', { name: title })}
    >
      <div className="call-head">
        <span className="grow ellipsis">
          {title} · {st.status === 'connecting' ? t('Connecting…') : elapsed}
        </span>
        <button
          className="icon-btn"
          onClick={() => useCallStore.setState({ expanded: !st.expanded })}
          aria-label={st.expanded ? t('Collapse call') : t('Expand call')}
          aria-pressed={st.expanded}
        >
          {st.expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
      <div className="call-grid" data-count={Math.min(ordered.length, 9)}>
        {ordered.map((p) => {
          const local = p.connectionId === myConn || p.connectionId === 'local';
          const stream = local
            ? st.localStream
            : ((st.remote[p.connectionId] ?? st.remote[p.userId])?.stream ?? null);
          const shown = local ? { ...p, audio: !st.muted, video: st.camera, screen: st.screen } : p;
          return <Tile key={p.connectionId} p={shown} stream={stream} local={local} />;
        })}
      </div>
      <div className="call-controls">
        <button
          className={`call-btn ${st.muted ? 'off' : ''}`}
          onClick={toggleMute}
          aria-pressed={st.muted}
          aria-label={st.muted ? t('Unmute') : t('Mute')}
          title={st.muted ? t('Unmute') : t('Mute')}
        >
          {st.muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button
          className={`call-btn ${st.camera ? '' : 'off'}`}
          onClick={toggleCamera}
          aria-pressed={st.camera}
          aria-label={st.camera ? t('Turn camera off') : t('Turn camera on')}
          title={st.camera ? t('Turn camera off') : t('Turn camera on')}
        >
          {st.camera ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        <button
          className={`call-btn ${st.screen ? '' : 'off'}`}
          onClick={toggleScreen}
          aria-pressed={st.screen}
          aria-label={st.screen ? t('Stop sharing') : t('Share screen')}
          title={st.screen ? t('Stop sharing') : t('Share screen')}
        >
          {st.screen ? <MonitorX size={18} /> : <MonitorUp size={18} />}
        </button>
        <button
          className="call-btn"
          onClick={(e) => setSettingsAnchor(e.currentTarget)}
          aria-label={t('Device settings')}
          title={t('Device settings')}
        >
          <Settings2 size={18} />
        </button>
        <button
          className="call-btn hangup"
          onClick={() => leaveCall()}
          aria-label={t('Leave call')}
          title={t('Leave call')}
        >
          <PhoneOff size={18} />
        </button>
      </div>
      {settingsAnchor && (
        <DeviceSettings
          anchor={settingsAnchor}
          onClose={() => setSettingsAnchor(null)}
          onDiagnostics={() => setDiagnostics(true)}
        />
      )}
      {diagnostics && <CallDiagnostics onClose={() => setDiagnostics(false)} />}
    </section>
  );
}
