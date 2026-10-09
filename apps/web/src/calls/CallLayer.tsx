// SPDX-License-Identifier: AGPL-3.0-only
// Rendered once in the app shell: the active call window and incoming-call prompts.
import { useEffect } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { channelTitle, displayName, useStore } from '../lib/store';
import { chime, notificationPermission } from '../lib/notify';
import { t } from '../lib/i18n';
import { Avatar, Modal } from '../components/ui';
import { useCallStore } from './callStore';
import { declineRing, installCallListeners, startCall } from './controller';
import { CallWindow } from './CallWindow';
import './calls.css';

const RING_TIMEOUT_MS = 30_000;

function RingModal() {
  const ringing = useStore((s) => s.ringing);
  const activeChannel = useCallStore((s) => s.channelId);
  const caller = useStore((s) => (ringing ? s.users[ringing.fromUserId] : undefined));
  const channel = useStore((s) => (ringing ? s.channels[ringing.call.channelId] : undefined));
  const me = useStore((s) => s.me);
  const show =
    !!ringing && ringing.call.channelId !== activeChannel && ringing.fromUserId !== me?.id;

  useEffect(() => {
    if (!show || !ringing) return;
    chime('ring');
    const loop = setInterval(() => chime('ring'), 2000);
    const timeout = setTimeout(() => useStore.setState({ ringing: null }), RING_TIMEOUT_MS);
    let note: Notification | null = null;
    if (!document.hasFocus() && notificationPermission() === 'granted') {
      try {
        note = new Notification(t('Incoming call'), {
          body: t('{name} is calling you', { name: displayName(caller) }),
          tag: `call-${ringing.call.id}`,
          icon: '/icon-192.png',
          requireInteraction: true,
        });
        note.onclick = () => {
          window.focus();
          note?.close();
        };
      } catch {
        /* notifications unavailable */
      }
    }
    return () => {
      clearInterval(loop);
      clearTimeout(timeout);
      note?.close();
    };
  }, [show, ringing, caller]);

  if (!show || !ringing) return null;
  const isGroup = channel && channel.kind !== 'dm';
  return (
    <Modal onClose={declineRing}>
      <div className="ring-modal">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <span className="ring-pulse">
            <Avatar user={caller} size={72} />
          </span>
        </div>
        <h2 style={{ margin: '0 0 4px' }}>{displayName(caller)}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {isGroup && channel
            ? t('is calling {name}', { name: channelTitle(channel, me?.id) })
            : t('is calling you…')}
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 16, marginTop: 16 }}>
          <button className="btn btn-danger" onClick={declineRing} aria-label={t('Decline call')}>
            <PhoneOff size={16} /> {t('Decline')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => startCall(ringing.call.channelId)}
            aria-label={t('Accept call')}
            autoFocus
          >
            <Phone size={16} /> {t('Accept')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function CallLayer() {
  useEffect(() => installCallListeners(), []);
  return (
    <>
      <CallWindow />
      <RingModal />
    </>
  );
}
