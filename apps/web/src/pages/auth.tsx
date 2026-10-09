// SPDX-License-Identifier: AGPL-3.0-only
// Sign in, first-run setup, invite acceptance and password reset.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { USERNAME_RE } from '@ocpc/shared';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { Logo, Spinner } from '../components/ui';

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const info = useStore((s) => s.info);
  return (
    <div className="auth-page">
      <main className="auth-card">
        {info?.iconUrl ? <img className="logo" src={info.iconUrl} alt="" style={{ borderRadius: 10 }} /> : <Logo size={48} />}
        <h1>{title}</h1>
        {subtitle && <p className="muted" style={{ marginTop: 0 }}>{subtitle}</p>}
        {children}
        <div className="footer-links">
          {t('Powered by')}{' '}
          <a href={info?.sourceUrl} target="_blank" rel="noopener noreferrer">
            OpenCorpoChat
          </a>{' '}
          · {t('free software (AGPL-3.0)')}
        </div>
      </main>
    </div>
  );
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p className="error-text" role="alert">
      {error}
    </p>
  ) : null;
}

const suggestUsername = (s: string) =>
  s
    .toLowerCase()
    .replace(/@.*/, '')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 32);

export function LoginPage({ onDone }: { onDone: () => void }) {
  const info = useStore((s) => s.info);
  const [params] = useSearchParams();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { login, password, ...(needTotp ? { totp } : {}) });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') setNeedTotp(true);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const sso = info?.oidc.enabled;
  return (
    <AuthCard title={t('Sign in to {org}', { org: info?.orgName ?? '' })}>
      {sso && (
        <>
          <a className="btn btn-primary btn-block" href={`/api/v1/auth/oidc/start?returnTo=${encodeURIComponent(params.get('next') ?? '/')}`}>
            {info!.oidc.label || t('Sign in with SSO')}
          </a>
          {!info!.ssoOnly && <div className="divider">{t('or')}</div>}
        </>
      )}
      {(!sso || !info!.ssoOnly) && (
        <form onSubmit={submit}>
          {!needTotp ? (
            <>
              <div className="field">
                <label htmlFor="login">{t('Email or username')}</label>
                <input id="login" className="input" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus required />
              </div>
              <div className="field">
                <label htmlFor="password">{t('Password')}</label>
                <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="totp">{t('Two-factor code')}</label>
              <input id="totp" className="input" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus required placeholder="123456" />
              <span className="hint">{t('Enter the 6-digit code from your authenticator app, or a recovery code.')}</span>
            </div>
          )}
          <ErrorText error={error} />
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <Spinner size={16} /> : needTotp ? t('Verify') : t('Sign in')}
          </button>
        </form>
      )}
      <p className="faint small" style={{ textAlign: 'center' }}>
        {t('Forgot your password? Ask an administrator for a reset link.')}
      </p>
    </AuthCard>
  );
}

export function SetupPage({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ orgName: '', displayName: '', email: '', username: '', password: '', confirm: '' });
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v, ...(k === 'email' && !usernameTouched ? { username: suggestUsername(v) } : {}) }));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError(t('Passwords do not match'));
    setBusy(true);
    setError(null);
    try {
      await api.post('/setup', { orgName: form.orgName, displayName: form.displayName, email: form.email, username: form.username, password: form.password });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title={t('Welcome to OpenCorpoChat')} subtitle={t("Let's set up your organization. You'll be its owner.")}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="org">{t('Organization name')}</label>
          <input id="org" className="input" value={form.orgName} onChange={set('orgName')} required autoFocus placeholder={t('e.g. Acme Inc.')} />
        </div>
        <div className="field">
          <label htmlFor="dn">{t('Your name')}</label>
          <input id="dn" className="input" value={form.displayName} onChange={set('displayName')} required autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="em">{t('Email')}</label>
          <input id="em" className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="un">{t('Username')}</label>
          <input id="un" className="input" value={form.username} onChange={(e) => (setUsernameTouched(true), set('username')(e))} required pattern={USERNAME_RE.source} autoComplete="username" />
          <span className="hint">{t('Lowercase letters, numbers, dots, dashes and underscores.')}</span>
        </div>
        <div className="field">
          <label htmlFor="pw">{t('Password')}</label>
          <input id="pw" className="input" type="password" value={form.password} onChange={set('password')} required minLength={10} autoComplete="new-password" />
          <span className="hint">{t('At least 10 characters. A passphrase is great.')}</span>
        </div>
        <div className="field">
          <label htmlFor="pw2">{t('Confirm password')}</label>
          <input id="pw2" className="input" type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
        </div>
        <ErrorText error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner size={16} /> : t('Create organization')}
        </button>
      </form>
    </AuthCard>
  );
}

export function JoinPage({ onDone }: { onDone: () => void }) {
  const { code } = useParams<{ code: string }>();
  const [invite, setInvite] = useState<{ orgName: string; role: string; email: string | null } | null | 'invalid'>(null);
  const [form, setForm] = useState({ displayName: '', email: '', username: '', password: '' });
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = useStore((s) => s.info);
  useEffect(() => {
    api
      .get<{ orgName: string; role: string; email: string | null }>(`/auth/invite/${code}`, { quiet401: true })
      .then((i) => {
        setInvite(i);
        if (i.email) setForm((f) => ({ ...f, email: i.email!, username: suggestUsername(i.email!) }));
      })
      .catch(() => setInvite('invalid'));
  }, [code]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v, ...(k === 'email' && !usernameTouched ? { username: suggestUsername(v) } : {}) }));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/register', { inviteCode: code, ...form });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (invite === null) return <AuthCard title={t('Checking invite…')}><Spinner /></AuthCard>;
  if (invite === 'invalid')
    return (
      <AuthCard title={t('Invite not valid')} subtitle={t('This invite link is invalid, has been used, or has expired. Ask whoever invited you for a new one.')}>
        <Link to="/login">{t('Go to sign in')}</Link>
      </AuthCard>
    );
  return (
    <AuthCard title={t('Join {org}', { org: invite.orgName })} subtitle={invite.role === 'guest' ? t("You've been invited as a guest.") : t("You've been invited to join the team.")}>
      {info?.oidc.enabled && (
        <>
          <a className="btn btn-primary btn-block" href="/api/v1/auth/oidc/start">
            {info.oidc.label || t('Sign in with SSO')}
          </a>
          <div className="divider">{t('or create an account')}</div>
        </>
      )}
      {!info?.ssoOnly && (
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="dn">{t('Your name')}</label>
            <input id="dn" className="input" value={form.displayName} onChange={set('displayName')} required autoFocus autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="em">{t('Email')}</label>
            <input id="em" className="input" type="email" value={form.email} onChange={set('email')} required readOnly={!!invite.email} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="un">{t('Username')}</label>
            <input id="un" className="input" value={form.username} onChange={(e) => (setUsernameTouched(true), set('username')(e))} required pattern={USERNAME_RE.source} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="pw">{t('Password')}</label>
            <input id="pw" className="input" type="password" value={form.password} onChange={set('password')} required minLength={10} autoComplete="new-password" />
            <span className="hint">{t('At least 10 characters.')}</span>
          </div>
          <ErrorText error={error} />
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <Spinner size={16} /> : t('Join')}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/auth/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <AuthCard title={t('Choose a new password')}>
      {done ? (
        <>
          <p>{t('Your password has been changed. You can sign in now.')}</p>
          <button className="btn btn-primary btn-block" onClick={() => navigate('/login')}>
            {t('Sign in')}
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="np">{t('New password')}</label>
            <input id="np" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoFocus autoComplete="new-password" />
          </div>
          <ErrorText error={error} />
          <button className="btn btn-primary btn-block">{t('Set password')}</button>
        </form>
      )}
    </AuthCard>
  );
}
