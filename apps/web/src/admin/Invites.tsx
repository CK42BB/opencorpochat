// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Invite } from '@ocpc/shared';
import { api } from '../lib/api';
import { displayName, toast, toastError, useStore } from '../lib/store';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { confirmDialog, EmptyState, Spinner } from '../components/ui';
import { InviteModal } from '../components/modals';
import { SectionTitle } from './common';

export function Invites() {
  const users = useStore((s) => s.users);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(
    () => api.get<Invite[]>('/invites').then(setInvites).catch(toastError),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const revoke = async (inv: Invite) => {
    if (
      !(await confirmDialog({
        title: t('Revoke this invite?'),
        body: t('The link will stop working immediately.'),
        confirmLabel: t('Revoke'),
        danger: true,
      }))
    )
      return;
    try {
      await api.del(`/invites/${inv.id}`);
      toast(t('Invite revoked'), 'success');
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const now = new Date().toISOString();
  return (
    <>
      <SectionTitle title={t('Invites')}>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <Plus size={15} /> {t('Invite people')}
        </button>
      </SectionTitle>
      <p className="muted small" style={{ marginTop: 0 }}>
        {t(
          'Invite links are shown only once when created. Revoke a link here if it was shared by mistake.',
        )}
      </p>
      {!invites ? (
        <Spinner />
      ) : invites.length === 0 ? (
        <EmptyState title={t('No active invites')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('For')}</th>
                <th>{t('Role')}</th>
                <th>{t('Uses')}</th>
                <th>{t('Expires')}</th>
                <th>{t('Created by')}</th>
                <th>
                  <span className="sr-only">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const expired =
                  (inv.expiresAt && inv.expiresAt < now) ||
                  (inv.maxUses != null && inv.uses >= inv.maxUses);
                return (
                  <tr key={inv.id} style={expired ? { opacity: 0.55 } : undefined}>
                    <td>
                      {inv.email ?? <span className="faint">{t('Anyone with the link')}</span>}
                    </td>
                    <td>
                      <span className="pill">{t(inv.role)}</span>
                    </td>
                    <td className="small">
                      {inv.uses}
                      {inv.maxUses != null && ` / ${inv.maxUses}`}
                    </td>
                    <td className="small">
                      {inv.expiresAt ? formatDateTime(inv.expiresAt) : t('Never')}
                      {expired && ` · ${t('expired')}`}
                    </td>
                    <td className="small">{displayName(users[inv.createdBy])}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="icon-btn"
                        onClick={() => revoke(inv)}
                        aria-label={t('Revoke invite')}
                        title={t('Revoke invite')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <InviteModal onClose={() => (setCreating(false), load())} />}
    </>
  );
}
