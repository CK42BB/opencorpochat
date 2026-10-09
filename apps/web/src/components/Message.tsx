// SPDX-License-Identifier: AGPL-3.0-only
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  Bookmark,
  BookmarkCheck,
  Copy,
  CornerUpRight,
  Download,
  Edit3,
  EyeOff,
  File as FileIcon,
  MessageSquareText,
  MoreHorizontal,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
  X,
  BarChart3,
} from 'lucide-react';
import { canDeleteMessage, canEditMessage, QUICK_REACTIONS, type FileInfo, type Message as Msg } from '@ocpc/shared';
import { api } from '../lib/api';
import { displayName, toast, toastError, useStore } from '../lib/store';
import { formatBytes, formatDateTime, formatTime } from '../lib/format';
import { isJumboEmoji, renderMarkdown } from '../lib/markdown';
import { t, plural } from '../lib/i18n';
import { Avatar, confirmDialog, copyText, Menu, Popover } from './ui';
import { EmojiGlyph, EmojiPicker, pushRecent } from './EmojiPicker';
import { UserCard } from './UserCard';
import { useRenderContext } from './useRenderContext';
import { ForwardModal, ReminderModal } from './modals';

export interface MessageProps {
  message: Msg;
  continued?: boolean;
  context: 'channel' | 'thread' | 'search' | 'pins';
  highlight?: boolean;
  onOpenThread?: (rootId: string) => void;
}

export async function toggleReaction(m: Msg, emoji: string, meId: string) {
  const mine = m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(meId);
  try {
    if (mine) await api.del(`/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`);
    else {
      pushRecent(emoji);
      await api.post(`/messages/${m.id}/reactions`, { emoji });
    }
  } catch (err) {
    toastError(err);
  }
}

function Attachment({ f, onImage }: { f: FileInfo; onImage: (f: FileInfo) => void }) {
  if (f.mime.startsWith('image/') && f.mime !== 'image/svg+xml') {
    const w = f.width ?? 0;
    const h = f.height ?? 0;
    const scale = w && h ? Math.min(1, 420 / w, 320 / h) : 1;
    return (
      <img
        className="attachment-image"
        src={f.url}
        alt={f.name}
        loading="lazy"
        width={w ? Math.round(w * scale) : undefined}
        height={h ? Math.round(h * scale) : undefined}
        onClick={() => onImage(f)}
      />
    );
  }
  if (f.mime.startsWith('video/')) return <video className="attachment-video" src={f.url} controls preload="metadata" />;
  if (f.mime.startsWith('audio/')) return <audio src={f.url} controls preload="metadata" />;
  return (
    <a className="attachment-file" href={`${f.url}${f.mime === 'application/pdf' ? '' : '?download=1'}`} target="_blank" rel="noopener noreferrer">
      <span className="file-icon">
        <FileIcon size={18} />
      </span>
      <span className="grow">
        <div className="ellipsis" style={{ fontWeight: 600 }}>
          {f.name}
        </div>
        <div className="faint small">{formatBytes(f.size)}</div>
      </span>
      <Download size={16} className="faint" />
    </a>
  );
}

export function Lightbox({ file, onClose }: { file: FileInfo; onClose: () => void }) {
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={file.name} onKeyDown={(e) => e.key === 'Escape' && onClose()} tabIndex={-1} ref={(el) => el?.focus()}>
      <div className="lightbox-bar">
        <span className="grow ellipsis">{file.name}</span>
        <a className="icon-btn" href={`${file.url}?download=1`} aria-label={t('Download')}>
          <Download size={18} />
        </a>
        <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
          <X size={18} />
        </button>
      </div>
      <img src={file.url} alt={file.name} onClick={onClose} />
    </div>
  );
}

function PollView({ m }: { m: Msg }) {
  const me = useStore((s) => s.me);
  const poll = m.poll!;
  const total = new Set(poll.options.flatMap((o) => o.voterIds.map((v, i) => v || `anon-${o.id}-${i}`))).size;
  const myVotes = poll.options.filter((o) => o.voterIds.includes(me!.id)).map((o) => o.id);
  const vote = async (id: string) => {
    let next: string[];
    if (poll.multiple) next = myVotes.includes(id) ? myVotes.filter((x) => x !== id) : [...myVotes, id];
    else next = myVotes.includes(id) ? [] : [id];
    try {
      await api.post(`/messages/${m.id}/vote`, { optionIds: next });
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <div className="poll">
      <h4>
        <BarChart3 size={16} style={{ verticalAlign: -3 }} /> {poll.question}
      </h4>
      {poll.options.map((o) => {
        const pct = total ? Math.round((o.voterIds.length / total) * 100) : 0;
        return (
          <button key={o.id} className={`poll-option ${myVotes.includes(o.id) ? 'voted' : ''}`} disabled={poll.closed} onClick={() => vote(o.id)}>
            <span className="bar" style={{ width: `${pct}%` }} />
            <span className="grow">{o.text}</span>
            <span className="faint small">
              {o.voterIds.length} · {pct}%
            </span>
          </button>
        );
      })}
      <div className="faint small row">
        <span>{plural(total, '{n} vote', '{n} votes')}</span>
        {poll.anonymous && <span>· {t('anonymous')}</span>}
        {poll.multiple && <span>· {t('multiple choice')}</span>}
        {poll.closed && <span>· {t('closed')}</span>}
        <span className="spacer" />
        {m.userId === me?.id && !poll.closed && (
          <button className="btn btn-sm btn-ghost" onClick={() => api.post(`/messages/${m.id}/close-poll`).catch(toastError)}>
            {t('Close poll')}
          </button>
        )}
      </div>
    </div>
  );
}

function ForwardedPreview({ m }: { m: Msg }) {
  const src = useStore((s) => (m.forwardedFrom ? s.messages[m.forwardedFrom.messageId] : undefined));
  const author = useStore((s) => (m.forwardedFrom?.userId ? s.users[m.forwardedFrom.userId] : undefined));
  const channel = useStore((s) => (m.forwardedFrom ? s.channels[m.forwardedFrom.channelId] : undefined));
  const rc = useRenderContext();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Msg | null>(null);
  const msg = src ?? loaded;
  if (!msg && m.forwardedFrom && !loaded) {
    api.get<Msg>(`/messages/${m.forwardedFrom.messageId}`).then(setLoaded).catch(() => {});
  }
  return (
    <div className="msg-forwarded">
      <div className="row small">
        <Avatar user={author} size={18} />
        <strong>{displayName(author)}</strong>
        {channel && (channel.kind === 'public' || channel.kind === 'private') && <span className="faint">#{channel.name}</span>}
      </div>
      {msg ? <div className="msg-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.body, rc) }} /> : <div className="faint small">{t('Message unavailable')}</div>}
      {m.forwardedFrom && (
        <button className="btn btn-sm btn-ghost" style={{ padding: 0 }} onClick={() => navigate(`/c/${m.forwardedFrom!.channelId}#${m.forwardedFrom!.messageId}`)}>
          {t('View original')}
        </button>
      )}
    </div>
  );
}

function MessageImpl({ message: m, continued, context, highlight, onOpenThread }: MessageProps) {
  const me = useStore((s) => s.me)!;
  const author = useStore((s) => (m.userId ? s.users[m.userId] : undefined));
  const channel = useStore((s) => s.channels[m.channelId]);
  const settings = useStore((s) => s.settings);
  const compact = useStore((s) => s.me?.preferences.density === 'compact');
  const replyUsers = useStore((s) => m.replyUserIds.map((id) => s.users[id]));
  const rc = useRenderContext();
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [cardAnchor, setCardAnchor] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [lightbox, setLightbox] = useState<FileInfo | null>(null);
  const [modal, setModal] = useState<'forward' | 'remind' | null>(null);
  const pending = m.id.startsWith('pending-');
  const failed = pending && (m as Msg & { failed?: boolean }).failed;
  const editRef = useRef<HTMLTextAreaElement>(null);
  const editRequested = useStore((s) => s.editRequest === m.id);
  useEffect(() => {
    if (!editRequested) return;
    useStore.setState({ editRequest: null });
    setDraft(m.body);
    setEditing(true);
    document.getElementById(`m-${m.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [editRequested, m.body, m.id]);

  const actor = { id: me.id, role: me.role };
  const membership = channel?.membership ?? null;
  const canEdit = !pending && m.kind !== 'system' && canEditMessage(actor, m, settings?.messageEditWindowMinutes ?? null);
  const canDelete = !pending && m.kind !== 'system' && canDeleteMessage(actor, m, membership);

  const onBodyClick = useCallback(
    (e: ReactMouseEvent) => {
      const el = e.target as HTMLElement;
      const mention = el.closest<HTMLElement>('[data-user-id]');
      if (mention) {
        e.preventDefault();
        setCardAnchor({ id: mention.dataset.userId!, el: mention });
        return;
      }
      const ch = el.closest<HTMLElement>('[data-channel-id]');
      if (ch) {
        e.preventDefault();
        navigate(`/c/${ch.dataset.channelId}`);
      }
    },
    [navigate],
  );

  const saveEdit = async () => {
    const body = draft.trim();
    if (!body) return;
    if (body === m.body) return setEditing(false);
    try {
      await api.patch(`/messages/${m.id}`, { body });
      setEditing(false);
    } catch (err) {
      toastError(err);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: t('Delete message?'), body: t('This cannot be undone.'), confirmLabel: t('Delete'), danger: true }))) return;
    try {
      await api.del(`/messages/${m.id}`);
    } catch (err) {
      toastError(err);
    }
  };

  const remindIn = async (ms: number) => {
    try {
      await api.post('/reminders', { messageId: m.id, text: '', remindAt: new Date(Date.now() + ms).toISOString() });
      toast(t('Reminder set'), 'success');
    } catch (err) {
      toastError(err);
    }
  };

  if (m.kind === 'system') {
    return (
      <div className={`msg system continued ${highlight ? 'highlight' : ''}`} id={`m-${m.id}`}>
        <span className="msg-gutter-time">{formatTime(m.createdAt)}</span>
        <div className="msg-body" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.body, rc) }} />
      </div>
    );
  }

  const name = m.asName ?? (author ? displayName(author) : t('Unknown'));
  const showHead = !continued;
  const jumbo = isJumboEmoji(m.body) && !m.files.length;
  const permalink = `${location.origin}/c/${m.channelId}${m.threadRootId ? `?thread=${m.threadRootId}` : ''}#${m.id}`;

  if (m.deleted) {
    return (
      <div className={`msg ${continued ? 'continued' : ''}`} id={`m-${m.id}`}>
        {showHead ? <span style={{ width: 'var(--avatar)' }} /> : <span className="msg-gutter-time" />}
        <div>
          <div className="faint small" style={{ fontStyle: 'italic' }}>
            {t('This message was deleted.')}
          </div>
          {m.replyCount > 0 && context !== 'thread' && (
            <button className="thread-summary" onClick={() => onOpenThread?.(m.id)}>
              <span className="count">{plural(m.replyCount, '{n} reply', '{n} replies')}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`msg ${continued ? 'continued' : ''} ${highlight ? 'highlight' : ''} ${menuAnchor || emojiAnchor ? 'menu-open' : ''} ${pending ? 'pending' : ''} ${failed ? 'failed' : ''}`}
      id={`m-${m.id}`}
      data-message-id={m.id}
    >
      {showHead ? (
        <button className="avatar-btn" style={{ border: 0, padding: 0, background: 'none', height: 'fit-content', marginTop: 2 }} onClick={(e) => author && setCardAnchor({ id: author.id, el: e.currentTarget })} aria-label={name} tabIndex={-1}>
          <Avatar user={author} name={name} size={compact ? 28 : 36} />
        </button>
      ) : (
        <span className="msg-gutter-time">{formatTime(m.createdAt)}</span>
      )}
      <div style={{ minWidth: 0 }}>
        {showHead && (
          <div className="msg-head">
            <button className="msg-author" onClick={(e) => author && setCardAnchor({ id: author.id, el: e.currentTarget })}>
              {name}
            </button>
            {(m.kind === 'bot' || author?.isBot) && <span className="pill">{t('BOT')}</span>}
            {author?.statusEmoji && <span title={author.statusText}>{author.statusEmoji}</span>}
            <a className="msg-time" href={permalink} title={formatDateTime(m.createdAt)} onClick={(e) => e.preventDefault()}>
              {formatTime(m.createdAt)}
            </a>
            {m.pinned && (
              <span className="msg-pinned">
                <Pin size={12} /> {t('Pinned')}
              </span>
            )}
          </div>
        )}
        {editing ? (
          <div className="editing-box">
            <textarea
              ref={(el) => {
                editRef.current = el;
                if (el && document.activeElement !== el) {
                  el.focus();
                  el.setSelectionRange(el.value.length, el.value.length);
                }
              }}
              value={draft}
              rows={Math.min(10, draft.split('\n').length + 1)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                }
              }}
              aria-label={t('Edit message')}
            />
            <div className="row">
              <button className="btn btn-sm" onClick={() => setEditing(false)}>
                {t('Cancel')}
              </button>
              <button className="btn btn-sm btn-primary" onClick={saveEdit}>
                {t('Save')}
              </button>
            </div>
          </div>
        ) : (
          m.body && (
            <div className={`msg-body ${jumbo ? 'jumbo' : ''}`} onClick={onBodyClick}>
              <span dangerouslySetInnerHTML={{ __html: renderMarkdown(m.body, rc) }} />
              {m.editedAt && <span className="msg-edited" title={formatDateTime(m.editedAt)}>({t('edited')})</span>}
            </div>
          )
        )}
        {failed && (
          <div className="error-text small">
            {t('Failed to send.')}{' '}
            <button className="btn btn-sm btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('ocpc:retry', { detail: m.id }))}>
              {t('Retry')}
            </button>
          </div>
        )}
        {m.forwardedFrom && <ForwardedPreview m={m} />}
        {m.files.length > 0 && (
          <div className="attachments">
            {m.files.map((f) => (
              <Attachment key={f.id} f={f} onImage={setLightbox} />
            ))}
          </div>
        )}
        {m.poll && <PollView m={m} />}
        {m.previews.map((p) => (
          <div className="link-preview" key={p.url}>
            <div className="grow">
              <div className="site">{p.siteName}</div>
              <a className="title" href={p.url} target="_blank" rel="noopener noreferrer nofollow">
                {p.title}
              </a>
              {p.description && <div className="desc">{p.description}</div>}
            </div>
            {p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
          </div>
        ))}
        {m.reactions.length > 0 && (
          <div className="reactions">
            {m.reactions.map((r) => {
              const mine = r.userIds.includes(me.id);
              const who = r.userIds.map((id) => displayName(useStore.getState().users[id])).join(', ');
              return (
                <button key={r.emoji} className={`reaction ${mine ? 'mine' : ''}`} title={`${who} ${t('reacted with')} ${r.emoji}`} aria-pressed={mine} onClick={() => toggleReaction(m, r.emoji, me.id)}>
                  <EmojiGlyph value={r.emoji} />
                  <span className="count">{r.count}</span>
                </button>
              );
            })}
            <button className="reaction reaction-add" onClick={(e) => setEmojiAnchor(e.currentTarget)} aria-label={t('Add reaction')}>
              <SmilePlus size={14} />
            </button>
          </div>
        )}
        {m.replyCount > 0 && context !== 'thread' && !m.threadRootId && (
          <button className="thread-summary" onClick={() => onOpenThread?.(m.id)}>
            <span className="avatars">
              {replyUsers.slice(0, 4).map((u, i) => (
                <Avatar key={u?.id ?? i} user={u} size={20} />
              ))}
            </span>
            <span className="count">{plural(m.replyCount, '{n} reply', '{n} replies')}</span>
            {m.lastReplyAt && <span className="faint">{t('Last reply {time}', { time: formatDateTime(m.lastReplyAt) })}</span>}
          </button>
        )}
        {m.threadRootId && m.alsoInChannel && context === 'channel' && (
          <button className="btn btn-sm btn-ghost faint" style={{ padding: 0 }} onClick={() => onOpenThread?.(m.threadRootId!)}>
            {t('replied to a thread')}
          </button>
        )}
      </div>

      {!pending && !editing && channel && (
        <div className="msg-actions" role="toolbar" aria-label={t('Message actions')}>
          {QUICK_REACTIONS.slice(0, 3).map((e) => (
            <button key={e} className="icon-btn quick-emoji" onClick={() => toggleReaction(m, e, me.id)} aria-label={`${t('React with')} ${e}`}>
              {e}
            </button>
          ))}
          <button className="icon-btn" onClick={(e) => setEmojiAnchor(e.currentTarget)} aria-label={t('Add reaction')} title={t('Add reaction')}>
            <SmilePlus size={17} />
          </button>
          {context !== 'thread' && !m.threadRootId && (
            <button className="icon-btn" onClick={() => onOpenThread?.(m.id)} aria-label={t('Reply in thread')} title={t('Reply in thread')}>
              <MessageSquareText size={17} />
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => api[m.saved ? 'del' : 'post'](`/messages/${m.id}/save`).catch(toastError)}
            aria-label={m.saved ? t('Remove from saved') : t('Save for later')}
            title={m.saved ? t('Remove from saved') : t('Save for later')}
          >
            {m.saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
          </button>
          <button className="icon-btn" onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label={t('More actions')} title={t('More actions')} aria-haspopup="menu">
            <MoreHorizontal size={17} />
          </button>
        </div>
      )}

      {menuAnchor && (
        <Popover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} placement="bottom-end">
          <Menu
            onClose={() => setMenuAnchor(null)}
            items={[
              { label: t('Edit message'), icon: <Edit3 size={15} />, onClick: () => (setDraft(m.body), setEditing(true)), hidden: !canEdit },
              { label: m.pinned ? t('Unpin from channel') : t('Pin to channel'), icon: m.pinned ? <PinOff size={15} /> : <Pin size={15} />, onClick: () => api[m.pinned ? 'del' : 'post'](`/messages/${m.id}/pin`).catch(toastError) },
              { label: t('Forward message'), icon: <CornerUpRight size={15} />, onClick: () => setModal('forward') },
              { label: t('Copy link'), icon: <Copy size={15} />, onClick: () => copyText(permalink).then(() => toast(t('Link copied'))) },
              { label: t('Copy text'), icon: <Copy size={15} />, onClick: () => copyText(m.body).then(() => toast(t('Text copied'))), hidden: !m.body },
              { label: t('Mark unread'), icon: <EyeOff size={15} />, onClick: () => api.post(`/channels/${m.channelId}/unread`, { messageId: m.id }).catch(toastError), hidden: context !== 'channel' },
              'sep',
              { label: t('Remind me in 20 minutes'), icon: <AlarmClock size={15} />, onClick: () => remindIn(20 * 60_000) },
              { label: t('Remind me in 1 hour'), icon: <AlarmClock size={15} />, onClick: () => remindIn(3600_000) },
              { label: t('Remind me tomorrow'), icon: <AlarmClock size={15} />, onClick: () => remindIn(24 * 3600_000) },
              { label: t('Custom reminder…'), icon: <AlarmClock size={15} />, onClick: () => setModal('remind') },
              'sep',
              { label: t('Delete message'), icon: <Trash2 size={15} />, onClick: remove, danger: true, hidden: !canDelete },
            ]}
          />
        </Popover>
      )}
      {emojiAnchor && <EmojiPicker anchor={emojiAnchor} onClose={() => setEmojiAnchor(null)} onPick={(e) => toggleReaction(m, e, me.id)} />}
      {cardAnchor && <UserCard userId={cardAnchor.id} anchor={cardAnchor.el} onClose={() => setCardAnchor(null)} />}
      {lightbox && <Lightbox file={lightbox} onClose={() => setLightbox(null)} />}
      {modal === 'forward' && <ForwardModal message={m} onClose={() => setModal(null)} />}
      {modal === 'remind' && <ReminderModal messageId={m.id} onClose={() => setModal(null)} />}
    </div>
  );
}

export const Message = memo(MessageImpl);
