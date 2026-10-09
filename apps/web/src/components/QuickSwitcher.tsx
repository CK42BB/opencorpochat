// SPDX-License-Identifier: AGPL-3.0-only
// Ctrl/Cmd+K: jump to any channel, DM or person; Enter on free text searches messages.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Lock, Search, Users } from 'lucide-react';
import { channelTitle, displayName, isDm, toastError, useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { Avatar, Modal } from './ui';
import { openDm } from './UserCard';

interface Item {
  key: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  run: () => void;
  score: number;
}

export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();

  const items = useMemo(() => {
    const query = q.trim().toLowerCase().replace(/^[#@]/, '');
    const score = (text: string) => {
      const s = text.toLowerCase();
      if (!query) return 1;
      if (s.startsWith(query)) return 3;
      if (s.split(/[\s._-]/).some((w) => w.startsWith(query))) return 2;
      if (s.includes(query)) return 1;
      return 0;
    };
    const out: Item[] = [];
    const dmUserIds = new Set<string>();
    for (const c of Object.values(channels)) {
      const title = channelTitle(c, me.id, users);
      const sc = score(title);
      if (!sc) continue;
      if (c.kind === 'dm') (c.dmUserIds ?? []).forEach((id) => dmUserIds.add(id));
      const other =
        c.kind === 'dm' ? users[(c.dmUserIds ?? []).find((id) => id !== me.id) ?? ''] : undefined;
      out.push({
        key: c.id,
        label: title,
        sub: c.archived ? t('archived') : undefined,
        icon: isDm(c) ? (
          other ? (
            <Avatar user={other} size={20} presence />
          ) : (
            <Users size={16} />
          )
        ) : c.kind === 'private' ? (
          <Lock size={16} />
        ) : (
          <Hash size={16} />
        ),
        run: () => navigate(`/c/${c.id}`),
        // Unread and recent conversations float up.
        score:
          sc * 10 +
          (c.unreadCount ? 3 : 0) +
          (c.lastMessageAt ? Date.parse(c.lastMessageAt) / 1e13 : 0),
      });
    }
    if (query) {
      for (const u of Object.values(users)) {
        if (u.id === me.id || u.deactivated || dmUserIds.has(u.id)) continue;
        const sc = Math.max(score(u.username), score(u.displayName), score(u.fullName));
        if (!sc) continue;
        out.push({
          key: `u-${u.id}`,
          label: displayName(u),
          sub: `@${u.username}`,
          icon: <Avatar user={u} size={20} presence />,
          run: () =>
            openDm([u.id])
              .then((ch) => navigate(`/c/${ch.id}`))
              .catch(toastError),
          score: sc * 10 - 1,
        });
      }
    }
    out.sort((a, b) => b.score - a.score);
    const top = out.slice(0, 12);
    if (q.trim()) {
      top.push({
        key: 'search',
        label: t('Search messages for “{q}”', { q: q.trim() }),
        icon: <Search size={16} />,
        run: () => navigate(`/search?q=${encodeURIComponent(q.trim())}`),
        score: 0,
      });
    }
    return top;
  }, [q, channels, users, me.id, navigate]);

  const choose = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    it.run();
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ margin: '-8px -20px' }}>
        <input
          className="switcher-input"
          autoFocus
          placeholder={t('Jump to a channel, person or search…')}
          value={q}
          aria-label={t('Jump to')}
          role="combobox"
          aria-expanded="true"
          aria-controls="switcher-results"
          aria-activedescendant={items[index] ? `sw-${items[index]!.key}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(items[index]);
            }
          }}
        />
        <div className="switcher-results" id="switcher-results" role="listbox">
          {items.map((it, i) => (
            <div
              key={it.key}
              id={`sw-${it.key}`}
              role="option"
              aria-selected={i === index}
              className={`autocomplete-item ${i === index ? 'selected' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(it)}
            >
              {it.icon}
              <span className="grow ellipsis">{it.label}</span>
              {it.sub && <span className="faint small">{it.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
