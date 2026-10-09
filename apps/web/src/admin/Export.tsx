// SPDX-License-Identifier: AGPL-3.0-only
import { Download } from 'lucide-react';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { SectionTitle } from './common';

export function Export() {
  const me = useStore((s) => s.me)!;
  const isOwner = me.role === 'owner';
  return (
    <>
      <SectionTitle title={t('Export & backups')} />
      <div className="card">
        <h3>{t('Export everything')}</h3>
        <p className="muted">
          {t(
            'Download all users, channels, memberships, messages, reactions, pins and file metadata as NDJSON: one JSON object per line, each shaped like {"type": "...", "data": {...}}. Passwords, two-factor secrets and tokens are never included. File contents stay in storage; use a backup to copy them.',
          )}
        </p>
        {isOwner ? (
          <a className="btn btn-primary" href="/api/v1/admin/export" download>
            <Download size={15} /> {t('Download export')}
          </a>
        ) : (
          <p className="faint small">{t('Only owners can export the whole organization.')}</p>
        )}
      </div>
      <div className="card">
        <h3>{t('Command-line tools')}</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          {t('Run these on the server (in Docker: docker exec -it <container> ocpc <command>).')}
        </p>
        <table className="table">
          <tbody>
            <tr>
              <td>
                <code>ocpc backup --out /backups/today</code>
              </td>
              <td className="small">
                {t(
                  'Consistent copy of the SQLite database and uploaded files. For PostgreSQL, use pg_dump.',
                )}
              </td>
            </tr>
            <tr>
              <td>
                <code>ocpc restore --in /backups/today</code>
              </td>
              <td className="small">{t('Restore a backup (stop the server first).')}</td>
            </tr>
            <tr>
              <td>
                <code>ocpc export --out org.ndjson</code>
              </td>
              <td className="small">{t('The same export as the button above.')}</td>
            </tr>
            <tr>
              <td>
                <code>ocpc import-slack --in export.zip</code>
              </td>
              <td className="small">
                {t(
                  'Import public channels, messages, threads and reactions from a Slack-format workspace export. Import is available from the command line only.',
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
