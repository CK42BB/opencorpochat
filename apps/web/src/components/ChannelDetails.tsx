// SPDX-License-Identifier: AGPL-3.0-only
// Right-hand panel with channel info, members, pinned messages, files and settings.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Bell, File as FileIcon, LogOut, Star, UserPlus, X } from 'lucide-react';
import {
  canManageChannel,
  type FileInfo,
  type Message as Msg,
  type MyChannel,
  type NotifyLevel,
  type User,
} from '@ocpc/shared';
import { api } from '../lib/api';
import { channelTitle, displayName, isDm, toast, toastError, useStore } from '../lib/store';
import { formatBytes, formatDateTime, formatDay } from '../lib/format';
import { t } from '../lib/i18n';
import { Avatar, confirmDialog, EmptyState, Spinner } from './ui';
import { Message } from './Message';
import { AddMembersModal } from './modals';
import { UserCard } from './UserCard';

export type DetailsTab = 'about' | 'members' | 'pins' | 'files' | 'settings';

export function ChannelDetails({
  channel,
  tab,
  setTab,
  onClose,
}: {
  channel: MyChannel;
  tab: DetailsTab;
  setTab: (t: DetailsTab) => void;
  onClose: () => void;
}) {
  const me = useStore((s) => s.me)!;
  const dm = isDm(channel);
  const tabs: [DetailsTab, string][] = [
    ['about', t('About')],
    ['members', t('Members')],
    ['pins', t('Pinned')],
    ['files', t('Files')],
    ...(dm ? [] : ([['settings', t('Settings')]] as [DetailsTab, string][])),
  ];
  return (
    <aside className="panel" aria-label={t('Conversation details')}>
      <div className="panel-header">
        <h3 className="ellipsis">{dm ? channelTitle(channel, me.id) : `#${channel.name}`}</h3>
        <button className="icon-btn" onClick={onClose} aria-label={t('Close details')}>
          <X size={18} />
        </button>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`tab ${tab === k ? 'active' : ''}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'about' && <About channel={channel} />}
        {tab === 'members' && <Members channel={channel} />}
        {tab === 'pins' && <Pins channel={channel} />}
        {tab === 'files' && <Files channel={channel} />}
        {tab === 'settings' && <Settings channel={channel} onClose={onClose} />}
      </div>
    </aside>
  );
}

function About({ channel }: { channel: MyChannel }) {
  const me = useStore((s) => s.me)!;
  const creator = useStore((s) => (channel.createdBy ? s.users[channel.createdBy] : undefined));
  const [topic, setTopic] = useState(channel.topic);
  const [description, setDescription] = useState(channel.description);
  const manage = canManageChannel({ id: me.id, role: me.role }, channel, channel.membership);
  useEffect(() => {
    setTopic(channel.topic);
    setDescription(channel.description);
  }, [channel.topic, channel.description]);
  const save = async (patch: Record<string, string>) => {
    try {
      await api.patch(`/channels/${channel.id}`, patch);
      toast(t('Saved'), 'success');
    } catch (err) {
      toastError(err);
    }
  };
  if (isDm(channel)) {
    return (
      <div className="panel-section">
        <p className="muted small">{t('Direct messages are private to the people in them.')}</p>
      </div>
    );
  }
  return (
    <>
      <div className="panel-section">
        <div className="field">
          <label htmlFor="cd-topic">{t('Topic')}</label>
          <input
            id="cd-topic"
            className="input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onBlur={() => topic !== channel.topic && save({ topic })}
            disabled={channel.archived}
            maxLength={250}
          />
        </div>
        <div className="field">
          <label htmlFor="cd-desc">{t('Description')}</label>
          <textarea
            id="cd-desc"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== channel.description && save({ description })}
            disabled={!manage}
            maxLength={1000}
          />
        </div>
      </div>
      <div className="panel-section small muted">
        {creator
          ? t('Created by {name} on {date}', {
              name: displayName(creator),
              date: formatDay(channel.createdAt),
            })
          : t('Created on {date}', { date: formatDay(channel.createdAt) })}
        <div>
          {channel.kind === 'private' ? t('Private channel') : t('Public channel')}
          {channel.isReadonly && ` · ${t('Announcement channel')}`}
          {channel.isDefault && ` · ${t('Everyone joins automatically')}`}
        </div>
      </div>
    </>
  );
}

function Members({ channel }: { channel: MyChannel }) {
  const me = useStore((s) => s.me)!;
  const [members, setMembers] = useState<(User & { channelRole: string })[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [card, setCard] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [q, setQ] = useState('');
  const load = () =>
    api
      .get<(User & { channelRole: string })[]>(`/channels/${channel.id}/members`)
      .then(setMembers)
      .catch(toastError);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, channel.memberCount]);
  const manage = canManageChannel({ id: me.id, role: me.role }, channel, channel.membership);
  const remove = async (u: User) => {
    if (
      !(await confirmDialog({
        title: t('Remove {name} from #{channel}?', { name: displayName(u), channel: channel.name }),
        confirmLabel: t('Remove'),
        danger: true,
      }))
    )
      return;
    try {
      await api.del(`/channels/${channel.id}/members/${u.id}`);
      load();
    } catch (err) {
      toastError(err);
    }
  };
  if (!members)
    return (
      <div style={{ padding: 20 }}>
        <Spinner />
      </div>
    );
  const list = members.filter((m) =>
    `${m.displayName} ${m.username}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ padding: '0 16px 8px' }}>
        <input
          className="input"
          placeholder={t('Find members')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('Find members')}
        />
      </div>
      {!isDm(channel) && me.role !== 'guest' && !channel.archived && (
        <button className="member-row" onClick={() => setAdding(true)}>
          <span
            className="file-icon"
            style={{
              width: 28,
              height: 28,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--brand-soft)',
              borderRadius: 6,
              color: 'var(--brand)',
            }}
          >
            <UserPlus size={16} />
          </span>
          {t('Add people')}
        </button>
      )}
      {list.map((u) => (
        <div key={u.id} className="member-row">
          <button
            className="row grow"
            style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }}
            onClick={(e) => setCard({ id: u.id, el: e.currentTarget })}
          >
            <Avatar user={u} size={28} presence />
            <span className="grow ellipsis">
              <strong>{displayName(u)}</strong> <span className="faint small">@{u.username}</span>
            </span>
          </button>
          {u.channelRole === 'admin' && <span className="pill">{t('Channel admin')}</span>}
          {u.role === 'guest' && <span className="pill">{t('Guest')}</span>}
          {manage && u.id !== me.id && !isDm(channel) && (
            <button
              className="icon-btn icon-btn-sm"
              onClick={() => remove(u)}
              aria-label={t('Remove {name}', { name: displayName(u) })}
              title={t('Remove from channel')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      {adding && <AddMembersModal channel={channel} onClose={() => (setAdding(false), load())} />}
      {card && <UserCard userId={card.id} anchor={card.el} onClose={() => setCard(null)} />}
    </div>
  );
}

function Pins({ channel }: { channel: MyChannel }) {
  const [pins, setPins] = useState<Msg[] | null>(null);
  const navigate = useNavigate();
  const pinsVersion = useStore(
    (s) => Object.values(s.messages).filter((m) => m.channelId === channel.id && m.pinned).length,
  );
  useEffect(() => {
    api
      .get<Msg[]>(`/channels/${channel.id}/pins`)
      .then((p) => {
        useStore.setState((s) => ({
          messages: { ...Object.fromEntries(p.map((m) => [m.id, m])), ...s.messages },
        }));
        setPins(p);
      })
      .catch(toastError);
  }, [channel.id, pinsVersion]);
  if (!pins)
    return (
      <div style={{ padding: 20 }}>
        <Spinner />
      </div>
    );
  if (!pins.length)
    return (
      <EmptyState title={t('No pinned messages')}>
        {t('Pin important messages from the message menu.')}
      </EmptyState>
    );
  return (
    <div style={{ padding: '8px 0' }}>
      {pins.map((m) => (
        <div
          key={m.id}
          className="list-item clickable"
          style={{ display: 'block', padding: 0 }}
          onClick={() => navigate(`/c/${channel.id}#${m.id}`)}
        >
          <Message message={useStore.getState().messages[m.id] ?? m} context="pins" />
        </div>
      ))}
    </div>
  );
}

function Files({ channel }: { channel: MyChannel }) {
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const users = useStore((s) => s.users);
  useEffect(() => {
    api.get<FileInfo[]>(`/channels/${channel.id}/files`).then(setFiles).catch(toastError);
  }, [channel.id]);
  if (!files)
    return (
      <div style={{ padding: 20 }}>
        <Spinner />
      </div>
    );
  if (!files.length)
    return (
      <EmptyState title={t('No files yet')}>
        {t('Files shared here will show up in this list.')}
      </EmptyState>
    );
  return (
    <div>
      {files.map((f) => (
        <a
          key={f.id}
          className="list-item clickable"
          href={f.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          {f.mime.startsWith('image/') ? (
            <img
              src={f.url}
              alt=""
              width={36}
              height={36}
              style={{ objectFit: 'cover', borderRadius: 6 }}
              loading="lazy"
            />
          ) : (
            <FileIcon size={28} className="faint" />
          )}
          <span className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>
              {f.name}
            </div>
            <div className="faint small">
              {displayName(users[f.uploaderId])} · {formatDateTime(f.createdAt)} ·{' '}
              {formatBytes(f.size)}
            </div>
          </span>
        </a>
      ))}
    </div>
  );
}

function Settings({ channel, onClose }: { channel: MyChannel; onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const manage = canManageChannel({ id: me.id, role: me.role }, channel, channel.membership);
  const isAdmin = me.role === 'admin' || me.role === 'owner';
  const [name, setName] = useState(channel.name);
  const updateMembership = async (
    patch: Partial<{ notifyLevel: NotifyLevel; muted: boolean; starred: boolean }>,
  ) => {
    try {
      await api.patch(`/channels/${channel.id}/membership`, patch);
    } catch (err) {
      toastError(err);
    }
  };
  const update = async (patch: Record<string, unknown>) => {
    try {
      await api.patch(`/channels/${channel.id}`, patch);
      toast(t('Saved'), 'success');
    } catch (err) {
      toastError(err);
    }
  };
  const leave = async () => {
    if (
      !(await confirmDialog({
        title: t('Leave #{name}?', { name: channel.name }),
        body:
          channel.kind === 'private'
            ? t('You will need an invitation to rejoin this private channel.')
            : undefined,
        confirmLabel: t('Leave'),
      }))
    )
      return;
    try {
      await api.post(`/channels/${channel.id}/leave`);
      onClose();
      navigate('/');
    } catch (err) {
      toastError(err);
    }
  };
  const archive = async () => {
    const action = channel.archived ? 'unarchive' : 'archive';
    if (
      !channel.archived &&
      !(await confirmDialog({
        title: t('Archive #{name}?', { name: channel.name }),
        body: t(
          'Nobody will be able to post. History stays searchable and you can unarchive later.',
        ),
        confirmLabel: t('Archive'),
        danger: true,
      }))
    )
      return;
    try {
      await api.post(`/channels/${channel.id}/${action}`);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <>
      <div className="panel-section">
        <h4>
          <Bell size={14} style={{ verticalAlign: -2 }} /> {t('Notifications')}
        </h4>
        {(['all', 'mentions', 'none'] as NotifyLevel[]).map((lvl) => (
          <label key={lvl} className="checkbox">
            <input
              type="radio"
              name="notify"
              checked={channel.membership.notifyLevel === lvl}
              onChange={() => updateMembership({ notifyLevel: lvl })}
            />
            {lvl === 'all'
              ? t('All new messages')
              : lvl === 'mentions'
                ? t('Mentions and keywords only')
                : t('Nothing')}
          </label>
        ))}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={channel.membership.muted}
            onChange={(e) => updateMembership({ muted: e.target.checked })}
          />
          {t('Mute channel (hide unread badge; mentions still notify)')}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={channel.membership.starred}
            onChange={(e) => updateMembership({ starred: e.target.checked })}
          />
          <Star size={14} /> {t('Star (show at the top of the sidebar)')}
        </label>
      </div>
      {manage && (
        <div className="panel-section">
          <h4>{t('Channel')}</h4>
          <div className="field">
            <label htmlFor="cs-name">{t('Name')}</label>
            <div className="row">
              <input
                id="cs-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className="btn"
                disabled={name === channel.name || !name}
                onClick={() => update({ name })}
              >
                {t('Rename')}
              </button>
            </div>
          </div>
          {isAdmin && (
            <>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={channel.isReadonly}
                  onChange={(e) => update({ isReadonly: e.target.checked })}
                />
                {t('Announcement channel (only admins post)')}
              </label>
              {channel.kind === 'public' && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={channel.isDefault}
                    onChange={(e) => update({ isDefault: e.target.checked })}
                  />
                  {t('Default channel (new members join automatically)')}
                </label>
              )}
            </>
          )}
          <button className="btn" onClick={archive}>
            <Archive size={15} /> {channel.archived ? t('Unarchive channel') : t('Archive channel')}
          </button>
        </div>
      )}
      <div className="panel-section">
        <button
          className="btn btn-danger"
          onClick={leave}
          disabled={channel.isDefault && me.role === 'guest'}
        >
          <LogOut size={15} /> {t('Leave channel')}
        </button>
      </div>
    </>
  );
}
