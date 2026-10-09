// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Phone } from 'lucide-react';
import { api } from '../lib/api';
import { displayName, toastError, useStore } from '../lib/store';
import { localTimeIn } from '../lib/format';
import { t } from '../lib/i18n';
import { Avatar, Popover } from './ui';
import type { MyChannel } from '@ocpc/shared';

export async function openDm(userIds: string[]) {
  const ch = await api.post<MyChannel>('/dms', { userIds });
  useStore.setState((s) => ({ channels: { ...s.channels, [ch.id]: ch } }));
  return ch;
}

export function UserCard({ userId, anchor, onClose }: { userId: string; anchor: HTMLElement | DOMRect; onClose: () => void }) {
  const user = useStore((s) => s.users[userId]);
  const me = useStore((s) => s.me);
  const presence = useStore((s) => s.presence[userId] ?? 'offline');
  const navigate = useNavigate();
  const [details, setDetails] = useState<{ email?: string; phone?: string } | null>(null);
  useEffect(() => {
    api.get<{ email?: string; phone?: string }>(`/users/${userId}`).then(setDetails).catch(() => {});
  }, [userId]);
  if (!user) return null;
  const message = async (call = false) => {
    try {
      const ch = await openDm([userId]);
      onClose();
      navigate(`/c/${ch.id}${call ? '?call=1' : ''}`);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} placement="right-start">
      <div style={{ width: 300 }}>
        <div style={{ padding: 16, display: 'flex', gap: 12 }}>
          <Avatar user={user} size={64} presence />
          <div className="grow">
            <div style={{ fontWeight: 800, fontSize: 17 }}>{displayName(user)}</div>
            <div className="muted small">
              @{user.username}
              {user.pronouns && ` · ${user.pronouns}`}
            </div>
            {user.title && <div className="small">{user.title}</div>}
            <div className="faint small" style={{ marginTop: 4 }}>
              {t(presence)}
              {user.timezone && ` · ${localTimeIn(user.timezone)} ${t('local time')}`}
            </div>
          </div>
        </div>
        {(user.statusEmoji || user.statusText) && (
          <div style={{ padding: '0 16px 12px' }} className="small">
            {user.statusEmoji} {user.statusText}
          </div>
        )}
        {user.deactivated && <div className="pill" style={{ margin: '0 16px 12px' }}>{t('Deactivated')}</div>}
        {details?.email && !user.isBot && (
          <div className="small" style={{ padding: '0 16px 4px' }}>
            <span className="faint">{t('Email')}: </span>
            <a href={`mailto:${details.email}`}>{details.email}</a>
          </div>
        )}
        {details?.phone && (
          <div className="small" style={{ padding: '0 16px 4px' }}>
            <span className="faint">{t('Phone')}: </span>
            {details.phone}
          </div>
        )}
        {userId !== me?.id && !user.deactivated && (
          <div className="row" style={{ padding: 12 }}>
            <button className="btn btn-sm grow" onClick={() => message()}>
              <MessageSquare size={14} /> {t('Message')}
            </button>
            {!user.isBot && (
              <button className="btn btn-sm grow" onClick={() => message(true)}>
                <Phone size={14} /> {t('Call')}
              </button>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}
