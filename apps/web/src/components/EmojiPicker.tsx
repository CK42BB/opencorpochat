// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from 'react';
import { EMOJI, QUICK_REACTIONS } from '@ocpc/shared';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { Popover } from './ui';

const RECENT_KEY = 'ocpc.recentEmoji';
export function recentEmoji(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function pushRecent(e: string) {
  const list = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 24);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

// De-duplicated (name, char) pairs: first name wins.
const ALL = (() => {
  const seen = new Set<string>();
  const out: { name: string; char: string }[] = [];
  for (const [name, char] of Object.entries(EMOJI)) {
    if (seen.has(char)) continue;
    seen.add(char);
    out.push({ name, char });
  }
  return out;
})();

export function EmojiPicker({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const custom = useStore((s) => s.emoji);
  const query = q.trim().toLowerCase().replace(/:/g, '');
  const results = useMemo(() => {
    if (!query) return null;
    return {
      custom: custom.filter((e) => e.name.includes(query)),
      std: Object.entries(EMOJI)
        .filter(([n]) => n.includes(query))
        .map(([name, char]) => ({ name, char }))
        .filter((e, i, arr) => arr.findIndex((x) => x.char === e.char) === i),
    };
  }, [query, custom]);
  const pick = (e: string) => {
    pushRecent(e);
    onPick(e);
    onClose();
  };
  const recent = recentEmoji();
  return (
    <Popover anchor={anchor} onClose={onClose} placement="top-end">
      <div className="emoji-picker">
        <input
          className="input"
          placeholder={t('Search emoji')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          aria-label={t('Search emoji')}
        />
        <div className="emoji-grid" role="listbox">
          {results ? (
            <>
              {results.custom.map((e) => (
                <button key={e.name} title={`:${e.name}:`} onClick={() => pick(`:${e.name}:`)}>
                  <img src={e.url} alt={`:${e.name}:`} />
                </button>
              ))}
              {results.std.map((e) => (
                <button key={e.name} title={`:${e.name}:`} onClick={() => pick(e.char)}>
                  {e.char}
                </button>
              ))}
              {!results.custom.length && !results.std.length && (
                <div className="emoji-cat">{t('No emoji found')}</div>
              )}
            </>
          ) : (
            <>
              <div className="emoji-cat">{t('Frequently used')}</div>
              {[...new Set([...recent, ...QUICK_REACTIONS])].slice(0, 16).map((e) => {
                const c = e.startsWith(':') ? custom.find((x) => `:${x.name}:` === e) : null;
                if (e.startsWith(':') && !c) return null;
                return (
                  <button key={e} onClick={() => pick(e)} title={e}>
                    {c ? <img src={c.url} alt={e} /> : e}
                  </button>
                );
              })}
              {custom.length > 0 && <div className="emoji-cat">{t('Custom')}</div>}
              {custom.map((e) => (
                <button key={e.name} title={`:${e.name}:`} onClick={() => pick(`:${e.name}:`)}>
                  <img src={e.url} alt={`:${e.name}:`} />
                </button>
              ))}
              <div className="emoji-cat">{t('All')}</div>
              {ALL.map((e) => (
                <button key={e.name} title={`:${e.name}:`} onClick={() => pick(e.char)}>
                  {e.char}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </Popover>
  );
}

/** Render a reaction/emoji value: Unicode as text, :custom: as image. */
export function EmojiGlyph({ value }: { value: string }) {
  const custom = useStore((s) => s.emoji);
  if (value.startsWith(':') && value.endsWith(':')) {
    const c = custom.find((e) => `:${e.name}:` === value);
    if (c) return <img className="custom-emoji" src={c.url} alt={value} />;
  }
  return <>{value}</>;
}
