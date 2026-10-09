// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry } from '@ocpc/shared';
import { api } from '../lib/api';
import { displayName, toastError, useStore } from '../lib/store';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Avatar, Spinner } from '../components/ui';
import { SectionTitle } from './common';

const PAGE = 100;

export function Audit() {
  const users = useStore((s) => s.users);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const fetchPage = useCallback(
    (before?: string) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (before) p.set('before', before);
      if (action.trim()) p.set('action', action.trim());
      if (actorId) p.set('actorId', actorId);
      return api.get<AuditEntry[]>(`/admin/audit?${p}`);
    },
    [action, actorId],
  );

  useEffect(() => {
    const id = setTimeout(() => {
      fetchPage()
        .then((r) => {
          setEntries(r);
          setHasMore(r.length === PAGE);
        })
        .catch(toastError);
    }, 250);
    return () => clearTimeout(id);
  }, [fetchPage]);

  const more = async () => {
    if (!entries?.length) return;
    try {
      const r = await fetchPage(entries[entries.length - 1]!.id);
      setEntries([...entries, ...r]);
      setHasMore(r.length === PAGE);
    } catch (err) {
      toastError(err);
    }
  };

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const people = Object.values(users).sort((a, b) => displayName(a).localeCompare(displayName(b)));
  return (
    <>
      <SectionTitle title={t('Audit log')} />
      <div className="admin-filters">
        <input className="input" placeholder={t('Action, e.g. auth. or user.')} aria-label={t('Filter by action')} value={action} onChange={(e) => setAction(e.target.value)} />
        <select className="select" value={actorId} onChange={(e) => setActorId(e.target.value)} aria-label={t('Filter by person')}>
          <option value="">{t('Anyone')}</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {displayName(u)} (@{u.username})
            </option>
          ))}
        </select>
      </div>
      {!entries ? (
        <Spinner />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('When')}</th>
                  <th>{t('Who')}</th>
                  <th>{t('Action')}</th>
                  <th>{t('Target')}</th>
                  <th>{t('IP address')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const actor = e.actorId ? users[e.actorId] : undefined;
                  const target = e.targetType === 'user' && e.targetId ? users[e.targetId] : undefined;
                  const hasMeta = Object.keys(e.metadata).length > 0;
                  return (
                    <tr key={e.id}>
                      <td className="small" style={{ whiteSpace: 'nowrap' }}>
                        {formatDateTime(e.createdAt)}
                      </td>
                      <td>
                        {e.actorId ? (
                          <span className="row">
                            <Avatar user={actor} size={20} /> <span className="small">{displayName(actor)}</span>
                          </span>
                        ) : (
                          <span className="faint small">{t('System')}</span>
                        )}
                      </td>
                      <td>
                        <code className="small">{e.action}</code>
                        {hasMeta && (
                          <div>
                            <button className="btn btn-sm btn-ghost" style={{ padding: 0 }} onClick={() => toggle(e.id)} aria-expanded={open.has(e.id)}>
                              {open.has(e.id) ? t('Hide details') : t('Details')}
                            </button>
                            {open.has(e.id) && <pre className="admin-json">{JSON.stringify(e.metadata, null, 2)}</pre>}
                          </div>
                        )}
                      </td>
                      <td className="small">
                        {target ? displayName(target) : e.targetType}
                        {!target && e.targetId && <span className="faint"> {e.targetId.slice(-8)}</span>}
                      </td>
                      <td className="small faint">{e.ip ?? '—'}</td>
                    </tr>
                  );
                })}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="faint" style={{ textAlign: 'center' }}>
                      {t('No entries match.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <button className="btn" style={{ marginTop: 12 }} onClick={more}>
              {t('Load more')}
            </button>
          )}
        </>
      )}
    </>
  );
}
