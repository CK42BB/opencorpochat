// SPDX-License-Identifier: AGPL-3.0-only
// Profile, account (password, 2FA, sessions), notifications and display preferences.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BellOff, Monitor, Trash2, Upload, X } from 'lucide-react';
import type { Me, Session } from '@ocpc/shared';
import { api, imageSize, uploadFile } from '../lib/api';
import { toast, toastError, useStore } from '../lib/store';
import { enableNotifications, notificationPermission } from '../lib/notify';
import { formatDateTime, formatRelative } from '../lib/format';
import { t } from '../lib/i18n';
import { Avatar, confirmDialog, Spinner } from '../components/ui';
import { TwoFactorSetup } from './TwoFactorSetup';
import { describeUserAgent, savePrefs } from './common';

function timezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return ['UTC'];
  }
}

export function ProfileSection() {
  const me = useStore((s) => s.me)!;
  const [form, setForm] = useState({
    displayName: me.displayName,
    fullName: me.fullName,
    title: me.title,
    pronouns: me.pronouns,
    phone: '',
    timezone: me.timezone,
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const zones = useMemo(timezones, []);
  useEffect(() => {
    api
      .get<{ phone?: string }>(`/users/${me.id}`)
      .then((u) => setForm((f) => ({ ...f, phone: u.phone ?? '' })))
      .catch(() => {});
  }, [me.id]);
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  const patch = async (body: Record<string, unknown>) => {
    const updated = await api.patch<Me>('/me', body);
    useStore.setState({ me: updated });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await patch(form);
      toast(t('Profile saved'), 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const onAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast(t('Choose an image file'), 'error');
    setUploading(true);
    try {
      const info = await uploadFile(file, undefined, await imageSize(file)).promise;
      await patch({ avatarFileId: info.id });
      toast(t('Photo updated'), 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setUploading(false);
    }
  };
  return (
    <>
      <div className="card">
        <h3>{t('Profile photo')}</h3>
        <div className="row">
          <Avatar user={me} size={72} />
          <div className="col">
            <div className="row">
              <button
                className="btn btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Spinner size={14} /> : <Upload size={14} />} {t('Upload photo')}
              </button>
              {me.avatarUrl && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => patch({ avatarFileId: null }).catch(toastError)}
                >
                  <Trash2 size={14} /> {t('Remove')}
                </button>
              )}
            </div>
            <span className="faint small">
              {t('A square image of at least 256×256 works best.')}
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => (onAvatar(e.target.files?.[0]), (e.target.value = ''))}
          />
        </div>
      </div>
      <form className="card" onSubmit={save}>
        <h3>{t('About you')}</h3>
        <div className="field">
          <label htmlFor="p-dn">{t('Display name')}</label>
          <input
            id="p-dn"
            className="input"
            value={form.displayName}
            onChange={set('displayName')}
            required
            maxLength={80}
          />
          <span className="hint">
            {t('How your name appears in messages. Your username is @{username}.', {
              username: me.username,
            })}
          </span>
        </div>
        <div className="field">
          <label htmlFor="p-fn">{t('Full name')}</label>
          <input
            id="p-fn"
            className="input"
            value={form.fullName}
            onChange={set('fullName')}
            maxLength={120}
          />
        </div>
        <div className="field">
          <label htmlFor="p-title">{t('Title')}</label>
          <input
            id="p-title"
            className="input"
            value={form.title}
            onChange={set('title')}
            maxLength={120}
            placeholder={t('e.g. Head of Operations')}
          />
        </div>
        <div className="field">
          <label htmlFor="p-pron">{t('Pronouns')}</label>
          <input
            id="p-pron"
            className="input"
            value={form.pronouns}
            onChange={set('pronouns')}
            maxLength={40}
          />
        </div>
        <div className="field">
          <label htmlFor="p-phone">{t('Phone')}</label>
          <input
            id="p-phone"
            className="input"
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            maxLength={40}
          />
        </div>
        <div className="field">
          <label htmlFor="p-tz">{t('Time zone')}</label>
          <div className="row">
            <select id="p-tz" className="select" value={form.timezone} onChange={set('timezone')}>
              {!zones.includes(form.timezone) && (
                <option value={form.timezone}>{form.timezone}</option>
              )}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }))
              }
            >
              {t('Detect')}
            </button>
          </div>
        </div>
        <button className="btn btn-primary" disabled={busy}>
          {t('Save changes')}
        </button>
      </form>
    </>
  );
}

function PasswordCard() {
  const me = useStore((s) => s.me)!;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return toast(t('Passwords do not match'), 'error');
    setBusy(true);
    try {
      await api.post('/auth/password', {
        ...(me.hasPassword ? { currentPassword: current } : {}),
        newPassword: next,
      });
      useStore.setState({ me: { ...me, hasPassword: true } });
      setCurrent('');
      setNext('');
      setConfirm('');
      toast(t('Password changed. Other sessions were signed out.'), 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h3>{me.hasPassword ? t('Change password') : t('Set a password')}</h3>
      {me.hasPassword && (
        <div className="field">
          <label htmlFor="a-cur">{t('Current password')}</label>
          <input
            id="a-cur"
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
      )}
      <div className="field">
        <label htmlFor="a-new">{t('New password')}</label>
        <input
          id="a-new"
          className="input"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          minLength={10}
          required
        />
        <span className="hint">{t('At least 10 characters.')}</span>
      </div>
      <div className="field">
        <label htmlFor="a-conf">{t('Confirm new password')}</label>
        <input
          id="a-conf"
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      <button className="btn btn-primary" disabled={busy}>
        {t('Update password')}
      </button>
    </form>
  );
}

function TwoFactorCard() {
  const me = useStore((s) => s.me)!;
  const settings = useStore((s) => s.settings);
  const [code, setCode] = useState('');
  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/auth/totp/disable', { code: code.trim() });
      useStore.setState({ me: { ...me, totpEnabled: false } });
      setCode('');
      toast(t('Two-factor authentication turned off'));
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <div className="card">
      <h3>
        {t('Two-factor authentication')}{' '}
        {me.totpEnabled && <span className="pill pill-brand">{t('On')}</span>}
      </h3>
      {me.totpEnabled ? (
        settings?.require2fa ? (
          <p className="muted small">
            {t('Your organization requires two-factor authentication, so it cannot be turned off.')}
          </p>
        ) : (
          <form onSubmit={disable}>
            <p className="muted small">
              {t('To turn off two-factor authentication, enter a current code from your app.')}
            </p>
            <div className="row">
              <input
                className="input"
                style={{ maxWidth: 200 }}
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                aria-label={t('Two-factor code')}
                required
              />
              <button className="btn btn-danger">{t('Turn off')}</button>
            </div>
          </form>
        )
      ) : (
        <TwoFactorSetup onEnabled={() => toast(t('Two-factor authentication is on'), 'success')} />
      )}
    </div>
  );
}

function SessionsCard() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const load = () => api.get<Session[]>('/auth/sessions').then(setSessions).catch(toastError);
  useEffect(() => {
    load();
  }, []);
  const revoke = async (s: Session) => {
    if (
      !(await confirmDialog({
        title: t('Sign out this session?'),
        body: describeUserAgent(s.userAgent),
        confirmLabel: t('Sign out'),
        danger: true,
      }))
    )
      return;
    try {
      await api.del(`/auth/sessions/${s.id}`);
      load();
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <div className="card">
      <h3>{t('Where you are signed in')}</h3>
      {!sessions ? (
        <Spinner />
      ) : (
        <div className="list-card" style={{ margin: 0 }}>
          {sessions.map((s) => (
            <div key={s.id} className="list-item">
              <Monitor size={20} className="faint" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {describeUserAgent(s.userAgent)}{' '}
                  {s.current && <span className="pill pill-brand">{t('This device')}</span>}
                </div>
                <div className="faint small ellipsis" title={s.userAgent}>
                  {s.ip} · {t('active {when}', { when: formatRelative(s.lastSeenAt) })} ·{' '}
                  {t('signed in {when}', { when: formatDateTime(s.createdAt) })}
                </div>
              </div>
              {!s.current && (
                <button className="btn btn-sm" onClick={() => revoke(s)}>
                  {t('Sign out')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccountSection() {
  const me = useStore((s) => s.me)!;
  return (
    <>
      <div className="card">
        <h3>{t('Account')}</h3>
        <div className="small">
          <div>
            <span className="faint">{t('Email')}:</span> {me.email}
          </div>
          <div>
            <span className="faint">{t('Username')}:</span> @{me.username}
          </div>
          <div>
            <span className="faint">{t('Role')}:</span> {t(me.role)}
          </div>
        </div>
        <p className="faint small">{t('Ask an administrator to change your email or username.')}</p>
      </div>
      <PasswordCard />
      <TwoFactorCard />
      <SessionsCard />
    </>
  );
}

function KeywordEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const k = draft.trim();
    if (k && !value.includes(k)) onChange([...value, k]);
    setDraft('');
  };
  return (
    <div>
      {value.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
          {value.map((k) => (
            <span key={k} className="pill pill-brand row" style={{ gap: 4 }}>
              {k}
              <button
                className="icon-btn icon-btn-sm"
                style={{ width: 18, height: 18 }}
                onClick={() => onChange(value.filter((x) => x !== k))}
                aria-label={t('Remove {name}', { name: k })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row">
        <input
          id="n-kw"
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t('e.g. deploy, invoice, your nickname')}
          maxLength={50}
        />
        <button className="btn" type="button" onClick={add} disabled={!draft.trim()}>
          {t('Add')}
        </button>
      </div>
    </div>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function NotificationsSection() {
  const me = useStore((s) => s.me)!;
  const info = useStore((s) => s.info);
  const prefs = me.preferences;
  const [perm, setPerm] = useState(notificationPermission());
  const sched = prefs.notifySchedule;
  const dnd = !!me.dndUntil;
  const setDnd = async (minutes: number | null) => {
    try {
      const updated = await api.put<Me>('/me/dnd', {
        until: minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null,
      });
      useStore.setState({ me: updated });
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <>
      <div className="card">
        <h3>{t('Desktop & mobile notifications')}</h3>
        {perm === 'unsupported' ? (
          <p className="muted small">
            {t(
              'This browser does not support notifications. Install the app on your device for push notifications.',
            )}
          </p>
        ) : perm === 'granted' ? (
          <p className="small">✅ {t('Notifications are enabled on this device.')}</p>
        ) : perm === 'denied' ? (
          <p className="muted small">
            {t(
              'Notifications are blocked for this site. Allow them in your browser’s site settings, then reload.',
            )}
          </p>
        ) : (
          <>
            <p className="muted small">
              {t('Get notified about mentions and direct messages, even when this tab is closed.')}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => enableNotifications().then(setPerm).catch(toastError)}
            >
              {t('Enable notifications')}
            </button>
          </>
        )}
        {!info?.vapidPublicKey && (
          <p className="faint small">
            {t('Push notifications are not configured on this server.')}
          </p>
        )}
      </div>
      <div className="card">
        <h3>{t('Pause notifications')}</h3>
        {dnd ? (
          <div className="row">
            <BellOff size={16} />
            <span className="grow small">
              {t('Paused until {when}', { when: formatDateTime(me.dndUntil!) })}
            </span>
            <button className="btn btn-sm" onClick={() => setDnd(null)}>
              {t('Resume')}
            </button>
          </div>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {[
              [30, t('30 minutes')],
              [60, t('1 hour')],
              [120, t('2 hours')],
              [480, t('8 hours')],
              [1440, t('24 hours')],
            ].map(([m, label]) => (
              <button key={m} className="btn btn-sm" onClick={() => setDnd(m as number)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h3>{t('Notification schedule')}</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={sched.enabled}
            onChange={(e) => savePrefs({ notifySchedule: { ...sched, enabled: e.target.checked } })}
          />
          {t('Only notify me during these hours (in my time zone)')}
        </label>
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
          <label className="row small" htmlFor="n-start">
            {t('From')}
            <input
              id="n-start"
              className="input"
              type="time"
              style={{ width: 'auto' }}
              value={sched.start}
              disabled={!sched.enabled}
              onChange={(e) => savePrefs({ notifySchedule: { ...sched, start: e.target.value } })}
            />
          </label>
          <label className="row small" htmlFor="n-end">
            {t('to')}
            <input
              id="n-end"
              className="input"
              type="time"
              style={{ width: 'auto' }}
              value={sched.end}
              disabled={!sched.enabled}
              onChange={(e) => savePrefs({ notifySchedule: { ...sched, end: e.target.value } })}
            />
          </label>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('Days')}>
          {DAYS.map((d, i) => (
            <label key={d} className="checkbox" style={{ marginBottom: 0 }}>
              <input
                type="checkbox"
                disabled={!sched.enabled}
                checked={sched.days.includes(i)}
                onChange={(e) =>
                  savePrefs({
                    notifySchedule: {
                      ...sched,
                      days: e.target.checked
                        ? [...sched.days, i].sort()
                        : sched.days.filter((x) => x !== i),
                    },
                  })
                }
              />
              {t(d)}
            </label>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>{t('Email')}</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.emailNotifications}
            onChange={(e) => savePrefs({ emailNotifications: e.target.checked })}
          />
          {t('Email me about mentions, direct messages and thread replies I miss')}
        </label>
        <div className="field">
          <label htmlFor="n-delay">{t('Send after I have been away for')}</label>
          <select
            id="n-delay"
            className="select"
            style={{ maxWidth: 240 }}
            value={prefs.emailDelayMinutes}
            disabled={!prefs.emailNotifications}
            onChange={(e) => savePrefs({ emailDelayMinutes: Number(e.target.value) })}
          >
            {[5, 15, 30, 60, 240].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? t('{n} minutes', { n: m }) : t('{n} hours', { n: m / 60 })}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="card">
        <h3>{t('Keywords')}</h3>
        <p className="muted small">
          {t('Get notified when anyone uses these words in a channel you belong to.')}
        </p>
        <KeywordEditor value={prefs.keywords} onChange={(keywords) => savePrefs({ keywords })} />
      </div>
    </>
  );
}

export function PreferencesSection() {
  const prefs = useStore((s) => s.me!.preferences);
  return (
    <>
      <div className="card">
        <h3>{t('Theme')}</h3>
        {(['system', 'light', 'dark'] as const).map((v) => (
          <label key={v} className="checkbox">
            <input
              type="radio"
              name="theme"
              checked={prefs.theme === v}
              onChange={() => savePrefs({ theme: v })}
            />
            {v === 'system' ? t('Match my device') : v === 'light' ? t('Light') : t('Dark')}
          </label>
        ))}
      </div>
      <div className="card">
        <h3>{t('Message density')}</h3>
        {(['comfortable', 'compact'] as const).map((v) => (
          <label key={v} className="checkbox">
            <input
              type="radio"
              name="density"
              checked={prefs.density === v}
              onChange={() => savePrefs({ density: v })}
            />
            {v === 'comfortable'
              ? t('Comfortable — larger avatars and spacing')
              : t('Compact — fit more messages on screen')}
          </label>
        ))}
      </div>
      <div className="card">
        <h3>{t('Sending messages')}</h3>
        <label className="checkbox">
          <input
            type="radio"
            name="send"
            checked={prefs.enterToSend}
            onChange={() => savePrefs({ enterToSend: true })}
          />
          {t('Enter sends; Shift+Enter adds a new line')}
        </label>
        <label className="checkbox">
          <input
            type="radio"
            name="send"
            checked={!prefs.enterToSend}
            onChange={() => savePrefs({ enterToSend: false })}
          />
          {t('Enter adds a new line; Ctrl/⌘+Enter sends')}
        </label>
      </div>
    </>
  );
}
