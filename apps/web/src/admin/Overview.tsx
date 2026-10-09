// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Mail } from 'lucide-react';
import { api } from '../lib/api';
import { toast, toastError, useStore } from '../lib/store';
import { formatBytes } from '../lib/format';
import { t } from '../lib/i18n';
import { Spinner } from '../components/ui';
import { SectionTitle, type ServerInfoFlags } from './common';

interface Stats {
  users: number;
  channels: number;
  messages: number;
  files: number;
  storageBytes: number;
  activeUsers30d: number;
  messages30d: number;
  messagesByDay: Record<string, number>;
  onlineNow: number;
  connections: number;
}

function last30Days(byDay: Record<string, number>) {
  const out: { day: string; n: number }[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, n: byDay[key] ?? 0 });
  }
  return out;
}

function MessagesChart({ byDay }: { byDay: Record<string, number> }) {
  const data = last30Days(byDay);
  const max = Math.max(1, ...data.map((d) => d.n));
  const W = 600;
  const H = 180;
  const padL = 32;
  const padB = 22;
  const padT = 8;
  const plotW = W - padL - 4;
  const plotH = H - padB - padT;
  const bw = plotW / data.length;
  const total = data.reduce((s, d) => s + d.n, 0);
  const peak = data.reduce((a, b) => (b.n > a.n ? b : a), data[0]!);
  const ticks = [0, Math.round(max / 2), max];
  const short = (day: string) => new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="admin-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t('Messages per day over the last 30 days: {total} in total, peak of {n} on {day}.', { total, n: peak.n, day: short(peak.day) })}
      >
        {ticks.map((v) => {
          const y = padT + plotH - (v / max) * plotH;
          return (
            <g key={v}>
              <line className="grid" x1={padL} x2={W - 4} y1={y} y2={y} />
              <text className="axis" x={padL - 6} y={y + 3} textAnchor="end">
                {v}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.n / max) * plotH;
          return (
            <rect key={d.day} className="bar" x={padL + i * bw + 1} y={padT + plotH - h} width={Math.max(1, bw - 2)} height={h} rx={2}>
              <title>{`${short(d.day)}: ${d.n}`}</title>
            </rect>
          );
        })}
        {data.map((d, i) =>
          i % 7 === 0 || i === data.length - 1 ? (
            <text key={d.day} className="axis" x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle">
              {short(d.day)}
            </text>
          ) : null,
        )}
      </svg>
      <table className="sr-only">
        <caption>{t('Messages per day')}</caption>
        <thead>
          <tr>
            <th>{t('Day')}</th>
            <th>{t('Messages')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [server, setServer] = useState<ServerInfoFlags | null>(null);
  const [sending, setSending] = useState(false);
  const sourceUrl = useStore((s) => s.info?.sourceUrl) ?? '';
  useEffect(() => {
    api.get<Stats>('/admin/stats').then(setStats).catch(toastError);
    api.get<{ server: ServerInfoFlags }>('/admin/settings').then((r) => setServer(r.server)).catch(toastError);
  }, []);
  const testEmail = async () => {
    setSending(true);
    try {
      await api.post('/admin/test-email');
      toast(t('Test email sent. Check your inbox.'), 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setSending(false);
    }
  };
  if (!stats) return <Spinner />;
  const tiles: [string, string | number][] = [
    [t('People'), stats.users],
    [t('Online now'), stats.onlineNow],
    [t('Active (30 days)'), stats.activeUsers30d],
    [t('Channels'), stats.channels],
    [t('Messages'), stats.messages.toLocaleString()],
    [t('Messages (30 days)'), stats.messages30d.toLocaleString()],
    [t('Files'), stats.files.toLocaleString()],
    [t('Storage used'), formatBytes(stats.storageBytes)],
  ];
  const guide = `${sourceUrl.replace(/\/+$/, '')}/blob/main/docs/admin-guide.md`;
  const checks: { ok: boolean; label: string; hint: React.ReactNode }[] = server
    ? [
        { ok: server.smtp, label: t('Email (SMTP)'), hint: <>{t('Set')} <code>SMTP_URL</code> {t('and')} <code>SMTP_FROM</code> {t('to send invites, reset links and missed-message digests.')}</> },
        { ok: server.oidc, label: t('Single sign-on (OIDC)'), hint: <>{t('Set')} <code>OIDC_ISSUER</code>, <code>OIDC_CLIENT_ID</code> {t('and')} <code>OIDC_CLIENT_SECRET</code>.</> },
        { ok: server.s3, label: t('S3 file storage'), hint: <>{t('Optional. Set')} <code>S3_BUCKET</code> {t('(and credentials) to store files in S3-compatible storage instead of local disk.')}</> },
        { ok: server.turn, label: t('TURN relay for calls'), hint: <>{t('Set')} <code>TURN_URLS</code> {t('and')} <code>TURN_SECRET</code> {t('so calls work across firewalls and NAT.')}</> },
        { ok: server.livekit, label: t('LiveKit (large meetings)'), hint: <>{t('Optional. Set')} <code>LIVEKIT_URL</code>, <code>LIVEKIT_API_KEY</code> {t('and')} <code>LIVEKIT_API_SECRET</code> {t('for calls with more than 8 people.')}</> },
      ]
    : [];
  return (
    <>
      <SectionTitle title={t('Overview')} />
      <div className="stat-grid">
        {tiles.map(([label, value]) => (
          <div key={label} className="stat">
            <div className="value">{value}</div>
            <div className="label">{label}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>{t('Messages per day (last 30 days)')}</h3>
        <MessagesChart byDay={stats.messagesByDay} />
      </div>
      {server && (
        <div className="card">
          <h3>{t('Server configuration')}</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            {t('Public URL')}: <code>{server.publicUrl}</code> · {t('Database')}: <strong>{server.database}</strong> · {t('Upload limit')}: {server.maxUploadCapMb} MB
          </p>
          {checks.map((c) => (
            <div key={c.label} className="admin-check">
              {c.ok ? <CheckCircle2 size={18} className="ok" aria-label={t('Enabled')} /> : <Circle size={18} className="off" aria-label={t('Not configured')} />}
              <div className="grow">
                <strong>{c.label}</strong> <span className="faint small">{c.ok ? t('enabled') : t('not configured')}</span>
                {!c.ok && <div className="small muted admin-hint">{c.hint}</div>}
              </div>
              {c.label === t('Email (SMTP)') && c.ok && (
                <button className="btn btn-sm" onClick={testEmail} disabled={sending}>
                  <Mail size={14} /> {t('Send test email')}
                </button>
              )}
            </div>
          ))}
          <p className="small" style={{ marginBottom: 0 }}>
            <a href={guide} target="_blank" rel="noopener noreferrer">
              {t('Read the administrator guide')}
            </a>
          </p>
        </div>
      )}
    </>
  );
}
