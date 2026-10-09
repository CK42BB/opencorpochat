// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { api } from '../lib/api';
import { channelTitle, loadThread, toastError, useStore } from '../lib/store';
import { t, plural } from '../lib/i18n';
import { Message } from './Message';
import { Composer } from './Composer';
import { isContinued } from './MessageList';
import { Spinner } from './ui';
import { TypingIndicator } from './TypingIndicator';

const EMPTY: string[] = [];

export function ThreadPanel({ rootId, onClose }: { rootId: string; onClose: () => void }) {
  const root = useStore((s) => s.messages[rootId]);
  const thread = useStore((s) => s.threads[rootId]);
  const messages = useStore((s) => s.messages);
  const channel = useStore((s) => (root ? s.channels[root.channelId] : undefined));
  const meId = useStore((s) => s.me?.id);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadThread(rootId)
      .then(() => api.post(`/threads/${rootId}/read`).catch(() => {}))
      .catch((err) => {
        toastError(err);
        onClose();
      });
  }, [rootId, onClose]);

  const replyIds = thread?.replyIds ?? EMPTY;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replyIds.length]);

  // Keep the thread marked read while it is open.
  const last = replyIds[replyIds.length - 1];
  useEffect(() => {
    if (last && messages[last]?.userId !== meId)
      api.post(`/threads/${rootId}/read`).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last]);

  // ↑ in the thread composer edits your last reply.
  useEffect(() => {
    const onEditLast = (e: Event) => {
      const d = (e as CustomEvent).detail as { threadRootId: string | null };
      if (d.threadRootId !== rootId) return;
      const mine = [...replyIds]
        .reverse()
        .find((id) => messages[id]?.userId === meId && !messages[id]?.deleted);
      if (mine) useStore.setState({ editRequest: mine });
    };
    window.addEventListener('ocpc:edit-last', onEditLast);
    return () => window.removeEventListener('ocpc:edit-last', onEditLast);
  }, [replyIds, messages, meId, rootId]);

  const toggleFollow = async () => {
    const following = !thread?.following;
    try {
      await (following
        ? api.post(`/threads/${rootId}/follow`)
        : api.del(`/threads/${rootId}/follow`));
      useStore.setState((s) => ({
        threads: { ...s.threads, [rootId]: { ...s.threads[rootId]!, following } },
      }));
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <aside className="panel" aria-label={t('Thread')}>
      <div className="panel-header">
        <h3>
          {t('Thread')}
          {channel && (
            <span className="faint small" style={{ fontWeight: 400, marginLeft: 8 }}>
              {channel.kind === 'public' || channel.kind === 'private'
                ? `#${channel.name}`
                : channelTitle(channel, meId)}
            </span>
          )}
        </h3>
        {thread && (
          <button
            className="icon-btn"
            onClick={toggleFollow}
            title={thread.following ? t('Stop following') : t('Follow thread')}
            aria-label={thread.following ? t('Stop following') : t('Follow thread')}
          >
            {thread.following ? <BellOff size={17} /> : <Bell size={17} />}
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label={t('Close thread')}>
          <X size={18} />
        </button>
      </div>
      <div className="panel-body" ref={scroller}>
        {!root || !thread ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
            <Spinner />
          </div>
        ) : (
          <div style={{ padding: '8px 0' }}>
            <Message message={root} context="thread" />
            <div className="thread-replies-divider">
              {plural(replyIds.length, '{n} reply', '{n} replies')}
            </div>
            {replyIds.map((id, i) => {
              const m = messages[id];
              return m ? (
                <Message
                  key={id}
                  message={m}
                  context="thread"
                  continued={isContinued(messages[replyIds[i - 1] ?? ''], m)}
                />
              ) : null;
            })}
          </div>
        )}
      </div>
      {channel && root && (
        <>
          <TypingIndicator channelId={channel.id} threadRootId={rootId} />
          <Composer channel={channel} threadRootId={rootId} placeholder={t('Reply…')} />
        </>
      )}
    </aside>
  );
}
