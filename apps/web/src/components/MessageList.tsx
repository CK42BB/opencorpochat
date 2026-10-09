// SPDX-License-Identifier: AGPL-3.0-only
// Scrollable message history with day dividers, author grouping, unread divider,
// bidirectional paging and "jump to message" highlighting.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { Message as Msg, MyChannel } from '@ocpc/shared';
import { api } from '../lib/api';
import { loadAround, loadLatest, loadNewer, loadOlder, toastError, useStore } from '../lib/store';
import { formatDay, sameDay } from '../lib/format';
import { t } from '../lib/i18n';
import { Message } from './Message';
import { Spinner } from './ui';
import { ChannelIntro } from './ChannelIntro';

const GROUP_MS = 5 * 60_000;

const EMPTY: string[] = [];

export function isContinued(prev: Msg | undefined, m: Msg) {
  return (
    !!prev &&
    prev.userId === m.userId &&
    prev.kind === m.kind &&
    m.kind !== 'system' &&
    prev.asName === m.asName &&
    !prev.deleted &&
    sameDay(prev.createdAt, m.createdAt) &&
    Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_MS &&
    !(prev.replyCount > 0) &&
    !m.forwardedFrom
  );
}

export function MessageList({
  channel,
  focusMessageId,
  onOpenThread,
}: {
  channel: MyChannel;
  focusMessageId: string | null;
  onOpenThread: (id: string) => void;
}) {
  const list = useStore((s) => s.lists[channel.id]);
  const messages = useStore((s) => s.messages);
  const meId = useStore((s) => s.me?.id);
  const focused = useStore((s) => s.focused);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevHeight = useRef(0);
  const prevFirstId = useRef<string | undefined>(undefined);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  // Snapshot the read marker when the channel opens, so the divider doesn't move while reading.
  const [unreadMarker, setUnreadMarker] = useState<string | null>(null);

  useEffect(() => {
    setUnreadMarker(channel.unreadCount > 0 ? (channel.membership.lastReadMessageId ?? '0') : null);
    atBottom.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // Load initial page (or around a linked message).
  useEffect(() => {
    if (focusMessageId) {
      loadAround(channel.id, focusMessageId)
        .then(() => setHighlight(focusMessageId))
        .catch(toastError);
    } else if (!list?.loaded || list.hasMoreAfter) {
      loadLatest(channel.id).catch(toastError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, focusMessageId]);

  const ids = list?.ids ?? EMPTY;
  const lastId = ids[ids.length - 1];

  // Keep scroll position: stick to bottom for new messages, preserve offset when prepending.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const firstId = ids[0];
    if (
      prevFirstId.current &&
      firstId !== prevFirstId.current &&
      ids.includes(prevFirstId.current)
    ) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (highlight && document.getElementById(`m-${highlight}`)) {
      document.getElementById(`m-${highlight}`)!.scrollIntoView({ block: 'center' });
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirstId.current = firstId;
    prevHeight.current = el.scrollHeight;
  }, [ids, highlight]);

  useEffect(() => {
    if (!highlight) return;
    const id = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(id);
  }, [highlight]);

  // Mark read when the newest message is visible and the window is focused.
  const markRead = useCallback(() => {
    const ch = useStore.getState().channels[channel.id];
    if (!ch || !lastId || lastId.startsWith('pending-') || list?.hasMoreAfter) return;
    if (
      ch.unreadCount === 0 &&
      ch.mentionCount === 0 &&
      (ch.membership.lastReadMessageId ?? '') >= lastId
    )
      return;
    useStore.setState((s) => ({
      channels: {
        ...s.channels,
        [channel.id]: {
          ...ch,
          unreadCount: 0,
          mentionCount: 0,
          membership: { ...ch.membership, lastReadMessageId: lastId },
        },
      },
    }));
    api.post(`/channels/${channel.id}/read`, { messageId: lastId }).catch(() => {});
  }, [channel.id, lastId, list?.hasMoreAfter]);

  useEffect(() => {
    if (focused && atBottom.current && document.visibilityState === 'visible') markRead();
  }, [focused, lastId, markRead]);

  const onScroll = () => {
    const el = scroller.current!;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < 40;
    setShowJump(distance > 600 || !!list?.hasMoreAfter);
    if (el.scrollTop < 300 && list?.hasMoreBefore && !list.loading) {
      prevHeight.current = el.scrollHeight;
      loadOlder(channel.id).catch(toastError);
    }
    if (distance < 300 && list?.hasMoreAfter && !list.loading)
      loadNewer(channel.id).catch(toastError);
    if (atBottom.current && useStore.getState().focused) markRead();
  };

  const jumpToPresent = async () => {
    atBottom.current = true;
    if (list?.hasMoreAfter) await loadLatest(channel.id).catch(toastError);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowJump(false);
  };

  // Edit-last-message shortcut.
  useEffect(() => {
    const onEditLast = (e: Event) => {
      const d = (e as CustomEvent).detail as { channelId: string; threadRootId: string | null };
      if (d.channelId !== channel.id || d.threadRootId) return;
      const mine = [...ids]
        .reverse()
        .find(
          (id) =>
            messages[id]?.userId === meId &&
            !messages[id]?.deleted &&
            messages[id]?.kind !== 'system',
        );
      if (mine) useStore.setState({ editRequest: mine });
    };
    window.addEventListener('ocpc:edit-last', onEditLast);
    return () => window.removeEventListener('ocpc:edit-last', onEditLast);
  }, [ids, messages, meId, channel.id]);

  if (!list?.loaded) {
    return (
      <div className="messages" style={{ display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  }

  let dividerShown = false;
  return (
    <div
      className="messages"
      ref={scroller}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label={t('Messages')}
      aria-relevant="additions"
    >
      {list.hasMoreBefore ? (
        <div className="load-more">
          <Spinner />
        </div>
      ) : (
        <ChannelIntro channel={channel} />
      )}
      {ids.map((id, i) => {
        const m = messages[id];
        if (!m) return null;
        const prev = i > 0 ? messages[ids[i - 1]!] : undefined;
        const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
        const showUnread =
          !dividerShown &&
          unreadMarker !== null &&
          id > unreadMarker &&
          m.userId !== meId &&
          !id.startsWith('pending-');
        if (showUnread) dividerShown = true;
        return (
          <Fragment key={id}>
            {newDay && (
              <div className="day-divider" role="separator">
                <span>{formatDay(m.createdAt)}</span>
              </div>
            )}
            {showUnread && (
              <div className="unread-divider" role="separator">
                {t('New')}
              </div>
            )}
            <Message
              message={m}
              continued={!newDay && !showUnread && isContinued(prev, m)}
              context="channel"
              highlight={highlight === id}
              onOpenThread={onOpenThread}
            />
          </Fragment>
        );
      })}
      {list.hasMoreAfter && (
        <div className="load-more">
          <Spinner />
        </div>
      )}
      {showJump && (
        <button
          className="btn btn-sm btn-primary"
          style={{
            position: 'sticky',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 4,
            boxShadow: 'var(--shadow)',
          }}
          onClick={jumpToPresent}
        >
          <ArrowDown size={14} /> {t('Jump to recent messages')}
        </button>
      )}
    </div>
  );
}
