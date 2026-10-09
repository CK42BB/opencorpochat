// SPDX-License-Identifier: AGPL-3.0-only
// Small, dependency-free UI primitives shared by the whole app.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Presence, User } from '@ocpc/shared';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';

// ---------- Avatar ----------
const COLORS = ['#4a3aff', '#d14b8f', '#1f9d61', '#c96b00', '#2e7bd6', '#8b46d1', '#c43c3c', '#0f8a8a'];
function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({ user, size = 36, presence, name }: { user?: User | null; size?: number; presence?: boolean; name?: string }) {
  const p = useStore((s) => (user && presence ? s.presence[user.id] ?? 'offline' : null)) as Presence | null;
  const label = user?.displayName || user?.username || name || '?';
  const initials = label
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {user?.avatarUrl ? (
        <img src={user.avatarUrl} alt="" loading="lazy" />
      ) : (
        <span className="initials" style={{ background: colorFor(user?.id ?? label), fontSize: size * 0.4 }}>
          {user?.isBot ? '🤖' : initials}
        </span>
      )}
      {p && <span className={`presence-dot presence-${p}`} title={t(p)} />}
    </span>
  );
}

export function PresenceDot({ userId }: { userId: string }) {
  const p = useStore((s) => s.presence[userId] ?? 'offline');
  return <span className={`presence-dot presence-${p}`} style={{ position: 'static', width: 9, height: 9, display: 'inline-block', border: 0 }} title={t(p)} />;
}

// ---------- Modal ----------
export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
  labelledBy,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg';
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.modal-close), [tabindex]:not([tabindex="-1"])');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        // Keep focus inside the dialog.
        const els = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, textarea, select, [tabindex]:not([tabindex="-1"])'));
        if (!els.length) return;
        const firstEl = els[0]!;
        const lastEl = els[els.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  const id = labelledBy ?? 'modal-title';
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} ref={ref} tabIndex={-1}>
        {title && (
          <div className="modal-header">
            <h2 id={id}>{title}</h2>
            <button className="icon-btn modal-close" onClick={onClose} aria-label={t('Close')}>
              <X size={18} />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Popover ----------
export function Popover({
  anchor,
  onClose,
  children,
  placement = 'bottom-start',
  className = '',
}: {
  anchor: HTMLElement | DOMRect | null;
  onClose: () => void;
  children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    const me = ref.current.getBoundingClientRect();
    let left = placement.endsWith('end') ? r.right - me.width : placement === 'right-start' ? r.right + 6 : r.left;
    let top = placement.startsWith('top') ? r.top - me.height - 6 : placement === 'right-start' ? r.top : r.bottom + 6;
    if (top + me.height > window.innerHeight - 8) top = Math.max(8, r.top - me.height - 6);
    if (top < 8) top = 8;
    left = Math.max(8, Math.min(left, window.innerWidth - me.width - 8));
    setPos({ left, top });
  }, [anchor, placement]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(anchor instanceof HTMLElement && anchor.contains(e.target as Node))) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className={`popover ${className}`} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export function Menu({ items, onClose, title }: { items: (MenuItem | 'sep')[]; onClose: () => void; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.menu-item')?.focus();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('.menu-item') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    }
  };
  const visible = items.filter((i) => i === 'sep' || !i.hidden);
  return (
    <div className="menu" role="menu" ref={ref} onKeyDown={onKey}>
      {title && <div className="menu-label">{title}</div>}
      {visible.map((item, idx) =>
        item === 'sep' ? (
          idx > 0 && idx < visible.length - 1 && visible[idx - 1] !== 'sep' ? <div key={idx} className="menu-sep" /> : null
        ) : (
          <button
            key={item.label}
            role="menuitem"
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

// ---------- confirm dialog (promise based) ----------
type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };
let confirmImpl: ((o: ConfirmOpts) => Promise<boolean>) | null = null;
export const confirmDialog = (o: ConfirmOpts) => (confirmImpl ? confirmImpl(o) : Promise.resolve(window.confirm(o.title)));

export function ConfirmHost() {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  useEffect(() => {
    confirmImpl = (o) => new Promise((resolve) => setState({ ...o, resolve }));
    return () => {
      confirmImpl = null;
    };
  }, []);
  if (!state) return null;
  const done = (v: boolean) => {
    state.resolve(v);
    setState(null);
  };
  return (
    <Modal
      title={state.title}
      onClose={() => done(false)}
      footer={
        <>
          <button className="btn" onClick={() => done(false)}>
            {t('Cancel')}
          </button>
          <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)} autoFocus>
            {state.confirmLabel ?? t('Confirm')}
          </button>
        </>
      }
    >
      {state.body && <div className="muted">{state.body}</div>}
    </Modal>
  );
}

// ---------- misc ----------
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="status" aria-label={t('Loading')} style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <h3 style={{ margin: '4px 0' }}>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return <img src="/icon.svg" width={size} height={size} alt="" className="logo" />;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Global keyboard shortcut hook. `combo` like "mod+k", "alt+shift+arrowdown", "escape". */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, deps: unknown[] = []) {
  useEffect(() => {
    const parts = combo.toLowerCase().split('+');
    const key = parts.pop()!;
    const want = { mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt') };
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod !== want.mod || e.shiftKey !== want.shift || e.altKey !== want.alt) return;
      if (e.key.toLowerCase() !== key) return;
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
