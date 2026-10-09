// SPDX-License-Identifier: AGPL-3.0-only
// Personal settings: profile, account security, notifications, preferences, sidebar,
// scheduled items and integrations. Rendered at /settings/*.
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  Bell,
  CalendarClock,
  KeyRound,
  LayoutList,
  Menu as MenuIcon,
  Palette,
  Plug,
  User,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';
import {
  AccountSection,
  NotificationsSection,
  PreferencesSection,
  ProfileSection,
} from './UserSections';
import { ScheduledSection, SidebarSectionsSection } from './OrganizeSections';
import { IntegrationsSection } from './IntegrationsSection';
import './settings.css';

export function SettingsPage() {
  const me = useStore((s) => s.me)!;
  const links: [string, string, React.ReactNode][] = [
    ['profile', t('Profile'), <User size={16} key="i" />],
    ['account', t('Account & security'), <KeyRound size={16} key="i" />],
    ['notifications', t('Notifications'), <Bell size={16} key="i" />],
    ['preferences', t('Appearance'), <Palette size={16} key="i" />],
    ['sidebar', t('Sidebar'), <LayoutList size={16} key="i" />],
    ['scheduled', t('Scheduled & reminders'), <CalendarClock size={16} key="i" />],
    ['integrations', t('Integrations'), <Plug size={16} key="i" />],
  ];
  return (
    <main className="main">
      <header className="page-header">
        <button
          className="icon-btn mobile-only"
          onClick={() => window.dispatchEvent(new CustomEvent('ocpc:toggle-nav'))}
          aria-label={t('Open navigation')}
        >
          <MenuIcon size={18} />
        </button>
        <h2>{t('Settings')}</h2>
        <span className="faint small">@{me.username}</span>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('Settings sections')}>
          <h4>{t('Your account')}</h4>
          {links.map(([path, label, icon]) => (
            <NavLink
              key={path}
              to={`/settings/${path}`}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {icon}
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="settings-main">
          <div className="page-content">
            <Routes>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<ProfileSection />} />
              <Route path="account" element={<AccountSection />} />
              <Route path="notifications" element={<NotificationsSection />} />
              <Route path="preferences" element={<PreferencesSection />} />
              <Route path="sidebar" element={<SidebarSectionsSection />} />
              <Route path="scheduled" element={<ScheduledSection />} />
              <Route path="integrations" element={<IntegrationsSection />} />
              <Route path="*" element={<Navigate to="profile" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </main>
  );
}
