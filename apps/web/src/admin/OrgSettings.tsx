// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { Channel, OrgSettings as Settings } from '@ocpc/shared';
import { api, uploadFile } from '../lib/api';
import { toast, toastError, useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { Spinner } from '../components/ui';
import { ChipInput, SectionTitle, type ServerInfoFlags } from './common';

type Form = Omit<Settings, 'iconUrl' | 'readReceipts'> & { iconFileId?: string | null };

const pick = (s: Settings): Form => ({
  name: s.name,
  allowSignupDomains: s.allowSignupDomains,
  require2fa: s.require2fa,
  ssoOnly: s.ssoOnly,
  guestsEnabled: s.guestsEnabled,
  retentionDays: s.retentionDays,
  linkPreviews: s.linkPreviews,
  maxUploadMb: s.maxUploadMb,
  allowedMimePrefixes: s.allowedMimePrefixes,
  defaultChannelIds: s.defaultChannelIds,
  messageEditWindowMinutes: s.messageEditWindowMinutes,
});

export function OrgSettings() {
  const [server, setServer] = useState<ServerInfoFlags | null>(null);
  const [orig, setOrig] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [publicChannels, setPublicChannels] = useState<Channel[]>([]);
  const [saving, setSaving] = useState(false);
  const iconInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<Settings & { server: ServerInfoFlags }>('/admin/settings')
      .then((r) => {
        setServer(r.server);
        setOrig(pick(r));
        setForm(pick(r));
        setIconUrl(r.iconUrl);
      })
      .catch(toastError);
    api
      .get<Channel[]>('/channels')
      .then((c) => setPublicChannels(c.filter((x) => x.kind === 'public')))
      .catch(() => {});
  }, []);

  const dirty = useMemo(
    () => !!form && !!orig && JSON.stringify(form) !== JSON.stringify(orig),
    [form, orig],
  );
  if (!form || !server) return <Spinner />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  const uploadIcon = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast(t('Choose an image file'), 'error');
    try {
      const info = await uploadFile(file).promise;
      setIconUrl(URL.createObjectURL(file));
      set('iconFileId', info.id);
    } catch (err) {
      toastError(err);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      for (const k of Object.keys(form) as (keyof Form)[]) {
        if (JSON.stringify(form[k]) !== JSON.stringify(orig?.[k])) body[k] = form[k];
      }
      const settings = await api.patch<Settings>('/admin/settings', body);
      useStore.setState({ settings });
      const next = pick(settings);
      setOrig(next);
      setForm(next);
      setIconUrl(settings.iconUrl);
      toast(t('Settings saved'), 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const retentionPresets = [30, 90, 365, 730];
  return (
    <>
      <SectionTitle title={t('Organization settings')} />
      <div className="card">
        <h3>{t('General')}</h3>
        <div className="field">
          <label htmlFor="org-name">{t('Organization name')}</label>
          <input
            id="org-name"
            className="input"
            value={form.name}
            maxLength={80}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="field">
          <span className="label">{t('Icon')}</span>
          <div className="row">
            <img
              className="admin-icon-preview"
              src={iconUrl ?? '/icon.svg'}
              alt={t('Organization icon')}
            />
            <button className="btn" onClick={() => iconInput.current?.click()}>
              <Upload size={15} /> {t('Upload image')}
            </button>
            {iconUrl && (
              <button
                className="btn btn-ghost"
                onClick={() => (setIconUrl(null), set('iconFileId', null))}
              >
                {t('Use default')}
              </button>
            )}
            <input
              ref={iconInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => (
                e.target.files?.[0] && uploadIcon(e.target.files[0]),
                (e.target.value = '')
              )}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3>{t('Sign-in & security')}</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.require2fa}
            onChange={(e) => set('require2fa', e.target.checked)}
          />
          <span>
            <strong>{t('Require two-factor authentication')}</strong>
            <div className="faint small">
              {t('People without 2FA must set it up before they can continue.')}
            </div>
          </span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.ssoOnly}
            disabled={!server.oidc}
            onChange={(e) => set('ssoOnly', e.target.checked)}
          />
          <span>
            <strong>{t('Single sign-on only')}</strong>
            <div className="faint small">
              {server.oidc
                ? t('Disable password sign-in for everyone except owners (break-glass access).')
                : t('Configure OIDC on the server to enable this.')}
            </div>
          </span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.guestsEnabled}
            onChange={(e) => set('guestsEnabled', e.target.checked)}
          />
          <span>
            <strong>{t('Allow guest accounts')}</strong>
            <div className="faint small">
              {t('Guests only see the channels they are invited to.')}
            </div>
          </span>
        </label>
        <div className="field">
          <span className="label">{t('Allowed email domains for invite links')}</span>
          <ChipInput
            value={form.allowSignupDomains}
            onChange={(v) => set('allowSignupDomains', v)}
            placeholder="example.com"
            label={t('Add domain')}
            normalize={(s) => s.trim().toLowerCase().replace(/^@/, '')}
          />
          <span className="hint">{t('Leave empty to allow any email address.')}</span>
        </div>
      </div>

      <div className="card">
        <h3>{t('Messages & files')}</h3>
        <div className="field">
          <label htmlFor="retention">{t('Message retention')}</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <select
              id="retention"
              className="select"
              style={{ width: 'auto' }}
              value={
                form.retentionDays == null
                  ? 'forever'
                  : retentionPresets.includes(form.retentionDays)
                    ? String(form.retentionDays)
                    : 'custom'
              }
              onChange={(e) =>
                set(
                  'retentionDays',
                  e.target.value === 'forever'
                    ? null
                    : e.target.value === 'custom'
                      ? (form.retentionDays ?? 180)
                      : Number(e.target.value),
                )
              }
            >
              <option value="forever">{t('Keep forever')}</option>
              {retentionPresets.map((d) => (
                <option key={d} value={d}>
                  {t('{n} days', { n: d })}
                </option>
              ))}
              <option value="custom">{t('Custom')}</option>
            </select>
            {form.retentionDays != null && (
              <input
                className="input"
                type="number"
                min={1}
                max={36500}
                style={{ width: 120 }}
                value={form.retentionDays}
                onChange={(e) => set('retentionDays', Math.max(1, Number(e.target.value) || 1))}
                aria-label={t('Retention in days')}
              />
            )}
          </div>
          <span className="hint">
            {t('Messages and files older than this are permanently deleted every hour.')}
          </span>
        </div>
        <div className="field">
          <label htmlFor="edit-window">{t('Message editing')}</label>
          <div className="row">
            <select
              id="edit-window"
              className="select"
              style={{ width: 'auto' }}
              value={form.messageEditWindowMinutes == null ? 'any' : 'limit'}
              onChange={(e) =>
                set('messageEditWindowMinutes', e.target.value === 'any' ? null : 60)
              }
            >
              <option value="any">{t('Any time')}</option>
              <option value="limit">{t('Only within a time limit')}</option>
            </select>
            {form.messageEditWindowMinutes != null && (
              <>
                <input
                  className="input"
                  type="number"
                  min={1}
                  style={{ width: 100 }}
                  value={form.messageEditWindowMinutes}
                  onChange={(e) =>
                    set('messageEditWindowMinutes', Math.max(1, Number(e.target.value) || 1))
                  }
                  aria-label={t('Minutes')}
                />
                <span className="muted small">{t('minutes')}</span>
              </>
            )}
          </div>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.linkPreviews}
            onChange={(e) => set('linkPreviews', e.target.checked)}
          />
          <span>
            <strong>{t('Link previews')}</strong>
            <div className="faint small">
              {t(
                'The server fetches page titles and images for links (private addresses are never fetched).',
              )}
            </div>
          </span>
        </label>
        <div className="field">
          <label htmlFor="max-upload">{t('Maximum upload size (MB)')}</label>
          <input
            id="max-upload"
            className="input"
            type="number"
            min={1}
            max={server.maxUploadCapMb}
            style={{ width: 140 }}
            value={form.maxUploadMb}
            onChange={(e) =>
              set(
                'maxUploadMb',
                Math.min(server.maxUploadCapMb, Math.max(1, Number(e.target.value) || 1)),
              )
            }
          />
          <span className="hint">
            {t('Server limit: {n} MB (OCPC_MAX_UPLOAD_MB).', { n: server.maxUploadCapMb })}
          </span>
        </div>
        <div className="field">
          <span className="label">{t('Allowed file types')}</span>
          <ChipInput
            value={form.allowedMimePrefixes}
            onChange={(v) => set('allowedMimePrefixes', v)}
            placeholder="image/, application/pdf"
            label={t('Add file type')}
            normalize={(s) => s.trim().toLowerCase()}
          />
          <span className="hint">
            {t('MIME type prefixes. Leave empty to allow all file types.')}
          </span>
        </div>
      </div>

      <div className="card">
        <h3>{t('Default channels')}</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          {t('New members join these public channels automatically.')}
        </p>
        {publicChannels.map((c) => (
          <label key={c.id} className="checkbox">
            <input
              type="checkbox"
              checked={form.defaultChannelIds.includes(c.id) || c.isDefault}
              disabled={c.isDefault}
              onChange={(e) =>
                set(
                  'defaultChannelIds',
                  e.target.checked
                    ? [...form.defaultChannelIds, c.id]
                    : form.defaultChannelIds.filter((x) => x !== c.id),
                )
              }
            />
            #{c.name}{' '}
            {c.isDefault && <span className="faint small">({t('set on the channel')})</span>}
          </label>
        ))}
      </div>

      {dirty && (
        <div className="admin-savebar" role="region" aria-label={t('Unsaved changes')}>
          <span className="muted small grow">{t('You have unsaved changes.')}</span>
          <button
            className="btn"
            onClick={() => (
              setForm(orig),
              setIconUrl(useStore.getState().settings?.iconUrl ?? null)
            )}
            disabled={saving}
          >
            {t('Discard')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
            {t('Save changes')}
          </button>
        </div>
      )}
    </>
  );
}
