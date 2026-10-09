// SPDX-License-Identifier: AGPL-3.0-only
// Call lifecycle: join/leave, media toggles and wiring of realtime signaling events.
// UI components call these functions; they hold no WebRTC logic themselves.
import type { CallInfo, CallSignal, IceServer } from '@ocpc/shared';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { toast, toastError, useStore } from '../lib/store';
import { initialCallState, useCallStore } from './callStore';
import { MeshTransport, peersToOffer } from './mesh';
import type { CallTransport, DeviceKind } from './transport';

interface JoinResponse {
  call: CallInfo;
  mode: 'mesh' | 'livekit';
  iceServers: IceServer[];
  livekit: { url: string; token: string } | null;
}

let transport: CallTransport | null = null;

// Console helper for troubleshooting calls (see docs/admin-guide.md → Troubleshooting).
(globalThis as { ocpcCallDebug?: () => Promise<unknown> }).ocpcCallDebug = async () => ({
  state: {
    ...useCallStore.getState(),
    localStream: undefined,
    remote: Object.keys(useCallStore.getState().remote ?? {}),
  },
  peers:
    (await (transport as { debugInfo?: () => Promise<unknown> } | null)?.debugInfo?.()) ?? null,
});
let joining = false;

async function waitForConnection(timeoutMs = 5000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const id = useStore.getState().connectionId;
    if (id) return id;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

function postMedia() {
  const s = useCallStore.getState();
  const connectionId = useStore.getState().connectionId;
  if (!s.channelId || !connectionId) return;
  api
    .post(`/channels/${s.channelId}/call/media`, {
      connectionId,
      audio: !s.muted,
      video: s.camera,
      screen: s.screen,
    })
    .catch(() => {});
}

export async function startCall(channelId: string) {
  const cur = useCallStore.getState();
  if (cur.channelId === channelId) {
    useCallStore.setState({ expanded: true });
    return;
  }
  if (joining) return;
  if (!navigator.mediaDevices || typeof RTCPeerConnection === 'undefined') {
    toast(t('Calls need a modern browser over a secure (HTTPS) connection.'), 'error');
    return;
  }
  joining = true;
  try {
    if (cur.channelId) await leaveCall();
    const connectionId = await waitForConnection();
    if (!connectionId) {
      toast(t('Reconnecting to the server… try again in a moment.'), 'error');
      return;
    }
    useCallStore.setState({
      ...initialCallState,
      status: 'connecting',
      channelId,
      joinedAt: Date.now(),
      sinkId: cur.sinkId,
      micId: cur.micId,
      camId: cur.camId,
    });
    const res = await api.post<JoinResponse>(`/channels/${channelId}/call/join`, {
      connectionId,
      audio: true,
      video: false,
    });
    useCallStore.setState({ callId: res.call.id, mode: res.mode });
    if (useStore.getState().ringing?.call.channelId === channelId)
      useStore.setState({ ringing: null });

    if (res.mode === 'livekit' && res.livekit) {
      const { LiveKitTransport } = await import('./livekit');
      const lk = new LiveKitTransport(
        res.livekit.url,
        res.livekit.token,
        useStore.getState().me!.id,
        () => {
          if (useCallStore.getState().channelId === channelId) leaveCall();
        },
      );
      transport = lk;
      await lk.init();
    } else {
      const me = useStore.getState().me!;
      const mesh = new MeshTransport(res.call.id, connectionId, me.id, res.iceServers, () => {
        if (useCallStore.getState().screen) toggleScreen();
      });
      transport = mesh;
      // Connect first; the microphone is attached when (and if) permission is granted,
      // so an unanswered permission prompt never blocks the call.
      const others = peersToOffer(res.call, connectionId);
      for (const p of others) mesh.connectTo(p.connectionId, p.userId, true);
      if (!others.length) useCallStore.setState({ status: 'connected' });
      mesh.init().catch((err) => {
        toastError(err);
        toast(t('You joined listen-only. Unmute to try your microphone again.'));
        useCallStore.setState({ muted: true });
      });
    }
    postMedia();
  } catch (err) {
    toastError(err);
    await leaveCall();
  } finally {
    joining = false;
  }
}

export async function leaveCall(opts: { notifyServer?: boolean } = {}) {
  const s = useCallStore.getState();
  const tr = transport;
  transport = null;
  const connectionId = useStore.getState().connectionId;
  // Hang up from the user's point of view first: hide the call UI and tell the server, so
  // others see us leave immediately even if tearing down media devices is slow.
  useCallStore.setState({ ...initialCallState, sinkId: s.sinkId, micId: s.micId, camId: s.camId });
  const notify =
    s.channelId && connectionId && opts.notifyServer !== false
      ? api.post(`/channels/${s.channelId}/call/leave`, { connectionId }).catch(() => {})
      : Promise.resolve();
  // Release devices after the server knows we left (teardown can block on some platforms).
  await notify;
  try {
    tr?.close();
  } catch (err) {
    console.warn('call teardown failed', err);
  }
}

async function apply(fn: (t: CallTransport) => Promise<void>, rollback: () => void) {
  if (!transport) return;
  try {
    await fn(transport);
  } catch (err) {
    rollback();
    toastError(err);
  }
  postMedia();
}

export function toggleMute() {
  const muted = !useCallStore.getState().muted;
  useCallStore.setState({ muted });
  return apply(
    (tr) => tr.setAudioEnabled(!muted),
    () => useCallStore.setState({ muted: true }),
  );
}

export function toggleCamera() {
  const camera = !useCallStore.getState().camera;
  useCallStore.setState({ camera });
  return apply(
    (tr) => tr.setCamera(camera),
    () => useCallStore.setState({ camera: false }),
  );
}

export function toggleScreen() {
  const screen = !useCallStore.getState().screen;
  if (screen && !navigator.mediaDevices?.getDisplayMedia) {
    toast(t('Screen sharing is not supported in this browser.'), 'error');
    return Promise.resolve();
  }
  useCallStore.setState({ screen });
  return apply(
    (tr) => tr.setScreen(screen),
    () => useCallStore.setState({ screen: false }),
  );
}

export async function switchDevice(kind: DeviceKind, deviceId: string) {
  if (kind === 'audiooutput') useCallStore.setState({ sinkId: deviceId });
  if (kind === 'audioinput') useCallStore.setState({ micId: deviceId });
  if (kind === 'videoinput') useCallStore.setState({ camId: deviceId });
  if (kind === 'audiooutput' && useCallStore.getState().mode === 'mesh') return;
  try {
    await transport?.switchDevice(kind, deviceId);
  } catch (err) {
    toastError(err);
  }
}

export async function declineRing() {
  const ring = useStore.getState().ringing;
  useStore.setState({ ringing: null });
  if (ring) await api.post(`/channels/${ring.call.channelId}/call/decline`).catch(() => {});
}

// ---------- realtime wiring (installed once) ----------
let installed = false;
export function installCallListeners() {
  if (installed) return;
  installed = true;

  window.addEventListener('ocpc:call-signal', (e) => {
    const d = (
      e as CustomEvent<{
        callId: string;
        fromUserId: string;
        fromConnectionId: string;
        signal: CallSignal;
      }>
    ).detail;
    if (!transport || d.callId !== useCallStore.getState().callId) return;
    transport.handleSignal(d.fromConnectionId, d.fromUserId, d.signal);
  });

  window.addEventListener('ocpc:call-updated', (e) => {
    const d = (e as CustomEvent<{ call: CallInfo | null; channelId: string }>).detail;
    const s = useCallStore.getState();
    if (d.channelId !== s.channelId || s.status === 'idle' || joining) return;
    const myConn = useStore.getState().connectionId;
    if (!d.call || d.call.id !== s.callId) {
      leaveCall({ notifyServer: false });
      return;
    }
    if (!d.call.participants.some((p) => p.connectionId === myConn)) {
      // Joined from another tab or device, or removed by the server.
      toast(t('You joined this call from another window.'));
      leaveCall({ notifyServer: false });
      return;
    }
    transport?.onParticipants(d.call);
  });

  window.addEventListener('ocpc:start-call', (e) => startCall((e as CustomEvent<string>).detail));

  // Leave cleanly when the page goes away (fetch keepalive survives unload; sendBeacon can't set the CSRF header).
  window.addEventListener('pagehide', () => {
    const s = useCallStore.getState();
    const connectionId = useStore.getState().connectionId;
    if (!s.channelId || !connectionId) return;
    fetch(`/api/v1/channels/${s.channelId}/call/leave`, {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-OCPC-CSRF': '1' },
      body: JSON.stringify({ connectionId }),
    }).catch(() => {});
  });

  // A dropped WebSocket means the server already removed us from the call.
  let wasConnected = useStore.getState().connected;
  useStore.subscribe((st) => {
    if (wasConnected && !st.connected && useCallStore.getState().status !== 'idle') {
      toast(t('Connection lost. You left the call.'), 'error');
      leaveCall({ notifyServer: false });
    }
    wasConnected = st.connected;
  });
}
