// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronDown,
  Hash,
  Headphones,
  Info,
  Lock,
  Menu as MenuIcon,
  Phone,
  Pin,
  Users,
} from 'lucide-react';
import type { Channel, MyChannel } from '@ocpc/shared';
import { api } from '../lib/api';
import { channelTitle, displayName, isDm, toastError, useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { ThreadPanel } from '../components/ThreadPanel';
import { ChannelDetails, type DetailsTab } from '../components/ChannelDetails';
import { TypingIndicator } from '../components/TypingIndicator';
import { Avatar, EmptyState, Spinner } from '../components/ui';
import { startCall } from '../calls/controller';

function useNavToggle() {
  return () => window.dispatchEvent(new CustomEvent('ocpc:toggle-nav'));
}

export function ChannelView() {
  const { channelId } = useParams<{ channelId: string }>();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const channel = useStore((s) => (channelId ? s.channels[channelId] : undefined));
  const me = useStore((s) => s.me)!;
  const users = useStore((s) => s.users);
  const call = useStore((s) => (channelId ? s.calls[channelId] : undefined));
  const [preview, setPreview] = useState<Channel | null | 'missing'>(null);
  const [details, setDetails] = useState<DetailsTab | null>(null);
  const threadId = params.get('thread');
  const focusMessageId = location.hash ? location.hash.slice(1) : null;
  const toggleNav = useNavToggle();

  useEffect(() => {
    useStore.setState({ activeChannelId: channelId ?? null });
    try {
      if (channelId) localStorage.setItem('ocpc.lastChannel', channelId);
    } catch {
      /* ignore */
    }
    return () => useStore.setState({ activeChannelId: null });
  }, [channelId]);

  useEffect(() => {
    setDetails(null);
    if (!channel && channelId) {
      api
        .get<Channel>(`/channels/${channelId}`)
        .then(setPreview)
        .catch(() => setPreview('missing'));
    } else setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, !!channel]);

  // /c/:id?call=1 starts a call (used by "Call" buttons on profiles).
  useEffect(() => {
    if (channel && params.get('call') === '1') {
      params.delete('call');
      setParams(params, { replace: true });
      startCall(channel.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id]);

  const openThread = useCallback(
    (rootId: string) => {
      setDetails(null);
      const p = new URLSearchParams(params);
      p.set('thread', rootId);
      setParams(p);
    },
    [params, setParams],
  );
  const closeThread = useCallback(() => {
    const p = new URLSearchParams(params);
    p.delete('thread');
    setParams(p);
  }, [params, setParams]);

  // Esc marks read / closes panels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.overlay, .popover'))
        return;
      if (threadId) closeThread();
      else if (details) setDetails(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [threadId, details, closeThread]);

  if (!channel) {
    if (preview === 'missing') {
      return (
        <main className="main">
          <EmptyState title={t('Conversation not found')}>
            {t("It may have been deleted, or you don't have access.")}
          </EmptyState>
        </main>
      );
    }
    if (!preview) {
      return (
        <main className="main" style={{ display: 'grid', placeItems: 'center' }}>
          <Spinner />
        </main>
      );
    }
    return <ChannelPreview channel={preview} />;
  }

  const dm = isDm(channel);
  const title = channelTitle(channel, me.id);
  const other =
    dm && channel.dmUserIds?.length === 2
      ? users[channel.dmUserIds.find((id) => id !== me.id) ?? '']
      : undefined;
  const inCall = call?.participants.some((p) => p.userId === me.id);

  return (
    <>
      <main className="main" aria-label={title}>
        <header className="channel-header">
          <button
            className="icon-btn mobile-only"
            onClick={toggleNav}
            aria-label={t('Open navigation')}
          >
            <MenuIcon size={18} />
          </button>
          <button
            className="title-btn"
            onClick={() => setDetails(details === 'about' ? null : 'about')}
            aria-label={t('Conversation details')}
          >
            <h2 className="ellipsis">
              {dm ? (
                other ? (
                  <Avatar user={other} size={22} presence />
                ) : (
                  <Users size={18} />
                )
              ) : channel.kind === 'private' ? (
                <Lock size={18} />
              ) : (
                <Hash size={18} />
              )}
              <span className="ellipsis">{title}</span>
              <ChevronDown size={16} className="faint" />
            </h2>
          </button>
          {other?.statusEmoji && <span title={other.statusText}>{other.statusEmoji}</span>}
          <span className="topic" title={channel.topic}>
            {dm && other ? other.title || other.statusText : channel.topic}
          </span>
          {!dm && (
            <button
              className="member-stack"
              onClick={() => setDetails(details === 'members' ? null : 'members')}
              aria-label={t('{n} members', { n: channel.memberCount })}
            >
              <Users size={15} /> {channel.memberCount}
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => setDetails(details === 'pins' ? null : 'pins')}
            aria-label={t('Pinned messages')}
            title={t('Pinned messages')}
          >
            <Pin size={17} />
          </button>
          {!channel.archived && (
            <button
              className={`icon-btn ${inCall ? 'active' : ''}`}
              onClick={() => startCall(channel.id)}
              aria-label={dm ? t('Start a call') : t('Start a huddle')}
              title={dm ? t('Start a call') : t('Start a huddle')}
            >
              {dm ? <Phone size={17} /> : <Headphones size={17} />}
            </button>
          )}
          <button
            className={`icon-btn ${details ? 'active' : ''}`}
            onClick={() => setDetails(details ? null : 'about')}
            aria-label={t('Details')}
            title={t('Details')}
          >
            <Info size={17} />
          </button>
        </header>
        {call && !inCall && (
          <div className="call-banner">
            <Headphones size={16} />
            <span className="grow">
              {t('{n} in a call', { n: call.participants.length })}:{' '}
              {call.participants.map((p) => displayName(users[p.userId])).join(', ')}
            </span>
            <button className="btn btn-sm btn-primary" onClick={() => startCall(channel.id)}>
              {t('Join')}
            </button>
          </div>
        )}
        <MessageList channel={channel} focusMessageId={focusMessageId} onOpenThread={openThread} />
        <TypingIndicator channelId={channel.id} />
        <Composer
          channel={channel}
          placeholder={
            dm ? t('Message {name}', { name: title }) : t('Message #{name}', { name: channel.name })
          }
        />
      </main>
      {threadId ? (
        <ThreadPanel key={threadId} rootId={threadId} onClose={closeThread} />
      ) : details ? (
        <ChannelDetails
          channel={channel}
          tab={details}
          setTab={setDetails}
          onClose={() => setDetails(null)}
        />
      ) : null}
    </>
  );
}

function ChannelPreview({ channel }: { channel: Channel }) {
  const me = useStore((s) => s.me)!;
  const [joining, setJoining] = useState(false);
  const join = async () => {
    setJoining(true);
    try {
      const ch = await api.post<MyChannel>(`/channels/${channel.id}/join`);
      useStore.setState((s) => ({ channels: { ...s.channels, [ch.id]: ch } }));
    } catch (err) {
      toastError(err);
    } finally {
      setJoining(false);
    }
  };
  const pseudo: MyChannel = {
    ...channel,
    membership: {
      channelId: channel.id,
      userId: me.id,
      role: 'member',
      notifyLevel: 'mentions',
      muted: false,
      starred: false,
      lastReadMessageId: null,
      joinedAt: '',
    },
    unreadCount: 0,
    mentionCount: 0,
  };
  return (
    <main className="main">
      <header className="channel-header">
        <h2>
          {channel.kind === 'private' ? <Lock size={18} /> : <Hash size={18} />} {channel.name}
        </h2>
        <span className="topic">{channel.topic}</span>
      </header>
      <MessageList channel={pseudo} focusMessageId={null} onOpenThread={() => {}} />
      <div className="composer-wrap">
        <div className="composer-disabled col" style={{ alignItems: 'center' }}>
          <div>
            {t('You are viewing')} <strong>#{channel.name}</strong>
          </div>
          {!channel.archived && (
            <button className="btn btn-primary" onClick={join} disabled={joining}>
              {t('Join channel')}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
