// SPDX-License-Identifier: AGPL-3.0-only
// Admin → Migrate: bring history over from another chat tool, step by step:
// upload an export archive, review the preview, choose what to import, then invite people.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileArchive,
  Mail,
  Play,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { toast, toastError, useStore } from '../lib/store';
import { formatBytes, formatDateTime } from '../lib/format';
import { plural, t } from '../lib/i18n';
import { confirmDialog, copyText, EmptyState, Spinner } from '../components/ui';
import { SectionTitle } from './common';

type Kind = 'public' | 'private' | 'dm' | 'group_dm';

interface PreviewChannel {
  id: string;
  name: string;
  kind: Kind;
  group: string | null;
  members: number;
  messages: number;
  files: number;
  firstAt: string | null;
  lastAt: string | null;
  archived: boolean;
  alreadyImported: number;
}

interface Preview {
  source: string;
  label: string;
  users: {
    id: string;
    name: string;
    email: string | null;
    match: 'existing' | 'new' | 'bot';
    deleted: boolean;
  }[];
  channels: PreviewChannel[];
  totals: { messages: number; files: number; users: number; newUsers: number; channels: number };
  retention: { days: number; olderMessages: number } | null;
  warnings: string[];
}

interface Report {
  users: { created: number; matched: number; bots: number };
  channels: {
    id: string;
    name: string;
    messages: number;
    files: number;
    skippedExisting: number;
  }[];
  totals: { messages: number; files: number; reactions: number; skippedExisting: number };
  skipped: { item: string; reason: string }[];
  warnings: string[];
}

interface ImportRun {
  id: string;
  source: string;
  label: string;
  fileName: string;
  sha256: string;
  size: number;
  status: 'analyzing' | 'ready' | 'running' | 'completed' | 'failed' | 'undone';
  hasArchive: boolean;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  progress: {
    phase: string;
    channelsDone: number;
    channelsTotal: number;
    messages: number;
    current: string | null;
  } | null;
  totals: Report['totals'] | null;
  preview?: Preview | null;
  report?: Report | null;
}

const KIND_LABEL: Record<Kind, string> = {
  public: 'Public channel',
  private: 'Private channel',
  dm: 'Direct message',
  group_dm: 'Group message',
};

const SOURCE_LABEL: Record<string, string> = {
  slack: 'Slack export',
  teams: 'Microsoft Teams',
  unknown: '—',
};

function upload(file: File, onProgress: (f: number) => void) {
  return new Promise<ImportRun>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/admin/imports');
    xhr.setRequestHeader('X-OCPC-CSRF', '1');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { message?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as ImportRun);
      else
        reject(
          new ApiError(
            xhr.status,
            data.error ?? 'upload_failed',
            data.message ?? t('Upload failed'),
          ),
        );
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', t('Network error during upload')));
    const fd = new FormData();
    fd.append('file', file, file.name);
    xhr.send(fd);
  });
}

function StatusPill({ status }: { status: ImportRun['status'] }) {
  const label: Record<ImportRun['status'], string> = {
    analyzing: t('Analyzing'),
    ready: t('Ready to import'),
    running: t('Importing'),
    completed: t('Imported'),
    failed: t('Failed'),
    undone: t('Undone'),
  };
  return (
    <span className={`pill ${status === 'completed' || status === 'ready' ? 'pill-brand' : ''}`}>
      {label[status]}
    </span>
  );
}

export function Migrate() {
  const me = useStore((s) => s.me)!;
  const [runs, setRuns] = useState<ImportRun[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      api
        .get<{ imports: ImportRun[] }>('/admin/imports')
        .then((r) => setRuns(r.imports))
        .catch(toastError),
    [],
  );
  useEffect(() => {
    if (me.role === 'owner') load();
  }, [load, me.role]);

  if (me.role !== 'owner')
    return (
      <>
        <SectionTitle title={t('Migrate')} />
        <EmptyState icon={<ShieldCheck size={40} />} title={t('Owners only')}>
          {t('Imports can include private conversations, so only owners can run them.')}
        </EmptyState>
      </>
    );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(0);
    try {
      const run = await upload(file, setUploading);
      toast(t('Archive analyzed. Review the preview below.'), 'success');
      await load();
      setOpenId(run.id);
    } catch (err) {
      toastError(err);
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <SectionTitle title={t('Migrate from another chat tool')} />
      <div className="card">
        <h3>{t('How it works')}</h3>
        <ol className="migrate-steps">
          <li>
            <strong>{t('Export your data.')}</strong>{' '}
            {t(
              'From Slack: a workspace owner downloads a data export (a ZIP file). From Microsoft Teams: run "ocpc collect-teams" on this server, which reads your tenant through the Microsoft Graph API and writes an archive.',
            )}
          </li>
          <li>
            <strong>{t('Upload and review.')}</strong>{' '}
            {t(
              'Nothing is imported yet. You see every channel, conversation and person the archive contains.',
            )}
          </li>
          <li>
            <strong>{t('Choose and import.')}</strong>{' '}
            {t(
              'Pick channels and a date range. Private channels and direct messages stay out unless you include them and confirm you are allowed to move them.',
            )}
          </li>
          <li>
            <strong>{t('Invite people.')}</strong>{' '}
            {t(
              'Everyone gets a personal invite to claim their account, with their history already in place.',
            )}
          </li>
        </ol>
        <p className="faint small">
          {t(
            'You can import again at cut-over to bring over newer messages (already imported ones are skipped), and undo any import. See docs/migration.md for details.',
          )}
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button
            className="btn btn-primary"
            disabled={uploading !== null}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={15} /> {t('Upload export archive')}
          </button>
          {uploading !== null && (
            <div className="migrate-progress" aria-live="polite">
              <div className="migrate-bar">
                <div style={{ width: `${Math.round(uploading * 100)}%` }} />
              </div>
              <span className="small faint">
                {uploading < 1
                  ? t('Uploading {pct}%', { pct: Math.round(uploading * 100) })
                  : t('Analyzing…')}
              </span>
            </div>
          )}
        </div>
        <p className="faint small" style={{ marginBottom: 0 }}>
          {t('For very large archives, run "ocpc import --in FILE" on the server instead.')}
        </p>
      </div>

      {!runs ? (
        <Spinner />
      ) : runs.length > 0 ? (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t('Archive')}</th>
                <th>{t('Source')}</th>
                <th>{t('Status')}</th>
                <th>{t('Uploaded')}</th>
                <th>{t('Messages')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className={openId === r.id ? 'selected' : undefined}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOpenId(openId === r.id ? null : r.id)}
                >
                  <td>
                    <button className="link-btn" onClick={() => setOpenId(r.id)}>
                      <FileArchive size={14} /> {r.fileName}
                    </button>
                  </td>
                  <td className="small">{t(SOURCE_LABEL[r.source] ?? r.source)}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="small">{formatDateTime(r.createdAt)}</td>
                  <td className="small">{r.totals?.messages ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {openId && <ImportDetail key={openId} id={openId} onChange={load} />}
      <People />
    </>
  );
}

function ImportDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const [run, setRun] = useState<ImportRun | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includePrivate, setIncludePrivate] = useState(false);
  const [includeDirect, setIncludeDirect] = useState(false);
  const [ack, setAck] = useState(false);
  const [files, setFiles] = useState(true);
  const [merge, setMerge] = useState(true);
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<ImportRun>(`/admin/imports/${id}`);
    setRun(r);
    return r;
  }, [id]);

  useEffect(() => {
    load()
      .then((r) => setSelected(new Set((r.preview?.channels ?? []).map((c) => c.id))))
      .catch(toastError);
  }, [load]);

  // Poll while running.
  useEffect(() => {
    if (run?.status !== 'running' && run?.status !== 'analyzing') return;
    const timer = setInterval(() => {
      load()
        .then((r) => {
          if (r.status !== 'running' && r.status !== 'analyzing') {
            onChange();
            if (r.status === 'completed') toast(t('Import complete'), 'success');
          }
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [run?.status, load, onChange]);

  const preview = run?.preview;
  const allowed = useCallback(
    (c: PreviewChannel) =>
      c.kind === 'public' || (c.kind === 'private' ? includePrivate : includeDirect),
    [includePrivate, includeDirect],
  );
  const chosen = useMemo(
    () => (preview?.channels ?? []).filter((c) => selected.has(c.id) && allowed(c)),
    [preview, selected, allowed],
  );
  if (!run) return <Spinner />;

  const privateCount = preview?.channels.filter((c) => c.kind === 'private').length ?? 0;
  const directCount =
    preview?.channels.filter((c) => c.kind === 'dm' || c.kind === 'group_dm').length ?? 0;
  const needsAck = includePrivate || includeDirect;
  const canStart =
    !!preview &&
    run.hasArchive &&
    ['ready', 'completed', 'failed'].includes(run.status) &&
    chosen.length > 0 &&
    (!needsAck || ack);

  const start = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/imports/${id}/start`, {
        channelIds: chosen.map((c) => c.id),
        includePrivate,
        includeDirect,
        acknowledgePrivate: needsAck ? ack : undefined,
        since: since || undefined,
        until: until || undefined,
        files,
        mergeExisting: merge,
      });
      // Small imports can finish before the first poll, so reload the full record now.
      const r = await load();
      if (r.status === 'completed') toast(t('Import complete'), 'success');
      onChange();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const undoRun = async () => {
    if (
      !(await confirmDialog({
        title: t('Undo this import?'),
        body: t(
          'This deletes the channels, messages and files this import created, and imported accounts nobody has claimed yet. Accounts people already claimed are kept.',
        ),
        confirmLabel: t('Undo import'),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await api.post(`/admin/imports/${id}/undo`);
      toast(t('Import undone'), 'success');
      await load();
      onChange();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const deleteArchive = async () => {
    if (
      !(await confirmDialog({
        title: t('Delete the uploaded archive?'),
        body: t(
          'The archive file is removed from this server. The import record, its checksum and the report are kept. You will need to upload it again to import more from it.',
        ),
        confirmLabel: t('Delete archive'),
        danger: true,
      }))
    )
      return;
    try {
      await api.del(`/admin/imports/${id}/archive`);
      toast(t('Archive deleted'), 'success');
      await load();
      onChange();
    } catch (err) {
      toastError(err);
    }
  };

  const toggle = (cid: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(cid)) n.delete(cid);
      else n.add(cid);
      return n;
    });

  const p = run.progress;
  return (
    <div className="card">
      <h3>{run.label || run.fileName}</h3>
      <div className="small muted migrate-meta">
        <span>{formatBytes(run.size)}</span>
        <span>
          SHA-256{' '}
          <button
            className="link-btn mono"
            title={t('Copy checksum')}
            onClick={() => copyText(run.sha256)}
          >
            {run.sha256.slice(0, 16)}…
          </button>
        </span>
        <StatusPill status={run.status} />
      </div>
      {run.error && <p className="error-text">{run.error}</p>}

      {run.status === 'running' && p && (
        <div className="migrate-progress" aria-live="polite" style={{ margin: '12px 0' }}>
          <div className="migrate-bar">
            <div
              style={{
                width: `${p.channelsTotal ? Math.round((p.channelsDone / p.channelsTotal) * 100) : 0}%`,
              }}
            />
          </div>
          <span className="small faint">
            {p.phase === 'users'
              ? t('Setting up people…')
              : t('{done} of {total} conversations · {n} messages', {
                  done: p.channelsDone,
                  total: p.channelsTotal,
                  n: p.messages,
                })}
            {p.current ? ` · ${p.current}` : ''}
          </span>
        </div>
      )}

      {run.report && run.status !== 'running' && (
        <div className="migrate-summary">
          <h4>{t('Result')}</h4>
          <p className="small">
            {t('{m} messages, {f} files and {r} reactions in {c} conversations.', {
              m: run.report.totals.messages,
              f: run.report.totals.files,
              r: run.report.totals.reactions,
              c: run.report.channels.length,
            })}{' '}
            {t(
              'People: {created} new (inactive until they claim their account), {matched} matched to existing accounts.',
              {
                created: run.report.users.created,
                matched: run.report.users.matched,
              },
            )}
            {run.report.totals.skippedExisting > 0 &&
              ` ${t('{n} messages were already imported and skipped.', { n: run.report.totals.skippedExisting })}`}
          </p>
          {run.report.skipped.length > 0 && (
            <details className="small">
              <summary>
                {plural(
                  run.report.skipped.length,
                  '{n} item needs attention',
                  '{n} items need attention',
                )}
              </summary>
              <ul>
                {run.report.skipped.slice(0, 50).map((s) => (
                  <li key={s.item}>{s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="row" style={{ flexWrap: 'wrap', margin: '12px 0' }}>
        <a className="btn btn-sm" href={`/api/v1/admin/imports/${id}/report`} download>
          <Download size={14} /> {t('Download report')}
        </a>
        {(run.status === 'completed' || run.status === 'failed') && (
          <button className="btn btn-sm" disabled={busy} onClick={undoRun}>
            <RotateCcw size={14} /> {t('Undo import')}
          </button>
        )}
        {run.hasArchive && run.status !== 'running' && (
          <button className="btn btn-sm" onClick={deleteArchive}>
            <Trash2 size={14} /> {t('Delete uploaded archive')}
          </button>
        )}
      </div>

      {preview && run.status !== 'running' && run.status !== 'undone' && (
        <>
          <h4>{t('What this archive contains')}</h4>
          <p className="small">
            {t('{c} conversations, {m} messages, {f} files.', {
              c: preview.totals.channels,
              m: preview.totals.messages,
              f: preview.totals.files,
            })}{' '}
            {t(
              '{u} people: {n} will be created as inactive accounts, the rest match existing accounts by email.',
              {
                u: preview.totals.users,
                n: preview.totals.newUsers,
              },
            )}
          </p>
          {preview.warnings.map((w) => (
            <p key={w} className="migrate-note small">
              {w}
            </p>
          ))}
          {preview.retention && preview.retention.olderMessages > 0 && (
            <p className="migrate-note small">
              {t(
                '{n} messages are older than your {days}-day retention policy and will be deleted by the next retention run. Change the policy in Settings first if you need to keep them.',
                { n: preview.retention.olderMessages, days: preview.retention.days },
              )}
            </p>
          )}

          <h4>{t('Choose what to import')}</h4>
          {privateCount > 0 && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includePrivate}
                onChange={(e) => setIncludePrivate(e.target.checked)}
              />
              <span>
                <strong>{t('Include private channels ({n})', { n: privateCount })}</strong>
                <div className="faint small">
                  {t('Members keep access; nobody else can see them.')}
                </div>
              </span>
            </label>
          )}
          {directCount > 0 && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeDirect}
                onChange={(e) => setIncludeDirect(e.target.checked)}
              />
              <span>
                <strong>{t('Include direct messages ({n})', { n: directCount })}</strong>
                <div className="faint small">
                  {t('Only the people in each conversation can see it.')}
                </div>
              </span>
            </label>
          )}
          {needsAck && (
            <label className="checkbox migrate-ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>
                {t(
                  'I confirm that our organization has the authority and a lawful basis to move these private conversations, and that the people involved have been told. This confirmation is recorded in the audit log.',
                )}
              </span>
            </label>
          )}
          <label className="checkbox">
            <input type="checkbox" checked={files} onChange={(e) => setFiles(e.target.checked)} />
            <span>
              <strong>{t('Copy files')}</strong>
              <div className="faint small">
                {t('Otherwise files are kept as links to the original location.')}
              </div>
            </span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            <span>
              <strong>{t('Merge into existing channels with the same name')}</strong>
              <div className="faint small">
                {t(
                  'For example, history from #general goes into your existing #general. Only channels of the same type are merged. Otherwise a renamed copy such as #general-imported is created.',
                )}
              </div>
            </span>
          </label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div className="field">
              <label htmlFor="mig-since">{t('From (optional)')}</label>
              <input
                id="mig-since"
                className="input"
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mig-until">{t('Until (optional)')}</label>
              <input
                id="mig-until"
                className="input"
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label={t('Select all')}
                      checked={preview.channels.every((c) => selected.has(c.id))}
                      onChange={(e) =>
                        setSelected(
                          new Set(e.target.checked ? preview.channels.map((c) => c.id) : []),
                        )
                      }
                    />
                  </th>
                  <th>{t('Conversation')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Messages')}</th>
                  <th>{t('Dates')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.channels.map((c) => {
                  const ok = allowed(c);
                  return (
                    <tr key={c.id} style={ok ? undefined : { opacity: 0.5 }}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={t('Import {name}', { name: c.name })}
                          disabled={!ok}
                          checked={ok && selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                        />
                      </td>
                      <td>
                        {c.kind === 'public' || c.kind === 'private' ? `#${c.name}` : c.name}
                        {c.group && <div className="faint small">{c.group}</div>}
                      </td>
                      <td className="small">
                        {t(KIND_LABEL[c.kind])}
                        {c.archived && ` · ${t('archived')}`}
                      </td>
                      <td className="small">
                        {c.messages}
                        {c.files > 0 && ` · ${plural(c.files, '{n} file', '{n} files')}`}
                        {c.alreadyImported > 0 && (
                          <div className="faint">
                            {t('{n} already imported', { n: c.alreadyImported })}
                          </div>
                        )}
                      </td>
                      <td className="small">
                        {c.firstAt ? `${c.firstAt.slice(0, 10)} – ${c.lastAt!.slice(0, 10)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!run.hasArchive && (
            <p className="faint small">
              {t('The archive was deleted; upload it again to import from it.')}
            </p>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" disabled={!canStart || busy} onClick={start}>
              <Play size={15} />{' '}
              {run.status === 'completed'
                ? t('Import again (adds only new messages)')
                : plural(chosen.length, 'Import {n} conversation', 'Import {n} conversations')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function People() {
  const [people, setPeople] = useState<{ id: string; email: string; displayName: string }[] | null>(
    null,
  );
  const [sent, setSent] = useState<{ email: string; link: string; emailed: boolean }[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api
        .get<{ people: { id: string; email: string; displayName: string }[] }>(
          '/admin/imports/people',
        )
        .then((r) => setPeople(r.people))
        .catch(toastError),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!people || (people.length === 0 && !sent)) return null;

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ invites: { email: string; link: string; emailed: boolean }[] }>(
        '/admin/imports/people/invite',
        {},
      );
      setSent(r.invites);
      toast(plural(r.invites.length, '{n} invite created', '{n} invites created'), 'success');
      load();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const manual = sent?.filter((s) => !s.emailed) ?? [];
  return (
    <div className="card">
      <h3>{t('Invite imported people')}</h3>
      {people.length > 0 && (
        <>
          <p className="small muted">
            {plural(
              people.length,
              '{n} imported person has not claimed their account yet. Each invite works only for that person’s email address and expires in 14 days.',
              '{n} imported people have not claimed their accounts yet. Each invite works only for that person’s email address and expires in 14 days.',
            )}{' '}
            {t('People who sign in with single sign-on claim their account automatically.')}
          </p>
          <button className="btn btn-primary" disabled={busy} onClick={send}>
            <Mail size={15} /> {plural(people.length, 'Send {n} invite', 'Send {n} invites')}
          </button>
        </>
      )}
      {manual.length > 0 && (
        <>
          <p className="small" style={{ marginTop: 12 }}>
            {t('Email is not configured, so share these links with each person yourself:')}
          </p>
          <textarea
            className="input mono"
            readOnly
            rows={Math.min(10, manual.length + 1)}
            value={manual.map((s) => `${s.email}\t${s.link}`).join('\n')}
          />
          <button
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => copyText(manual.map((s) => `${s.email}\t${s.link}`).join('\n'))}
          >
            {t('Copy all')}
          </button>
        </>
      )}
    </div>
  );
}
