// SPDX-License-Identifier: AGPL-3.0-only
// Shown when the organization requires two-factor authentication and the user hasn't set it up.
import { LogOut } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { Logo } from '../components/ui';
import { TwoFactorSetup } from './TwoFactorSetup';

export function TwoFactorGate() {
  const info = useStore((s) => s.info);
  const signOut = async () => {
    await api.post('/auth/logout').catch(() => {});
    window.location.href = '/login';
  };
  return (
    <div className="auth-page">
      <main className="auth-card">
        <Logo size={48} />
        <h1>{t('Set up two-factor authentication')}</h1>
        <p className="muted">
          {t(
            '{org} requires two-factor authentication for every account. It only takes a minute.',
            { org: info?.orgName ?? '' },
          )}
        </p>
        <TwoFactorSetup onEnabled={() => {}} />
        <div className="footer-links">
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            <LogOut size={14} /> {t('Sign out')}
          </button>
        </div>
      </main>
    </div>
  );
}
