// SPDX-License-Identifier: AGPL-3.0-only
// Threads, Activity, Saved, Search, Browse channels and People pages.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AtSign,
  Bookmark,
  Compass,
  Hash,
  Lock,
  Menu as MenuIcon,
  MessageSquareText,
  Search as SearchIcon,
  Users,
} from 'lucide-react';
import type { Channel, Message as Msg, MyChannel, Notification, User } from '@ocpc/shared';
import { api } from '../lib/api';
import { channelTitle, displayName, isDm, toastError, useStore } from '../lib/store';
import { formatRelative } from '../lib/format';
import { t, plural } from '../lib/i18n';
import { Message } from '../components/Message';
import { ThreadPanel } from '../components/ThreadPanel';
import { Avatar, EmptyState, Spinner } from '../components/ui';
import { UserCard } from '../components/UserCard';
import { CreateChannelModal } from '../components/modals';

function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="page-header">
      <button
        className="icon-btn mobile-only"
        onClick={() => window.dispatchEvent(new CustomEvent('ocpc:toggle-nav'))}
        aria-label={t('Open navigation')}
      >
        <MenuIcon size={18} />
      </button>
      <h2>{title}</h2>
      {children}
    </header>
  );
}

function putAll(msgs: Msg[]) {
  useStore.setState((s) => ({
    messages: {
      ...s.messages,
      ...Object.fromEntries(
        msgs.map((m) => [m.id, { ...m, saved: m.saved || s.messages[m.id]?.saved || false }]),
      ),
    },
  }));
}

function where(channelId: string) {
  const s = useStore.getState();
  const c = s.channels[channelId];
  if (!c) return '';
  return isDm(c) ? channelTitle(c, s.me?.id) : `#${c.name}`;
}

export function ThreadsPage() {
  const [items, setItems] = useState<{ root: Msg; latestReplies: Msg[]; unread: boolean }[] | null>(
    null,
  );
  const [open, setOpen] = useState<string | null>(null);
  const messages = useStore((s) => s.messages);
  const load = useCallback(() => {
    api
      .get<{ root: Msg; latestReplies: Msg[]; unread: boolean }[]>('/threads')
      .then((r) => {
        putAll(r.flatMap((x) => [x.root, ...x.latestReplies]));
        setItems(r);
        useStore.setState({ unreadThreads: r.filter((x) => x.unread).length });
      })
      .catch(toastError);
  }, []);
  useEffect(load, [load]);
  return (
    <>
      <main className="main">
        <PageHeader title={t('Threads')} />
        <div className="page">
          <div className="page-content">
            {!items ? (
              <Spinner />
            ) : items.length === 0 ? (
              <EmptyState icon={<MessageSquareText size={40} />} title={t('No threads yet')}>
                {t('Threads you start or reply to will appear here.')}
              </EmptyState>
            ) : (
              items.map(({ root, latestReplies, unread }) => (
                <div key={root.id} className="list-card">
                  <div className="list-card-header">
                    <span className="grow">{where(root.channelId)}</span>
                    {unread && <span className="pill pill-brand">{t('New replies')}</span>}
                  </div>
                  <Message message={messages[root.id] ?? root} context="thread" />
                  {root.replyCount > latestReplies.length && (
                    <div className="faint small" style={{ padding: '2px 20px 2px 66px' }}>
                      {plural(
                        root.replyCount - latestReplies.length,
                        '{n} more reply',
                        '{n} more replies',
                      )}
                    </div>
                  )}
                  {latestReplies.map((r) => (
                    <Message key={r.id} message={messages[r.id] ?? r} context="thread" />
                  ))}
                  <div style={{ padding: '6px 20px 12px' }}>
                    <button className="btn btn-sm" onClick={() => setOpen(root.id)}>
                      {t('Reply')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
      {open && <ThreadPanel key={open} rootId={open} onClose={() => (setOpen(null), load())} />}
    </>
  );
}

export function ActivityPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const users = useStore((s) => s.users);
  const navigate = useNavigate();
  useEffect(() => {
    api
      .get<Notification[]>(`/notifications${filter === 'unread' ? '?unread=true' : ''}`)
      .then(setItems)
      .catch(toastError);
  }, [filter]);
  const markAll = async () => {
    await api.post('/notifications/read', {}).catch(toastError);
    setItems((it) => it?.map((n) => ({ ...n, read: true })) ?? null);
    useStore.setState({ unreadNotifications: 0 });
  };
  const open = (n: Notification) => {
    if (!n.read) {
      api.post('/notifications/read', { ids: [n.id] }).catch(() => {});
      useStore.setState((s) => ({ unreadNotifications: Math.max(0, s.unreadNotifications - 1) }));
    }
    if (!n.channelId) return;
    if (n.kind === 'thread_reply' && n.messageId) {
      api
        .get<Msg>(`/messages/${n.messageId}`)
        .then((m) => navigate(`/c/${n.channelId}?thread=${m.threadRootId ?? m.id}`))
        .catch(toastError);
    } else navigate(`/c/${n.channelId}${n.messageId ? `#${n.messageId}` : ''}`);
  };
  const label: Record<Notification['kind'], string> = {
    mention: t('mentioned you'),
    dm: t('sent you a message'),
    thread_reply: t('replied in a thread'),
    keyword: t('used one of your keywords'),
    reminder: t('Reminder'),
    call: t('call'),
  };
  return (
    <main className="main">
      <PageHeader title={t('Activity')}>
        <select
          className="select"
          style={{ width: 'auto' }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | 'unread')}
          aria-label={t('Filter')}
        >
          <option value="all">{t('All')}</option>
          <option value="unread">{t('Unread')}</option>
        </select>
        <button className="btn btn-sm" onClick={markAll}>
          {t('Mark all read')}
        </button>
      </PageHeader>
      <div className="page">
        <div className="page-content">
          {!items ? (
            <Spinner />
          ) : items.length === 0 ? (
            <EmptyState icon={<AtSign size={40} />} title={t('Nothing here yet')}>
              {t('Mentions, direct messages, thread replies and reminders will show up here.')}
            </EmptyState>
          ) : (
            <div className="list-card">
              {items.map((n) => (
                <div
                  key={n.id}
                  className={`list-item clickable ${n.read ? '' : 'unread'}`}
                  onClick={() => open(n)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && open(n)}
                >
                  {n.actorId ? (
                    <Avatar user={users[n.actorId]} size={36} />
                  ) : (
                    <span style={{ fontSize: 26 }}>⏰</span>
                  )}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small">
                      {n.kind === 'reminder' ? (
                        <strong>{label.reminder}</strong>
                      ) : (
                        <>
                          <strong>{displayName(users[n.actorId ?? ''])}</strong> {label[n.kind]}
                        </>
                      )}
                      {n.channelId && <span className="faint"> · {where(n.channelId)}</span>}
                    </div>
                    <div className="ellipsis">{n.text}</div>
                  </div>
                  <span className="faint small">{formatRelative(n.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export function SavedPage() {
  const [ids, setIds] = useState<string[] | null>(null);
  const messages = useStore((s) => s.messages);
  const navigate = useNavigate();
  useEffect(() => {
    api
      .get<Msg[]>('/saved')
      .then((r) => {
        putAll(r);
        setIds(r.map((m) => m.id));
      })
      .catch(toastError);
  }, []);
  const visible = ids?.filter((id) => messages[id]?.saved) ?? null;
  return (
    <main className="main">
      <PageHeader title={t('Saved')} />
      <div className="page">
        <div className="page-content">
          {!visible ? (
            <Spinner />
          ) : visible.length === 0 ? (
            <EmptyState icon={<Bookmark size={40} />} title={t('No saved messages')}>
              {t('Save messages to come back to them later. Only you can see what you save.')}
            </EmptyState>
          ) : (
            visible.map((id) => {
              const m = messages[id]!;
              return (
                <div key={id} className="list-card">
                  <div className="list-card-header">
                    <span className="grow">{where(m.channelId)}</span>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() =>
                        navigate(
                          `/c/${m.channelId}${m.threadRootId ? `?thread=${m.threadRootId}` : ''}#${m.id}`,
                        )
                      }
                    >
                      {t('Open')}
                    </button>
                  </div>
                  <Message message={m} context="search" />
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [results, setResults] = useState<{ messages: Msg[]; hasMore: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const messages = useStore((s) => s.messages);
  const navigate = useNavigate();
  useEffect(() => {
    setInput(q);
    if (!q.trim()) return setResults(null);
    setLoading(true);
    api
      .get<{ messages: Msg[]; hasMore: boolean }>(`/search?q=${encodeURIComponent(q)}&limit=40`)
      .then((r) => {
        putAll(r.messages);
        setResults(r);
      })
      .catch(toastError)
      .finally(() => setLoading(false));
  }, [q]);
  const more = async () => {
    if (!results) return;
    const r = await api.get<{ messages: Msg[]; hasMore: boolean }>(
      `/search?q=${encodeURIComponent(q)}&limit=40&offset=${results.messages.length}`,
    );
    putAll(r.messages);
    setResults({ messages: [...results.messages, ...r.messages], hasMore: r.hasMore });
  };
  return (
    <main className="main">
      <PageHeader title={t('Search')} />
      <div className="page">
        <div className="page-content">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setParams({ q: input });
            }}
            className="row"
            style={{ marginBottom: 8 }}
          >
            <input
              className="input"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('Search messages')}
              aria-label={t('Search messages')}
            />
            <button className="btn btn-primary" type="submit">
              <SearchIcon size={16} /> {t('Search')}
            </button>
          </form>
          <p className="faint small" style={{ marginTop: 0 }}>
            {t('Filters')}: <code>in:#channel</code> <code>from:@person</code>{' '}
            <code>before:2026-01-31</code> <code>after:…</code> <code>on:…</code>{' '}
            <code>has:file</code> <code>has:link</code> <code>is:thread</code>{' '}
            <code>is:pinned</code> <code>is:saved</code> <code>"exact phrase"</code>
          </p>
          {loading && <Spinner />}
          {results && !loading && (
            <>
              <p className="muted small">
                {results.messages.length === 0
                  ? t('No results. Try different words or fewer filters.')
                  : results.hasMore
                    ? t('Showing the most recent {n}+ results', { n: results.messages.length })
                    : plural(results.messages.length, '{n} result', '{n} results')}
              </p>
              {results.messages.map((r) => {
                const m = messages[r.id] ?? r;
                return (
                  <div
                    key={m.id}
                    className="list-card list-item clickable"
                    style={{ display: 'block', padding: 0 }}
                    onClick={(e) =>
                      !(e.target as HTMLElement).closest('button, a') &&
                      navigate(
                        `/c/${m.channelId}${m.threadRootId ? `?thread=${m.threadRootId}` : ''}#${m.id}`,
                      )
                    }
                  >
                    <div className="list-card-header">
                      {where(m.channelId) || t('Public channel')}
                    </div>
                    <Message message={m} context="search" />
                  </div>
                );
              })}
              {results.hasMore && (
                <button className="btn" onClick={more}>
                  {t('Load more')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export function BrowsePage() {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [creating, setCreating] = useState(false);
  const mine = useStore((s) => s.channels);
  const navigate = useNavigate();
  useEffect(() => {
    const id = setTimeout(() => {
      api
        .get<Channel[]>(`/channels?q=${encodeURIComponent(q)}${archived ? '&archived=true' : ''}`)
        .then(setChannels)
        .catch(toastError);
    }, 150);
    return () => clearTimeout(id);
  }, [q, archived]);
  const join = async (c: Channel) => {
    try {
      const ch = await api.post<MyChannel>(`/channels/${c.id}/join`);
      useStore.setState((s) => ({ channels: { ...s.channels, [ch.id]: ch } }));
      navigate(`/c/${c.id}`);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <main className="main">
      <PageHeader title={t('Browse channels')}>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          {t('Create channel')}
        </button>
      </PageHeader>
      <div className="page">
        <div className="page-content">
          <div className="row" style={{ marginBottom: 12 }}>
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('Search by channel name')}
              aria-label={t('Search by channel name')}
              autoFocus
            />
            <label className="row small" style={{ whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />{' '}
              {t('Archived')}
            </label>
          </div>
          {!channels ? (
            <Spinner />
          ) : channels.length === 0 ? (
            <EmptyState icon={<Compass size={40} />} title={t('No channels found')} />
          ) : (
            <div className="list-card">
              {channels.map((c) => {
                const joined = !!mine[c.id];
                return (
                  <div
                    key={c.id}
                    className="list-item clickable"
                    onClick={() => navigate(`/c/${c.id}`)}
                  >
                    {c.kind === 'private' ? <Lock size={18} /> : <Hash size={18} />}
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{c.name}</div>
                      <div className="faint small ellipsis">
                        {joined && (
                          <span className="pill pill-brand" style={{ marginRight: 6 }}>
                            {t('Joined')}
                          </span>
                        )}
                        {plural(c.memberCount, '{n} member', '{n} members')}
                        {c.topic && ` · ${c.topic}`}
                      </div>
                    </div>
                    {!joined && !c.archived && (
                      <button
                        className="btn btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          join(c);
                        }}
                      >
                        {t('Join')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {creating && <CreateChannelModal onClose={() => setCreating(false)} />}
    </main>
  );
}

export function PeoplePage() {
  const users = useStore((s) => s.users);
  const groups = useStore((s) => s.groups);
  const presence = useStore((s) => s.presence);
  const [q, setQ] = useState('');
  const [card, setCard] = useState<{ id: string; el: HTMLElement } | null>(null);
  const list = Object.values(users)
    .filter(
      (u) =>
        !u.deactivated &&
        `${u.displayName} ${u.username} ${u.fullName} ${u.title}`
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort((a: User, b: User) => displayName(a).localeCompare(displayName(b)));
  return (
    <main className="main">
      <PageHeader title={t('People')} />
      <div className="page">
        <div className="page-content">
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Search by name, username or title')}
            aria-label={t('Search people')}
            style={{ marginBottom: 12 }}
            autoFocus
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            {list.map((u) => (
              <button
                key={u.id}
                className="card row"
                style={{ textAlign: 'left', margin: 0, cursor: 'pointer' }}
                onClick={(e) => setCard({ id: u.id, el: e.currentTarget })}
              >
                <Avatar user={u} size={44} presence />
                <span className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 700 }}>
                    {displayName(u)} {u.statusEmoji}
                  </div>
                  <div className="faint small ellipsis">{u.title || `@${u.username}`}</div>
                  <div className="faint small">{t(presence[u.id] ?? 'offline')}</div>
                </span>
              </button>
            ))}
          </div>
          {Object.values(groups).length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>
                <Users size={18} style={{ verticalAlign: -3 }} /> {t('Groups')}
              </h3>
              <div className="list-card">
                {Object.values(groups).map((g) => (
                  <div key={g.id} className="list-item">
                    <strong>@{g.handle}</strong>
                    <span className="grow muted">{g.name}</span>
                    <span className="faint small">
                      {plural(g.memberIds.length, '{n} member', '{n} members')}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {card && <UserCard userId={card.id} anchor={card.el} onClose={() => setCard(null)} />}
    </main>
  );
}
