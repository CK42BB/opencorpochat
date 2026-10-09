// SPDX-License-Identifier: AGPL-3.0-only
// Dialogs used across the app.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Lock, Search, X } from 'lucide-react';
import type { Invite, Message, MyChannel } from '@ocpc/shared';
import { api } from '../lib/api';
import { channelTitle, displayName, isDm, toast, toastError, useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { Avatar, copyText, Modal } from './ui';
import { openDm } from './UserCard';

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DateTimeModal({
  title,
  confirmLabel,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  onSubmit: (iso: string) => Promise<void>;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const [value, setValue] = useState(toLocalInput(new Date(Date.now() + 3600_000)));
  const [busy, setBusy] = useState(false);
  const presets: [string, () => Date][] = [
    [t('In 30 minutes'), () => new Date(Date.now() + 30 * 60_000)],
    [t('In 1 hour'), () => new Date(Date.now() + 3600_000)],
    [
      t('Tomorrow at 9:00'),
      () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    ],
    [
      t('Next Monday at 9:00'),
      () => {
        const d = new Date();
        d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
        d.setHours(9, 0, 0, 0);
        return d;
      },
    ],
  ];
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(new Date(value).toISOString());
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !value}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {presets.map(([label, fn]) => (
          <button key={label} className="btn btn-sm" onClick={() => setValue(toLocalInput(fn()))}>
            {label}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="dt">{t('Date and time')}</label>
        <input
          id="dt"
          className="input"
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
    </Modal>
  );
}

export function ReminderModal({ messageId, onClose }: { messageId?: string; onClose: () => void }) {
  const [text, setText] = useState('');
  return (
    <DateTimeModal
      title={t('Set a reminder')}
      confirmLabel={t('Set reminder')}
      onClose={onClose}
      onSubmit={async (iso) => {
        await api.post('/reminders', { messageId: messageId ?? null, text, remindAt: iso });
        toast(t('Reminder set'), 'success');
      }}
    >
      {!messageId && (
        <div className="field">
          <label htmlFor="rtext">{t('Remind me to…')}</label>
          <input
            id="rtext"
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      )}
    </DateTimeModal>
  );
}

export function ChannelPicker({
  value,
  onChange,
  filter,
}: {
  value: string | null;
  onChange: (id: string) => void;
  filter?: (c: MyChannel) => boolean;
}) {
  const channels = useStore((s) => s.channels);
  const me = useStore((s) => s.me);
  const [q, setQ] = useState('');
  const list = Object.values(channels)
    .filter((c) => !c.archived && (filter ? filter(c) : true))
    .map((c) => ({ c, title: channelTitle(c, me?.id) }))
    .filter((x) => x.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 50);
  return (
    <div>
      <input
        className="input"
        placeholder={t('Search channels and people')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t('Search channels and people')}
      />
      <div
        style={{
          maxHeight: 240,
          overflowY: 'auto',
          marginTop: 6,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {list.map(({ c, title }) => (
          <button
            key={c.id}
            className={`member-row ${value === c.id ? 'pill-brand' : ''}`}
            onClick={() => onChange(c.id)}
            aria-pressed={value === c.id}
          >
            {isDm(c) ? (
              <Avatar
                user={
                  useStore.getState().users[(c.dmUserIds ?? []).find((i) => i !== me?.id) ?? '']
                }
                size={20}
              />
            ) : c.kind === 'private' ? (
              <Lock size={16} />
            ) : (
              <Hash size={16} />
            )}
            <span className="ellipsis">{title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ForwardModal({ message, onClose }: { message: Message; onClose: () => void }) {
  const [target, setTarget] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const navigate = useNavigate();
  const send = async () => {
    if (!target) return;
    try {
      await api.post(`/messages/${message.id}/forward`, { channelId: target, comment });
      toast(t('Message forwarded'), 'success', {
        label: t('View'),
        run: () => navigate(`/c/${target}`),
      });
      onClose();
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Modal
      title={t('Forward message')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={send} disabled={!target}>
            {t('Forward')}
          </button>
        </>
      }
    >
      <ChannelPicker
        value={target}
        onChange={setTarget}
        filter={(c) => !c.isReadonly || c.membership.role === 'admin'}
      />
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="fwd-c">{t('Add a message (optional)')}</label>
        <textarea
          id="fwd-c"
          className="textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
    </Modal>
  );
}

export function CreateChannelModal({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'public' | 'private'>('public');
  const [topic, setTopic] = useState('');
  const [readonly, setReadonly] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const ch = await api.post<MyChannel>('/channels', {
        name: slug,
        kind,
        topic,
        isReadonly: readonly,
      });
      useStore.setState((s) => ({ channels: { ...s.channels, [ch.id]: ch } }));
      onClose();
      navigate(`/c/${ch.id}`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const isAdmin = me?.role === 'admin' || me?.role === 'owner';
  return (
    <Modal
      title={t('Create a channel')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => submit()} disabled={!slug || busy}>
            {t('Create')}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="ch-name">{t('Name')}</label>
          <input
            id="ch-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('e.g. marketing')}
            maxLength={80}
          />
          {slug && slug !== name && <span className="hint">#{slug}</span>}
        </div>
        <div className="field">
          <label htmlFor="ch-topic">{t('Topic (optional)')}</label>
          <input
            id="ch-topic"
            className="input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={250}
          />
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
          <legend className="label" style={{ marginBottom: 6 }}>
            {t('Visibility')}
          </legend>
          <label className="checkbox">
            <input
              type="radio"
              name="kind"
              checked={kind === 'public'}
              onChange={() => setKind('public')}
            />
            <span>
              <strong>{t('Public')}</strong> —{' '}
              <span className="muted">{t('anyone in the organization can find and join')}</span>
            </span>
          </label>
          <label className="checkbox">
            <input
              type="radio"
              name="kind"
              checked={kind === 'private'}
              onChange={() => setKind('private')}
            />
            <span>
              <strong>{t('Private')}</strong> —{' '}
              <span className="muted">{t('only invited people can see it')}</span>
            </span>
          </label>
        </fieldset>
        {isAdmin && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={readonly}
              onChange={(e) => setReadonly(e.target.checked)}
            />
            <span>
              <strong>{t('Announcement channel')}</strong> —{' '}
              <span className="muted">
                {t('only admins can post; everyone can reply in threads')}
              </span>
            </span>
          </label>
        )}
      </form>
    </Modal>
  );
}

export function UserMultiPicker({
  selected,
  onChange,
  exclude = [],
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
}) {
  const users = useStore((s) => s.users);
  const [q, setQ] = useState('');
  const list = useMemo(
    () =>
      Object.values(users)
        .filter((u) => !u.deactivated && !exclude.includes(u.id) && !selected.includes(u.id))
        .filter((u) =>
          `${u.displayName} ${u.username} ${u.fullName}`.toLowerCase().includes(q.toLowerCase()),
        )
        .sort((a, b) => displayName(a).localeCompare(displayName(b)))
        .slice(0, 40),
    [users, q, selected, exclude],
  );
  return (
    <div>
      {selected.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
          {selected.map((id) => (
            <span key={id} className="pill pill-brand row" style={{ gap: 4 }}>
              {displayName(users[id])}
              <button
                className="icon-btn icon-btn-sm"
                style={{ width: 18, height: 18 }}
                onClick={() => onChange(selected.filter((x) => x !== id))}
                aria-label={t('Remove')}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 10 }} className="faint" />
        <input
          className="input"
          style={{ paddingLeft: 32 }}
          placeholder={t('Search people')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('Search people')}
        />
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 6 }}>
        {list.map((u) => (
          <button key={u.id} className="member-row" onClick={() => onChange([...selected, u.id])}>
            <Avatar user={u} size={28} presence />
            <span className="grow ellipsis">
              <strong>{displayName(u)}</strong> <span className="faint">@{u.username}</span>
            </span>
            {u.isBot && <span className="pill">{t('BOT')}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NewDmModal({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const [selected, setSelected] = useState<string[]>([]);
  const navigate = useNavigate();
  const go = async () => {
    try {
      const ch = await openDm(selected);
      onClose();
      navigate(`/c/${ch.id}`);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Modal
      title={t('New message')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={go}
            disabled={!selected.length || selected.length > 8}
          >
            {t('Open conversation')}
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        {t('Start a direct message with one person, or a group conversation with up to 8 people.')}
      </p>
      <UserMultiPicker selected={selected} onChange={setSelected} exclude={[me.id]} />
    </Modal>
  );
}

export function AddMembersModal({ channel, onClose }: { channel: MyChannel; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [existing, setExisting] = useState<string[] | null>(null);
  if (existing === null) {
    api
      .get<{ id: string }[]>(`/channels/${channel.id}/members`)
      .then((m) => setExisting(m.map((x) => x.id)))
      .catch(() => setExisting([]));
  }
  const add = async () => {
    try {
      await api.post(`/channels/${channel.id}/members`, { userIds: selected });
      toast(t('People added'), 'success');
      onClose();
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Modal
      title={t('Add people to #{name}', { name: channel.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={add} disabled={!selected.length}>
            {t('Add')}
          </button>
        </>
      }
    >
      <UserMultiPicker selected={selected} onChange={setSelected} exclude={existing ?? []} />
    </Modal>
  );
}

export function InviteModal({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const settings = useStore((s) => s.settings);
  const [role, setRole] = useState<'member' | 'guest' | 'admin'>('member');
  const [email, setEmail] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [result, setResult] = useState<(Invite & { link: string; emailed: boolean }) | null>(null);
  const isAdmin = me.role === 'admin' || me.role === 'owner';
  const create = async () => {
    try {
      const r = await api.post<Invite & { link: string; emailed: boolean }>('/invites', {
        role,
        ...(email ? { email } : {}),
        channelIds: channelId ? [channelId] : [],
        expiresInHours: 24 * 7,
        maxUses: email ? 1 : null,
      });
      setResult(r);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Modal
      title={t('Invite people to {org}', { org: useStore.getState().info?.orgName ?? '' })}
      onClose={onClose}
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>
            {t('Done')}
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={create}
              disabled={role === 'guest' && !channelId}
            >
              {t('Create invite link')}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div>
          <p>
            {result.emailed
              ? t('We emailed the invite. You can also share this link:')
              : t('Share this link with the person you are inviting:')}
          </p>
          <div className="secret-box">
            <span className="grow">{result.link}</span>
            <button
              className="btn btn-sm"
              onClick={() => copyText(result.link).then(() => toast(t('Link copied')))}
            >
              {t('Copy')}
            </button>
          </div>
          <p className="faint small">
            {result.email
              ? t('This link works once, for {email}. It expires in 7 days.', {
                  email: result.email,
                })
              : t('Anyone with this link can join until it expires in 7 days.')}
          </p>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="inv-email">{t('Email (optional)')}</label>
            <input
              id="inv-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
            <span className="hint">{t('Leave empty to create a reusable link.')}</span>
          </div>
          <div className="field">
            <label htmlFor="inv-role">{t('Invite as')}</label>
            <select
              id="inv-role"
              className="select"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="member">{t('Member')}</option>
              {settings?.guestsEnabled && (
                <option value="guest">{t('Guest (only the channels you choose)')}</option>
              )}
              {isAdmin && <option value="admin">{t('Admin')}</option>}
            </select>
          </div>
          <div className="field">
            <label>
              {role === 'guest'
                ? t('Channel the guest can access')
                : t('Also add to channel (optional)')}
            </label>
            <ChannelPicker value={channelId} onChange={setChannelId} filter={(c) => !isDm(c)} />
          </div>
        </>
      )}
    </Modal>
  );
}

export function PollModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (poll: {
    question: string;
    options: string[];
    multiple: boolean;
    anonymous: boolean;
  }) => Promise<void>;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const valid = question.trim() && options.filter((o) => o.trim()).length >= 2;
  return (
    <Modal
      title={t('Create a poll')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            onClick={async () => {
              try {
                await onCreate({
                  question: question.trim(),
                  options: options.map((o) => o.trim()).filter(Boolean),
                  multiple,
                  anonymous,
                });
                onClose();
              } catch (err) {
                toastError(err);
              }
            }}
          >
            {t('Post poll')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="pq">{t('Question')}</label>
        <input
          id="pq"
          className="input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
        />
      </div>
      <div className="field">
        <label>{t('Options')}</label>
        {options.map((o, i) => (
          <div key={i} className="row" style={{ marginBottom: 6 }}>
            <input
              className="input"
              value={o}
              onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={t('Option {n}', { n: i + 1 })}
              aria-label={t('Option {n}', { n: i + 1 })}
              maxLength={100}
            />
            {options.length > 2 && (
              <button
                className="icon-btn"
                onClick={() => setOptions(options.filter((_, j) => j !== i))}
                aria-label={t('Remove option')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        {options.length < 10 && (
          <button className="btn btn-sm" onClick={() => setOptions([...options, ''])}>
            {t('Add option')}
          </button>
        )}
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />{' '}
        {t('Allow multiple choices')}
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
        />{' '}
        {t('Anonymous votes')}
      </label>
    </Modal>
  );
}

const STATUS_PRESETS: [string, string, number | null][] = [
  ['📅', 'In a meeting', 60],
  ['🚌', 'Commuting', 30],
  ['🤒', 'Out sick', null],
  ['🌴', 'On vacation', null],
  ['🏠', 'Working remotely', null],
  ['🎧', 'Focusing', 120],
];

export function StatusModal({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const [emoji, setEmoji] = useState(me.statusEmoji);
  const [text, setText] = useState(me.statusText);
  const [minutes, setMinutes] = useState<number | null>(null);
  const save = async (clear = false) => {
    try {
      const expiresAt =
        !clear && minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
      const updated = await api.put(
        '/me/status',
        clear ? { emoji: '', text: '', expiresAt: null } : { emoji, text, expiresAt },
      );
      useStore.setState({ me: updated as never });
      onClose();
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Modal
      title={t('Set a status')}
      onClose={onClose}
      footer={
        <>
          {(me.statusText || me.statusEmoji) && (
            <button className="btn" onClick={() => save(true)}>
              {t('Clear status')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => save()}>
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ width: 64, textAlign: 'center', fontSize: 20 }}
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          aria-label={t('Status emoji')}
          maxLength={16}
        />
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("What's your status?")}
          maxLength={100}
          aria-label={t('Status text')}
        />
      </div>
      <div className="field">
        <label htmlFor="st-exp">{t('Clear after')}</label>
        <select
          id="st-exp"
          className="select"
          value={minutes ?? ''}
          onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t("Don't clear")}</option>
          <option value="30">{t('30 minutes')}</option>
          <option value="60">{t('1 hour')}</option>
          <option value="240">{t('4 hours')}</option>
          <option value="1440">{t('Today')}</option>
          <option value="10080">{t('This week')}</option>
        </select>
      </div>
      <div className="label" style={{ marginBottom: 6 }}>
        {t('Suggestions')}
      </div>
      {STATUS_PRESETS.map(([e, label, mins]) => (
        <button
          key={label}
          className="member-row"
          onClick={() => {
            setEmoji(e);
            setText(t(label));
            setMinutes(mins);
          }}
        >
          <span style={{ fontSize: 18 }}>{e}</span> {t(label)}
          {mins && (
            <span className="faint small">
              — {mins >= 60 ? t('{n} h', { n: mins / 60 }) : t('{n} min', { n: mins })}
            </span>
          )}
        </button>
      ))}
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl/⌘ + K', 'Jump to a conversation'],
  ['Ctrl/⌘ + Shift + F', 'Search messages'],
  ['Alt + ↑ / ↓', 'Previous / next conversation'],
  ['Alt + Shift + ↑ / ↓', 'Previous / next unread conversation'],
  ['Ctrl/⌘ + Shift + A', 'All unreads: open the next unread conversation'],
  ['Ctrl/⌘ + Shift + T', 'Open Threads'],
  ['Ctrl/⌘ + Shift + M', 'Open Activity'],
  ['↑ (in empty composer)', 'Edit your last message'],
  ['Esc', 'Mark conversation read / close panel'],
  ['Shift + Esc', 'Mark all conversations read'],
  ['Enter / Shift + Enter', 'Send / new line (configurable)'],
  ['Ctrl/⌘ + B, I, Shift+X', 'Bold, italic, strikethrough'],
  ['?', 'Show keyboard shortcuts'],
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t('Keyboard shortcuts')} onClose={onClose}>
      <table className="table" style={{ marginBottom: 12 }}>
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td style={{ whiteSpace: 'nowrap' }}>
                <span className="kbd">{k}</span>
              </td>
              <td>{t(d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

export function useChannelSorted() {
  const channels = useStore((s) => s.channels);
  const me = useStore((s) => s.me);
  return useMemo(
    () => Object.values(channels).map((c) => ({ c, title: channelTitle(c, me?.id) })),
    [channels, me?.id],
  );
}
