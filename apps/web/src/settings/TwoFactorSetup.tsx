// SPDX-License-Identifier: AGPL-3.0-only
// Two-factor (TOTP) enrollment: secret + QR code, confirmation, recovery codes.
import { useMemo, useState } from 'react';
import { Copy, Download, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { toast, toastError, useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { copyText, Spinner } from '../components/ui';
import { encodeQr, qrSvgPath } from './qr';

export function QrCode({ text, size = 192 }: { text: string; size?: number }) {
  const { path, dim } = useMemo(() => {
    const qr = encodeQr(text);
    return { path: qrSvgPath(qr), dim: qr.size + 8 };
  }, [text]);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      role="img"
      aria-label={t('QR code for your authenticator app')}
      shapeRendering="crispEdges"
      style={{ background: '#fff', borderRadius: 8 }}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  const href = useMemo(
    () =>
      URL.createObjectURL(
        new Blob([`${t('OpenCorpoChat recovery codes')}\n\n${text}\n`], { type: 'text/plain' }),
      ),
    [text],
  );
  return (
    <div>
      <p>
        <ShieldCheck size={16} style={{ verticalAlign: -3, color: 'var(--success)' }} />{' '}
        <strong>{t('Two-factor authentication is on.')}</strong>
      </p>
      <p className="muted small">
        {t(
          'Save these recovery codes somewhere safe. Each one can be used once to sign in if you lose your device.',
        )}
      </p>
      <pre
        className="secret-box"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, margin: '8px 0' }}
      >
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </pre>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          className="btn btn-sm"
          onClick={() => copyText(text).then(() => toast(t('Copied')))}
        >
          <Copy size={14} /> {t('Copy')}
        </button>
        <a className="btn btn-sm" href={href} download="recovery-codes.txt">
          <Download size={14} /> {t('Download')}
        </a>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={onDone}>
          {t('I saved these')}
        </button>
      </div>
    </div>
  );
}

export function TwoFactorSetup({ onEnabled }: { onEnabled: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const begin = async () => {
    setBusy(true);
    try {
      setSetup(await api.post<{ secret: string; uri: string }>('/auth/totp/setup'));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setup) return;
    setBusy(true);
    try {
      const r = await api.post<{ recoveryCodes: string[] }>('/auth/totp/enable', {
        secret: setup.secret,
        code: code.trim(),
      });
      setCodes(r.recoveryCodes);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const finish = () => {
    const me = useStore.getState().me;
    if (me) useStore.setState({ me: { ...me, totpEnabled: true } });
    onEnabled();
  };

  if (codes) return <RecoveryCodes codes={codes} onDone={finish} />;
  if (!setup) {
    return (
      <div>
        <p className="muted small">
          {t(
            'Protect your account with a one-time code from an authenticator app (for example any TOTP app on your phone or password manager).',
          )}
        </p>
        <button className="btn btn-primary" onClick={begin} disabled={busy}>
          {busy ? <Spinner size={16} /> : t('Set up two-factor authentication')}
        </button>
      </div>
    );
  }
  const grouped = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;
  return (
    <form onSubmit={confirm}>
      <ol className="small" style={{ paddingLeft: 18 }}>
        <li>{t('Scan this QR code with your authenticator app.')}</li>
      </ol>
      <div style={{ margin: '8px 0 12px' }}>
        <QrCode text={setup.uri} />
      </div>
      <p className="small muted">
        {t("Can't scan it? Enter this key manually:")}{' '}
        <a href={setup.uri} className="small">
          {t('open in app')}
        </a>
      </p>
      <div className="secret-box" style={{ marginBottom: 12 }}>
        <span className="grow">{grouped}</span>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          onClick={() => copyText(setup.secret).then(() => toast(t('Copied')))}
          aria-label={t('Copy key')}
        >
          <Copy size={14} />
        </button>
      </div>
      <div className="field">
        <label htmlFor="tfa-code">{t('Enter the 6-digit code shown in the app')}</label>
        <input
          id="tfa-code"
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          maxLength={8}
          required
          style={{ maxWidth: 200 }}
        />
      </div>
      <button className="btn btn-primary" disabled={busy || code.trim().length < 6}>
        {busy ? <Spinner size={16} /> : t('Turn on')}
      </button>
    </form>
  );
}
