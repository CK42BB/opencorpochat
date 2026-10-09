// SPDX-License-Identifier: AGPL-3.0-only
// Administration console: /admin/*
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { BarChart3, Download, Hash, ListChecks, Mail, Menu as MenuIcon, Settings, Shield, Smile, Users as UsersIcon, UsersRound } from 'lucide-react';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { EmptyState } from '../components/ui';
import { Overview } from './Overview';
import { Users } from './Users';
import { Invites } from './Invites';
import { Channels } from './Channels';
import { OrgSettings } from './OrgSettings';
import { Groups } from './Groups';
import { Emoji } from './Emoji';
import { Audit } from './Audit';
import { Export } from './Export';
import './admin.css';

const SECTIONS = [
  { path: 'overview', label: 'Overview', icon: BarChart3, el: <Overview /> },
  { path: 'users', label: 'People', icon: UsersIcon, el: <Users /> },
  { path: 'invites', label: 'Invites', icon: Mail, el: <Invites /> },
  { path: 'channels', label: 'Channels', icon: Hash, el: <Channels /> },
  { path: 'settings', label: 'Settings', icon: Settings, el: <OrgSettings /> },
  { path: 'groups', label: 'User groups', icon: UsersRound, el: <Groups /> },
  { path: 'emoji', label: 'Custom emoji', icon: Smile, el: <Emoji /> },
  { path: 'audit', label: 'Audit log', icon: ListChecks, el: <Audit /> },
  { path: 'export', label: 'Export & backups', icon: Download, el: <Export /> },
] as const;

export function AdminPage() {
  const me = useStore((s) => s.me);
  const isAdmin = me?.role === 'admin' || me?.role === 'owner';
  return (
    <main className="main" aria-label={t('Administration')}>
      <header className="page-header">
        <button className="icon-btn mobile-only" onClick={() => window.dispatchEvent(new CustomEvent('ocpc:toggle-nav'))} aria-label={t('Open navigation')}>
          <MenuIcon size={18} />
        </button>
        <Shield size={18} />
        <h2>{t('Administration')}</h2>
      </header>
      {!isAdmin ? (
        <EmptyState icon={<Shield size={40} />} title={t('Admins only')}>
          {t('Ask an owner or admin of your organization if you need access.')}
        </EmptyState>
      ) : (
        <div className="settings-layout" style={{ minHeight: 0 }}>
          <nav className="settings-nav" aria-label={t('Administration sections')}>
            <h4>{t('Organization')}</h4>
            {SECTIONS.map(({ path, label, icon: Icon }) => (
              <NavLink key={path} to={`/admin/${path}`} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon size={16} /> {t(label)}
              </NavLink>
            ))}
          </nav>
          <div className="page">
            <div className="page-content">
              <Routes>
                <Route index element={<Navigate to="overview" replace />} />
                {SECTIONS.map(({ path, el }) => (
                  <Route key={path} path={path} element={el} />
                ))}
                <Route path="*" element={<Navigate to="overview" replace />} />
              </Routes>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
