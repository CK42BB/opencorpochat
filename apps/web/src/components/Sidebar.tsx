// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  AtSign,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Compass,
  Hash,
  Headphones,
  Lock,
  LogOut,
  MessageSquareText,
  Moon,
  Plus,
  Search,
  Settings,
  Shield,
  SquarePen,
  Users,
  UserPlus,
  BellOff,
  Bell,
  Smile,
  Keyboard,
  Info,
} from 'lucide-react';
import type { MyChannel } from '@ocpc/shared';
import { api } from '../lib/api';
import { channelTitle, displayName, isDm, toastError, useStore } from '../lib/store';
import { disconnect } from '../lib/realtime';
import { t } from '../lib/i18n';
import { Avatar, Logo, Menu, Modal, Popover } from './ui';
import { CreateChannelModal, InviteModal, NewDmModal, ShortcutsModal, StatusModal } from './modals';

type ModalKind = 'channel' | 'dm' | 'invite' | 'status' | 'shortcuts' | 'about' | null;

export function useSidebarOrder() {
  const channels = useStore((s) => s.channels);
  const me = useStore((s) => s.me);
  const users = useStore((s) => s.users);
  return useMemo(() => {
    const all = Object.values(channels).filter((c) => !c.archived || c.unreadCount > 0);
    const custom = me?.preferences.sidebarSections ?? [];
    const inCustom = new Set(custom.flatMap((s) => s.channelIds));
    const titled = all.map((c) => ({ c, title: channelTitle(c, me?.id, users) }));
    const starred = titled
      .filter((x) => x.c.membership.starred)
      .sort((a, b) => a.title.localeCompare(b.title));
    const chans = titled
      .filter((x) => !isDm(x.c) && !x.c.membership.starred && !inCustom.has(x.c.id))
      .sort((a, b) => a.title.localeCompare(b.title));
    const dms = titled
      .filter((x) => isDm(x.c) && !x.c.membership.starred && !inCustom.has(x.c.id))
      .sort((a, b) =>
        (b.c.lastMessageAt ?? b.c.createdAt).localeCompare(a.c.lastMessageAt ?? a.c.createdAt),
      )
      .slice(0, 40);
    const sections = custom.map((s) => ({
      ...s,
      items: titled.filter((x) => s.channelIds.includes(x.c.id) && !x.c.membership.starred),
    }));
    return {
      starred,
      chans,
      dms,
      sections,
      flat: [...starred, ...sections.flatMap((s) => s.items), ...chans, ...dms].map((x) => x.c),
    };
  }, [channels, me, users]);
}

function ChannelItem({ c, title }: { c: MyChannel; title: string }) {
  const me = useStore((s) => s.me);
  const users = useStore((s) => s.users);
  const call = useStore((s) => s.calls[c.id]);
  const other =
    isDm(c) && c.dmUserIds?.length === 2
      ? users[c.dmUserIds.find((id) => id !== me?.id) ?? '']
      : undefined;
  const unread = c.unreadCount > 0 && !c.membership.muted;
  return (
    <NavLink
      to={`/c/${c.id}`}
      className={({ isActive }) =>
        `sidebar-item ${isActive ? 'active' : ''} ${unread ? 'unread' : ''} ${c.membership.muted ? 'muted-ch' : ''}`
      }
      onClick={() => window.dispatchEvent(new CustomEvent('ocpc:close-nav'))}
    >
      <span className="ch-icon">
        {isDm(c) ? (
          other ? (
            <Avatar user={other} size={20} presence />
          ) : (
            <Users size={16} />
          )
        ) : c.kind === 'private' ? (
          <Lock size={15} />
        ) : (
          <Hash size={15} />
        )}
      </span>
      <span className="name">
        {title}
        {other?.statusEmoji && <span style={{ marginLeft: 4 }}>{other.statusEmoji}</span>}
      </span>
      {call && <Headphones size={14} aria-label={t('Call in progress')} />}
      {c.mentionCount > 0 && <span className="badge">{c.mentionCount}</span>}
    </NavLink>
  );
}

function Section({
  id,
  title,
  items,
  onAdd,
  addLabel,
}: {
  id: string;
  title: string;
  items: { c: MyChannel; title: string }[];
  onAdd?: () => void;
  addLabel?: string;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(`ocpc.collapsed.${id}`) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(`ocpc.collapsed.${id}`, collapsed ? '0' : '1');
    } catch {
      /* ignore */
    }
  };
  const shown = collapsed
    ? items.filter((x) => x.c.unreadCount > 0 || location.pathname === `/c/${x.c.id}`)
    : items;
  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header">
        <button className="toggle" onClick={toggle} aria-expanded={!collapsed}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />} {title}
        </button>
        {onAdd && (
          <button
            className="icon-btn icon-btn-sm"
            onClick={onAdd}
            aria-label={addLabel}
            title={addLabel}
          >
            <Plus size={15} />
          </button>
        )}
      </div>
      {shown.map((x) => (
        <ChannelItem key={x.c.id} c={x.c} title={x.title} />
      ))}
    </div>
  );
}

export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const me = useStore((s) => s.me)!;
  const info = useStore((s) => s.info);
  const settings = useStore((s) => s.settings);
  const unreadThreads = useStore((s) => s.unreadThreads);
  const unreadNotifications = useStore((s) => s.unreadNotifications);
  const { starred, chans, dms, sections } = useSidebarOrder();
  const [modal, setModal] = useState<ModalKind>(null);
  const [orgMenu, setOrgMenu] = useState<HTMLElement | null>(null);
  const [meMenu, setMeMenu] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const isAdmin = me.role === 'admin' || me.role === 'owner';
  const dnd = !!me.dndUntil;

  const setDnd = async (minutes: number | null) => {
    try {
      const updated = await api.put('/me/dnd', {
        until: minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null,
      });
      useStore.setState({ me: updated as never });
    } catch (err) {
      toastError(err);
    }
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    disconnect();
    window.location.href = '/login';
  };

  return (
    <nav className="sidebar" aria-label={t('Sidebar')}>
      <div className="sidebar-header">
        <button
          className="org-button"
          onClick={(e) => setOrgMenu(e.currentTarget)}
          aria-haspopup="menu"
        >
          {settings?.iconUrl ? (
            <img className="org-icon" src={settings.iconUrl} alt="" />
          ) : (
            <img className="org-icon" src="/icon.svg" alt="" />
          )}
          <span className="ellipsis">{settings?.name ?? info?.orgName}</span>
          <ChevronDown size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setModal('dm')}
          aria-label={t('New message')}
          title={t('New message')}
        >
          <SquarePen size={17} />
        </button>
      </div>
      <button className="sidebar-search" onClick={onSearch}>
        <Search size={15} /> <span className="grow">{t('Search or jump to…')}</span>{' '}
        <span
          className="kbd"
          style={{
            background: 'transparent',
            color: 'inherit',
            borderColor: 'rgba(255,255,255,0.2)',
          }}
        >
          ⌘K
        </span>
      </button>
      <div className="sidebar-scroll">
        <NavLink
          to="/threads"
          className={({ isActive }) =>
            `sidebar-item ${isActive ? 'active' : ''} ${unreadThreads ? 'unread' : ''}`
          }
        >
          <span className="ch-icon">
            <MessageSquareText size={16} />
          </span>
          <span className="name">{t('Threads')}</span>
          {unreadThreads > 0 && (
            <span
              className="badge"
              style={{ background: 'var(--sidebar-text)', color: 'var(--sidebar-bg)' }}
            >
              {unreadThreads}
            </span>
          )}
        </NavLink>
        <NavLink
          to="/activity"
          className={({ isActive }) =>
            `sidebar-item ${isActive ? 'active' : ''} ${unreadNotifications ? 'unread' : ''}`
          }
        >
          <span className="ch-icon">
            <AtSign size={16} />
          </span>
          <span className="name">{t('Activity')}</span>
          {unreadNotifications > 0 && <span className="badge">{unreadNotifications}</span>}
        </NavLink>
        <NavLink
          to="/saved"
          className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
        >
          <span className="ch-icon">
            <Bookmark size={16} />
          </span>
          <span className="name">{t('Saved')}</span>
        </NavLink>
        {me.role !== 'guest' && (
          <NavLink
            to="/browse"
            className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
          >
            <span className="ch-icon">
              <Compass size={16} />
            </span>
            <span className="name">{t('Browse channels')}</span>
          </NavLink>
        )}
        <NavLink
          to="/people"
          className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
        >
          <span className="ch-icon">
            <Users size={16} />
          </span>
          <span className="name">{t('People')}</span>
        </NavLink>

        {starred.length > 0 && <Section id="starred" title={t('Starred')} items={starred} />}
        {sections.map((s) => (
          <Section key={s.id} id={`custom-${s.id}`} title={s.name} items={s.items} />
        ))}
        <Section
          id="channels"
          title={t('Channels')}
          items={chans}
          onAdd={me.role === 'guest' ? undefined : () => setModal('channel')}
          addLabel={t('Create a channel')}
        />
        <Section
          id="dms"
          title={t('Direct messages')}
          items={dms}
          onAdd={() => setModal('dm')}
          addLabel={t('New message')}
        />
        {me.role !== 'guest' && (
          <button
            className="sidebar-item"
            style={{ marginTop: 10 }}
            onClick={() => setModal('invite')}
          >
            <span className="ch-icon">
              <UserPlus size={16} />
            </span>
            <span className="name">{t('Invite people')}</span>
          </button>
        )}
      </div>
      <div className="sidebar-footer">
        <button
          className="me-button"
          onClick={(e) => setMeMenu(e.currentTarget)}
          aria-haspopup="menu"
        >
          <Avatar user={me} size={28} presence />
          <span className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 700, fontSize: 14 }}>
              {displayName(me)}
            </div>
            <div className="ellipsis" style={{ fontSize: 12, color: 'var(--sidebar-text)' }}>
              {me.statusEmoji}{' '}
              {me.statusText || (dnd ? t('Notifications paused') : t('Set a status'))}
            </div>
          </span>
        </button>
        {dnd && <BellOff size={16} aria-label={t('Notifications paused')} />}
      </div>

      {orgMenu && (
        <Popover anchor={orgMenu} onClose={() => setOrgMenu(null)}>
          <Menu
            title={settings?.name}
            onClose={() => setOrgMenu(null)}
            items={[
              {
                label: t('Invite people'),
                icon: <UserPlus size={15} />,
                onClick: () => setModal('invite'),
                hidden: me.role === 'guest',
              },
              {
                label: t('Create a channel'),
                icon: <Plus size={15} />,
                onClick: () => setModal('channel'),
                hidden: me.role === 'guest',
              },
              {
                label: t('Browse channels'),
                icon: <Compass size={15} />,
                onClick: () => navigate('/browse'),
                hidden: me.role === 'guest',
              },
              'sep',
              {
                label: t('Administration'),
                icon: <Shield size={15} />,
                onClick: () => navigate('/admin'),
                hidden: !isAdmin,
              },
              {
                label: t('Integrations'),
                icon: <Settings size={15} />,
                onClick: () => navigate('/settings/integrations'),
                hidden: me.role === 'guest',
              },
              {
                label: t('Keyboard shortcuts'),
                icon: <Keyboard size={15} />,
                onClick: () => setModal('shortcuts'),
              },
              {
                label: t('About OpenCorpoChat'),
                icon: <Info size={15} />,
                onClick: () => setModal('about'),
              },
            ]}
          />
        </Popover>
      )}
      {meMenu && (
        <Popover anchor={meMenu} onClose={() => setMeMenu(null)} placement="top-start">
          <Menu
            title={`@${me.username}`}
            onClose={() => setMeMenu(null)}
            items={[
              {
                label: t('Set a status'),
                icon: <Smile size={15} />,
                onClick: () => setModal('status'),
              },
              {
                label: dnd ? t('Resume notifications') : t('Pause notifications for 1 hour'),
                icon: dnd ? <Bell size={15} /> : <BellOff size={15} />,
                onClick: () => setDnd(dnd ? null : 60),
              },
              {
                label: t('Pause until tomorrow'),
                icon: <Moon size={15} />,
                onClick: () =>
                  setDnd(
                    Math.round(
                      (new Date(new Date().setHours(24 + 9, 0, 0, 0)).getTime() - Date.now()) /
                        60_000,
                    ),
                  ),
                hidden: dnd,
              },
              'sep',
              {
                label: t('Profile & preferences'),
                icon: <Settings size={15} />,
                onClick: () => navigate('/settings'),
              },
              'sep',
              { label: t('Sign out'), icon: <LogOut size={15} />, onClick: logout },
            ]}
          />
        </Popover>
      )}
      {modal === 'channel' && <CreateChannelModal onClose={() => setModal(null)} />}
      {modal === 'dm' && <NewDmModal onClose={() => setModal(null)} />}
      {modal === 'invite' && <InviteModal onClose={() => setModal(null)} />}
      {modal === 'status' && <StatusModal onClose={() => setModal(null)} />}
      {modal === 'shortcuts' && <ShortcutsModal onClose={() => setModal(null)} />}
      {modal === 'about' && <AboutModal onClose={() => setModal(null)} />}
    </nav>
  );
}

function AboutModal({ onClose }: { onClose: () => void }) {
  const info = useStore((s) => s.info);
  return (
    <Modal title={t('About')} onClose={onClose}>
      <div className="row" style={{ marginBottom: 12 }}>
        <Logo size={40} />
        <div>
          <strong>OpenCorpoChat</strong> {info?.version}
          <div className="muted small">{t('Open-source team chat you can run yourself.')}</div>
        </div>
      </div>
      <p className="small">
        {t(
          'This software is free and open source under the GNU Affero General Public License v3.0. You have the right to obtain the source code of the version running on this server:',
        )}
      </p>
      <p>
        <a href={info?.sourceUrl} target="_blank" rel="noopener noreferrer">
          {info?.sourceUrl}
        </a>
      </p>
      <p className="small muted">
        <a href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">
          {t('API reference (OpenAPI)')}
        </a>
      </p>
    </Modal>
  );
}
