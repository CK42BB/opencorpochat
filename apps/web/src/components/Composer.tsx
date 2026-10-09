// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, BarChart3, Bold, Clock, Code, Italic, Link2, Paperclip, Plus, SendHorizontal, Smile, Strikethrough, X } from 'lucide-react';
import { canPostInChannel, searchEmoji, type FileInfo, type Message, type MyChannel } from '@ocpc/shared';
import { api, imageSize, uploadFile } from '../lib/api';
import { addPending, displayName, removeMessage, toast, toastError, useStore } from '../lib/store';
import { send as wsSend } from '../lib/realtime';
import { t } from '../lib/i18n';
import { formatBytes } from '../lib/format';
import { Avatar, Menu, Popover } from './ui';
import { EmojiPicker } from './EmojiPicker';
import { DateTimeModal, PollModal } from './modals';

interface Upload {
  key: string;
  file: File;
  progress: number;
  info?: FileInfo;
  error?: string;
  abort?: () => void;
  preview?: string;
}

interface Suggestion {
  id: string;
  label: React.ReactNode;
  insert: string;
  hint?: string;
}

interface Command {
  command: string;
  description: string;
  usageHint: string;
}

let commandsCache: Command[] | null = null;
let pendingSeq = 0;

const draftKey = (channelId: string, threadRootId: string | null) => `ocpc.draft.${channelId}.${threadRootId ?? ''}`;
function loadDraft(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function saveDraft(key: string, v: string) {
  try {
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function Composer({ channel, threadRootId = null, placeholder }: { channel: MyChannel; threadRootId?: string | null; placeholder?: string }) {
  const me = useStore((s) => s.me)!;
  const users = useStore((s) => s.users);
  const groups = useStore((s) => s.groups);
  const channels = useStore((s) => s.channels);
  const customEmoji = useStore((s) => s.emoji);
  const info = useStore((s) => s.info);
  const enterToSend = me.preferences.enterToSend;
  const navigate = useNavigate();
  const key = draftKey(channel.id, threadRootId);
  const [text, setText] = useState(() => loadDraft(key));
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [alsoInChannel, setAlsoInChannel] = useState(false);
  const [suggest, setSuggest] = useState<{ items: Suggestion[]; start: number; index: number; title: string } | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [plusAnchor, setPlusAnchor] = useState<HTMLElement | null>(null);
  const [modal, setModal] = useState<'poll' | 'schedule' | null>(null);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  // Switch drafts when the conversation changes.
  useEffect(() => {
    setText(loadDraft(key));
    setUploads([]);
    setSuggest(null);
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus();
  }, [key]);

  useEffect(() => {
    const id = setTimeout(() => saveDraft(key, text), 300);
    return () => clearTimeout(id);
  }, [key, text]);

  // Autosize.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  // Focus requests (e.g. "reply" buttons, typing anywhere).
  useEffect(() => {
    const onFocus = (e: Event) => {
      const d = (e as CustomEvent).detail as { threadRootId: string | null } | undefined;
      if ((d?.threadRootId ?? null) === threadRootId) ref.current?.focus();
    };
    window.addEventListener('ocpc:focus-composer', onFocus);
    return () => window.removeEventListener('ocpc:focus-composer', onFocus);
  }, [threadRootId]);

  const canPost = useMemo(() => {
    if (threadRootId && channel.isReadonly && !channel.archived) return true;
    return canPostInChannel({ id: me.id, role: me.role }, channel, channel.membership);
  }, [channel, me, threadRootId]);

  // ---------- uploads ----------
  const addFiles = useCallback(
    async (files: File[]) => {
      const maxMb = info?.maxUploadMb ?? 100;
      for (const file of files) {
        if (file.size > maxMb * 1024 * 1024) {
          toast(t('{name} is larger than {n} MB', { name: file.name, n: maxMb }), 'error');
          continue;
        }
        const key = `${Date.now()}-${Math.random()}`;
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        const dims = await imageSize(file);
        const up = uploadFile(file, (p) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))), dims);
        setUploads((u) => [...u, { key, file, progress: 0, abort: up.abort, preview }]);
        up.promise
          .then((info) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, info, progress: 1 } : x))))
          .catch((err: Error) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: err.message } : x))));
      }
    },
    [info?.maxUploadMb],
  );

  const removeUpload = (key: string) => {
    setUploads((u) => {
      const up = u.find((x) => x.key === key);
      up?.abort?.();
      if (up?.preview) URL.revokeObjectURL(up.preview);
      if (up?.info) api.del(`/files/${up.info.id}`).catch(() => {});
      return u.filter((x) => x.key !== key);
    });
  };

  // ---------- autocomplete ----------
  const computeSuggestions = useCallback(
    (value: string, caret: number) => {
      const before = value.slice(0, caret);
      // Slash commands at the very start.
      const slash = /^\/([a-z0-9_-]*)$/i.exec(before);
      if (slash && !threadRootId) {
        const q = slash[1]!.toLowerCase();
        const run = (cmds: Command[]) => {
          const items = cmds
            .filter((c) => c.command.startsWith(q))
            .slice(0, 10)
            .map((c) => ({ id: c.command, label: <span><strong>/{c.command}</strong> <span className="faint">{c.usageHint}</span></span>, insert: `/${c.command} `, hint: c.description }));
          setSuggest(items.length ? { items, start: 0, index: 0, title: t('Commands') } : null);
        };
        if (commandsCache) run(commandsCache);
        else api.get<Command[]>('/commands').then((c) => ((commandsCache = c), run(c))).catch(() => {});
        return;
      }
      const m = /(^|[\s(])([@#:])([^\s@#:]*)$/.exec(before);
      if (!m) return setSuggest(null);
      const trigger = m[2]!;
      const q = m[3]!.toLowerCase();
      const start = caret - q.length - 1;
      let items: Suggestion[] = [];
      let title = '';
      if (trigger === '@') {
        title = t('People');
        const people = Object.values(users)
          .filter((u) => !u.deactivated && (u.username.startsWith(q) || u.displayName.toLowerCase().includes(q) || u.fullName.toLowerCase().includes(q)))
          .sort((a, b) => Number(b.username.startsWith(q)) - Number(a.username.startsWith(q)) || a.username.localeCompare(b.username))
          .slice(0, 8)
          .map((u) => ({
            id: u.id,
            label: (
              <span className="row">
                <Avatar user={u} size={20} presence />
                <strong>{displayName(u)}</strong> <span className="faint">@{u.username}</span>
              </span>
            ),
            insert: `@${u.username} `,
          }));
        const grp = Object.values(groups)
          .filter((g) => g.handle.startsWith(q))
          .slice(0, 4)
          .map((g) => ({ id: g.id, label: <span><strong>@{g.handle}</strong> <span className="faint">{g.name} · {g.memberIds.length}</span></span>, insert: `@${g.handle} ` }));
        const special = channel.kind === 'dm' ? [] : [
          ['here', t('Notify everyone online in this channel')],
          ['channel', t('Notify everyone in this channel')],
        ]
          .filter(([n]) => n!.startsWith(q))
          .map(([n, d]) => ({ id: n!, label: <span><strong>@{n}</strong> <span className="faint">{d}</span></span>, insert: `@${n} ` }));
        items = [...people, ...grp, ...special];
      } else if (trigger === '#') {
        title = t('Channels');
        items = Object.values(channels)
          .filter((c) => (c.kind === 'public' || c.kind === 'private') && c.name.includes(q))
          .slice(0, 8)
          .map((c) => ({ id: c.id, label: <span>#{c.name}</span>, insert: `#${c.name} ` }));
      } else if (trigger === ':' && q.length >= 2) {
        title = t('Emoji');
        const custom = customEmoji
          .filter((e) => e.name.includes(q))
          .slice(0, 4)
          .map((e) => ({ id: `c-${e.name}`, label: <span className="row"><img src={e.url} alt="" width={20} height={20} /> :{e.name}:</span>, insert: `:${e.name}: ` }));
        const std = searchEmoji(q, 8).map(([name, ch]) => ({ id: name, label: <span>{ch} :{name}:</span>, insert: `${ch} ` }));
        items = [...custom, ...std];
      }
      setSuggest(items.length ? { items, start, index: 0, title } : null);
    },
    [users, groups, channels, customEmoji, channel.kind, threadRootId],
  );

  const applySuggestion = (s: Suggestion) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const start = suggest!.start;
    const next = text.slice(0, start) + s.insert + text.slice(caret);
    setText(next);
    setSuggest(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + s.insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // ---------- formatting ----------
  const wrap = (left: string, right = left) => {
    const el = ref.current!;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = text.slice(a, b) || '';
    const next = text.slice(0, a) + left + sel + right + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + left.length, a + left.length + sel.length);
    });
  };
  const insertAtCaret = (s: string) => {
    const el = ref.current;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? text.length;
    setText(text.slice(0, a) + s + text.slice(b));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + s.length, a + s.length);
    });
  };

  // ---------- sending ----------
  const uploading = uploads.some((u) => !u.info && !u.error);
  const readyFiles = uploads.filter((u) => u.info).map((u) => u.info!);
  const canSend = (text.trim().length > 0 || readyFiles.length > 0) && !uploading;

  const doSend = async (body: string, files: FileInfo[]) => {
    const pendingId = `pending-${++pendingSeq}`;
    const pending: Message & { failed?: boolean } = {
      id: pendingId,
      channelId: channel.id,
      userId: me.id,
      threadRootId,
      body,
      kind: 'user',
      asName: null,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
      replyCount: 0,
      lastReplyAt: null,
      replyUserIds: [],
      alsoInChannel: !!threadRootId && alsoInChannel,
      reactions: [],
      files,
      pinned: false,
      saved: false,
      previews: [],
      poll: null,
      forwardedFrom: null,
    };
    addPending(pending);
    const attempt = async () => {
      try {
        await api.post(`/channels/${channel.id}/messages`, {
          body,
          threadRootId,
          alsoInChannel: !!threadRootId && alsoInChannel,
          fileIds: files.map((f) => f.id),
        });
        removeMessage(pendingId);
      } catch (err) {
        useStore.setState((s) => ({ messages: { ...s.messages, [pendingId]: { ...s.messages[pendingId]!, failed: true } as Message } }));
        toastError(err);
        const onRetry = (e: Event) => {
          if ((e as CustomEvent).detail !== pendingId) return;
          window.removeEventListener('ocpc:retry', onRetry);
          useStore.setState((s) => ({ messages: { ...s.messages, [pendingId]: { ...s.messages[pendingId]!, failed: false } as Message } }));
          attempt();
        };
        window.addEventListener('ocpc:retry', onRetry);
      }
    };
    await attempt();
  };

  const submit = async () => {
    if (!canSend) return;
    const body = text.trim();
    // Slash commands.
    if (/^\/[a-z0-9_-]+(\s|$)/i.test(body) && readyFiles.length === 0 && !body.startsWith('//')) {
      try {
        const r = await api.post<{ ephemeral?: string; clientAction?: string; channelId?: string }>('/commands/run', { channelId: channel.id, threadRootId, text: body });
        setText('');
        if (r.ephemeral) toast(r.ephemeral);
        if (r.clientAction === 'call') window.dispatchEvent(new CustomEvent('ocpc:start-call', { detail: channel.id }));
        if (r.clientAction === 'open_channel' && r.channelId) navigate(`/c/${r.channelId}`);
      } catch (err) {
        toastError(err);
      }
      return;
    }
    setText('');
    setUploads([]);
    setSuggest(null);
    saveDraft(key, '');
    await doSend(body.startsWith('//') ? body.slice(1) : body, readyFiles);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggest) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggest({ ...suggest, index: (suggest.index + 1) % suggest.items.length });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggest({ ...suggest, index: (suggest.index - 1 + suggest.items.length) % suggest.items.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggest.items[suggest.index]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSuggest(null);
        return;
      }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'b') return e.preventDefault(), wrap('**');
    if (mod && e.key.toLowerCase() === 'i') return e.preventDefault(), wrap('_');
    if (mod && e.shiftKey && e.key.toLowerCase() === 'x') return e.preventDefault(), wrap('~~');
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const sendNow = enterToSend ? !e.shiftKey && !e.altKey : mod;
      if (sendNow) {
        e.preventDefault();
        submit();
        return;
      }
    }
    if (e.key === 'ArrowUp' && !text) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('ocpc:edit-last', { detail: { channelId: channel.id, threadRootId } }));
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    computeSuggestions(e.target.value, e.target.selectionStart);
    if (Date.now() - lastTyping.current > 3000 && e.target.value) {
      lastTyping.current = Date.now();
      wsSend({ type: 'typing', channelId: channel.id, threadRootId });
    }
  };

  if (channel.archived) {
    return (
      <div className="composer-wrap">
        <div className="composer-disabled">{t('This channel is archived. Unarchive it to post.')}</div>
      </div>
    );
  }
  if (!canPost) {
    return (
      <div className="composer-wrap">
        <div className="composer-disabled">{channel.isReadonly ? t('Only admins can post in this channel. You can reply in threads.') : t('You cannot post here.')}</div>
      </div>
    );
  }

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {suggest && (
          <div className="autocomplete" role="listbox" aria-label={suggest.title}>
            <div className="autocomplete-title">{suggest.title}</div>
            {suggest.items.map((s, i) => (
              <div
                key={s.id}
                role="option"
                aria-selected={i === suggest.index}
                className={`autocomplete-item ${i === suggest.index ? 'selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySuggestion(s);
                }}
                onMouseEnter={() => setSuggest({ ...suggest, index: i })}
              >
                <span className="grow">{s.label}</span>
                {s.hint && <span className="faint small ellipsis" style={{ maxWidth: '50%' }}>{s.hint}</span>}
              </div>
            ))}
          </div>
        )}
        {uploads.length > 0 && (
          <div className="composer-files">
            {uploads.map((u) => (
              <div key={u.key} className="composer-file" title={u.error ?? u.file.name}>
                {u.preview ? <img src={u.preview} alt="" /> : <Paperclip size={14} />}
                <span className="ellipsis">{u.file.name}</span>
                <span className="faint">{u.error ? t('failed') : formatBytes(u.file.size)}</span>
                {!u.info && !u.error && <span className="progress" style={{ width: `${u.progress * 100}%` }} />}
                <button className="icon-btn icon-btn-sm remove" onClick={() => removeUpload(u.key)} aria-label={t('Remove {name}', { name: u.file.name })}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onClick={(e) => computeSuggestions(text, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={40000}
        />
        <div className="composer-toolbar">
          <button className="icon-btn" onClick={(e) => setPlusAnchor(e.currentTarget)} aria-label={t('More')} title={t('More')}>
            <Plus size={17} />
          </button>
          <button className="icon-btn" onClick={() => fileInput.current?.click()} aria-label={t('Attach files')} title={t('Attach files')}>
            <Paperclip size={16} />
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => (addFiles(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
          <span className="fmt" style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
          <button className="icon-btn fmt" onClick={() => wrap('**')} aria-label={t('Bold')} title={t('Bold')}>
            <Bold size={15} />
          </button>
          <button className="icon-btn fmt" onClick={() => wrap('_')} aria-label={t('Italic')} title={t('Italic')}>
            <Italic size={15} />
          </button>
          <button className="icon-btn fmt" onClick={() => wrap('~~')} aria-label={t('Strikethrough')} title={t('Strikethrough')}>
            <Strikethrough size={15} />
          </button>
          <button className="icon-btn fmt" onClick={() => (text.slice(ref.current!.selectionStart, ref.current!.selectionEnd).includes('\n') ? wrap('```\n', '\n```') : wrap('`'))} aria-label={t('Code')} title={t('Code')}>
            <Code size={15} />
          </button>
          <button className="icon-btn fmt" onClick={() => wrap('[', '](https://)')} aria-label={t('Link')} title={t('Link')}>
            <Link2 size={15} />
          </button>
          <button className="icon-btn fmt" onClick={() => insertAtCaret('@')} aria-label={t('Mention someone')} title={t('Mention someone')}>
            <AtSign size={15} />
          </button>
          <button className="icon-btn" onClick={(e) => setEmojiAnchor(e.currentTarget)} aria-label={t('Emoji')} title={t('Emoji')}>
            <Smile size={16} />
          </button>
          <span className="spacer" />
          {threadRootId && (
            <label className="row small muted" style={{ marginRight: 8, gap: 4, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={alsoInChannel} onChange={(e) => setAlsoInChannel(e.target.checked)} />
              {t('Also send to channel')}
            </label>
          )}
          <button className="send-btn" onClick={submit} disabled={!canSend} aria-label={t('Send')} title={t('Send')}>
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
      <div className="composer-hint">
        {enterToSend ? t('Enter to send · Shift+Enter for a new line') : t('Ctrl+Enter to send')}
      </div>
      {emojiAnchor && <EmojiPicker anchor={emojiAnchor} onClose={() => setEmojiAnchor(null)} onPick={(e) => insertAtCaret(e.startsWith(':') ? `${e} ` : e)} />}
      {plusAnchor && (
        <Popover anchor={plusAnchor} onClose={() => setPlusAnchor(null)} placement="top-start">
          <Menu
            onClose={() => setPlusAnchor(null)}
            items={[
              { label: t('Upload a file'), icon: <Paperclip size={15} />, onClick: () => fileInput.current?.click() },
              { label: t('Create a poll'), icon: <BarChart3 size={15} />, onClick: () => setModal('poll'), hidden: !!threadRootId },
              { label: t('Schedule message'), icon: <Clock size={15} />, onClick: () => (text.trim() ? setModal('schedule') : toast(t('Write a message first'))) },
            ]}
          />
        </Popover>
      )}
      {modal === 'poll' && (
        <PollModal
          onClose={() => setModal(null)}
          onCreate={async (poll) => {
            await api.post(`/channels/${channel.id}/messages`, { body: '', poll });
          }}
        />
      )}
      {modal === 'schedule' && (
        <DateTimeModal
          title={t('Schedule message')}
          confirmLabel={t('Schedule')}
          onClose={() => setModal(null)}
          onSubmit={async (iso) => {
            await api.post('/scheduled', { channelId: channel.id, threadRootId, body: text.trim(), sendAt: iso });
            setText('');
            saveDraft(key, '');
            toast(t('Message scheduled'), 'success');
          }}
        />
      )}
    </div>
  );
}
