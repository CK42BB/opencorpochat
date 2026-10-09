// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Lock } from 'lucide-react';
import type { Channel } from '@ocpc/shared';
import { api } from '../lib/api';
import { displayName, toast, toastError, useStore } from '../lib/store';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { confirmDialog, Spinner } from '../components/ui';
import { SectionTitle } from './common';

export function Channels() {
  const users = useStore((s) => s.users);
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try {
      const [active, archived] = await Promise.all([
        api.get<Channel[]>('/channels?all=true'),
        api.get<Channel[]>('/channels?all=true&archived=true'),
      ]);
      setChannels([...active, ...archived].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      toastError(err);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const update = async (c: Channel, body: Record<string, unknown>) => {
    try {
      await api.patch(`/channels/${c.id}`, body);
      toast(t('Saved'), 'success');
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const toggleArchive = async (c: Channel) => {
    if (
      !c.archived &&
      !(await confirmDialog({
        title: t('Archive #{name}?', { name: c.name }),
        body: t(
          'Nobody will be able to post. History stays searchable and you can unarchive later.',
        ),
        confirmLabel: t('Archive'),
        danger: true,
      }))
    )
      return;
    try {
      await api.post(`/channels/${c.id}/${c.archived ? 'unarchive' : 'archive'}`);
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const list = (channels ?? []).filter((c) => c.name.includes(q.toLowerCase()));
  return (
    <>
      <SectionTitle title={t('Channels')} />
      <p className="muted small" style={{ marginTop: 0 }}>
        {t(
          'All public and private channels in the organization. Direct messages are never listed.',
        )}
      </p>
      <div className="admin-filters">
        <input
          className="input"
          placeholder={t('Search by channel name')}
          aria-label={t('Search by channel name')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      {!channels ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Channel')}</th>
                <th>{t('Members')}</th>
                <th>{t('Last activity')}</th>
                <th>{t('Default')}</th>
                <th>{t('Announcement')}</th>
                <th>
                  <span className="sr-only">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} style={c.archived ? { opacity: 0.6 } : undefined}>
                  <td>
                    <button
                      className="row"
                      style={{ border: 0, background: 'none', padding: 0, fontWeight: 700 }}
                      onClick={() => navigate(`/c/${c.id}`)}
                    >
                      {c.kind === 'private' ? <Lock size={15} /> : <Hash size={15} />} {c.name}
                    </button>
                    <div className="faint small">
                      {c.createdBy ? t('by {name}', { name: displayName(users[c.createdBy]) }) : ''}
                      {c.archived && ` · ${t('archived')}`}
                    </div>
                  </td>
                  <td className="small">{c.memberCount}</td>
                  <td className="small faint">
                    {c.lastMessageAt ? formatDateTime(c.lastMessageAt) : t('No messages')}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={c.isDefault}
                      disabled={c.kind !== 'public' || c.archived}
                      onChange={(e) => update(c, { isDefault: e.target.checked })}
                      aria-label={t('Default channel: {name}', { name: c.name })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={c.isReadonly}
                      disabled={c.archived}
                      onChange={(e) => update(c, { isReadonly: e.target.checked })}
                      aria-label={t('Announcement channel: {name}', { name: c.name })}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => toggleArchive(c)}
                      disabled={c.isDefault && !c.archived}
                    >
                      {c.archived ? t('Unarchive') : t('Archive')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
