// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, KeyRound, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, Trash2, UserCheck, UserX } from 'lucide-react';
import type { Presence, Role, User } from '@ocpc/shared';
import { api } from '../lib/api';
import { displayName, toast, toastError, useStore } from '../lib/store';
import { formatRelative } from '../lib/format';
import { t } from '../lib/i18n';
import { Avatar, confirmDialog, copyText, Menu, Modal, Popover, Spinner } from '../components/ui';
import { SectionTitle } from './common';

export type AdminUser = User & { email: string; totpEnabled: boolean; lastSeenAt: string | null; hasPassword: boolean; presence: Presence };

const ROLE_LABEL = (r: Role) => ({ owner: t('Owner'), admin: t('Admin'), member: t('Member'), guest: t('Guest'), bot: t('Bot') })[r];

function EditUserModal({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ displayName: user.displayName, username: user.username, email: user.email });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const patch: Record<string, string> = {};
      if (form.displayName !== user.displayName) patch.displayName = form.displayName;
      if (form.username !== user.username) patch.username = form.username;
      if (form.email !== user.email) patch.email = form.email;
      if (Object.keys(patch).length) await api.patch(`/admin/users/${user.id}`, patch);
      toast(t('Saved'), 'success');
      onSaved();
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Edit {name}', { name: displayName(user) })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !form.displayName || !form.username || !form.email}>
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="eu-dn">{t('Display name')}</label>
        <input id="eu-dn" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="eu-un">{t('Username')}</label>
        <input id="eu-un" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </div>
      {user.role !== 'bot' && (
        <div className="field">
          <label htmlFor="eu-em">{t('Email')}</label>
          <input id="eu-em" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      )}
    </Modal>
  );
}

function EraseModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const erase = async () => {
    setBusy(true);
    try {
      await api.del(`/admin/users/${user.id}`);
      toast(t('Account erased'), 'success');
      onDone();
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Erase {name}?', { name: displayName(user) })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-danger" onClick={erase} disabled={busy || typed !== user.username}>
            {t('Erase permanently')}
          </button>
        </>
      }
    >
      <p>{t('This permanently deletes their messages, files, reactions and profile. It cannot be undone. Consider exporting their data first, or just deactivating the account.')}</p>
      <div className="field">
        <label htmlFor="erase-confirm">{t('Type {username} to confirm', { username: user.username })}</label>
        <input id="erase-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </div>
    </Modal>
  );
}

function ResetLinkModal({ link, emailed, onClose }: { link: string; emailed: boolean; onClose: () => void }) {
  return (
    <Modal title={t('Password reset link')} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
      <p>{emailed ? t('We emailed this link to the person. You can also share it directly:') : t('Share this one-time link with the person. It expires in 24 hours.')}</p>
      <div className="secret-box">
        <span className="grow">{link}</span>
        <button className="btn btn-sm" onClick={() => copyText(link).then(() => toast(t('Link copied')))}>
          {t('Copy')}
        </button>
      </div>
    </Modal>
  );
}

export function Users() {
  const me = useStore((s) => s.me)!;
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'all' | Role>('all');
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [menu, setMenu] = useState<{ user: AdminUser; el: HTMLElement } | null>(null);
  const [modal, setModal] = useState<{ kind: 'edit' | 'erase'; user: AdminUser } | { kind: 'reset'; link: string; emailed: boolean } | null>(null);
  const load = useCallback(() => api.get<AdminUser[]>('/admin/users').then(setUsers).catch(toastError), []);
  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(
    () =>
      (users ?? [])
        .filter((u) => showDeactivated || !u.deactivated)
        .filter((u) => role === 'all' || u.role === role)
        .filter((u) => `${u.displayName} ${u.username} ${u.email} ${u.fullName}`.toLowerCase().includes(q.toLowerCase())),
    [users, q, role, showDeactivated],
  );

  const patch = async (u: AdminUser, body: Record<string, unknown>, done: string) => {
    try {
      await api.patch(`/admin/users/${u.id}`, body);
      toast(done, 'success');
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const setUserRole = async (u: AdminUser, r: Role) => {
    if (r === 'owner' && !(await confirmDialog({ title: t('Make {name} an owner?', { name: displayName(u) }), body: t('Owners have full control, including over other owners.'), confirmLabel: t('Make owner') }))) return;
    patch(u, { role: r }, t('Role updated'));
  };

  const actionsFor = (u: AdminUser) => {
    const isSelf = u.id === me.id;
    const ownerOnly = u.role === 'owner' && me.role !== 'owner';
    const roles: Role[] = (['owner', 'admin', 'member', 'guest'] as Role[]).filter((r) => r !== u.role && (r !== 'owner' || me.role === 'owner'));
    return [
      ...(u.role === 'bot' || isSelf || ownerOnly
        ? []
        : roles.map((r) => ({ label: t('Change role to {role}', { role: ROLE_LABEL(r) }), icon: <ShieldCheck size={15} />, onClick: () => setUserRole(u, r) }))),
      'sep' as const,
      { label: t('Edit name, username or email'), icon: <Pencil size={15} />, onClick: () => setModal({ kind: 'edit', user: u }), hidden: ownerOnly },
      {
        label: t('Create password reset link'),
        icon: <KeyRound size={15} />,
        hidden: u.role === 'bot' || ownerOnly,
        onClick: async () => {
          try {
            const r = await api.post<{ link: string; emailed: boolean }>(`/admin/users/${u.id}/password-reset`);
            setModal({ kind: 'reset', ...r });
          } catch (err) {
            toastError(err);
          }
        },
      },
      {
        label: t('Reset two-factor authentication'),
        icon: <ShieldOff size={15} />,
        hidden: !u.totpEnabled || ownerOnly,
        onClick: async () => {
          if (!(await confirmDialog({ title: t('Remove two-factor authentication for {name}?', { name: displayName(u) }), body: t('Use this when someone has lost their device. They can set it up again afterwards.'), confirmLabel: t('Reset 2FA'), danger: true }))) return;
          try {
            await api.post(`/admin/users/${u.id}/reset-2fa`);
            toast(t('Two-factor authentication removed'), 'success');
            load();
          } catch (err) {
            toastError(err);
          }
        },
      },
      {
        label: t('Export their data'),
        icon: <Download size={15} />,
        onClick: () => {
          const a = document.createElement('a');
          a.href = `/api/v1/admin/users/${u.id}/export`;
          a.download = `user-${u.username}-export.ndjson`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        },
      },
      'sep' as const,
      u.deactivated
        ? { label: t('Reactivate account'), icon: <UserCheck size={15} />, onClick: () => patch(u, { deactivated: false }, t('Account reactivated')), hidden: ownerOnly }
        : {
            label: t('Deactivate account'),
            icon: <UserX size={15} />,
            danger: true,
            hidden: isSelf || ownerOnly,
            onClick: async () => {
              if (await confirmDialog({ title: t('Deactivate {name}?', { name: displayName(u) }), body: t('They will be signed out everywhere and cannot sign in. Their messages stay. You can reactivate them later.'), confirmLabel: t('Deactivate'), danger: true }))
                patch(u, { deactivated: true }, t('Account deactivated'));
            },
          },
      { label: t('Erase account…'), icon: <Trash2 size={15} />, danger: true, hidden: isSelf || u.role === 'owner', onClick: () => setModal({ kind: 'erase', user: u }) },
    ];
  };

  return (
    <>
      <SectionTitle title={t('People')}>
        <span className="faint small">{users ? t('{n} accounts', { n: users.length }) : ''}</span>
      </SectionTitle>
      <div className="admin-filters">
        <input className="input" placeholder={t('Search by name, username or email')} aria-label={t('Search people')} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label={t('Filter by role')}>
          <option value="all">{t('All roles')}</option>
          {(['owner', 'admin', 'member', 'guest', 'bot'] as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL(r)}
            </option>
          ))}
        </select>
        <label className="row small">
          <input type="checkbox" checked={showDeactivated} onChange={(e) => setShowDeactivated(e.target.checked)} /> {t('Show deactivated')}
        </label>
      </div>
      {!users ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Email')}</th>
                <th>{t('Role')}</th>
                <th>{t('2FA')}</th>
                <th>{t('Last seen')}</th>
                <th>
                  <span className="sr-only">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} style={u.deactivated ? { opacity: 0.6 } : undefined}>
                  <td>
                    <div className="row">
                      <Avatar user={u} size={28} presence />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>
                          {displayName(u)} {u.id === me.id && <span className="faint small">({t('you')})</span>}
                        </div>
                        <div className="faint small">@{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="small">{u.role === 'bot' ? <span className="faint">—</span> : u.email}</td>
                  <td>
                    <span className={`pill ${u.role === 'owner' || u.role === 'admin' ? 'pill-brand' : ''}`}>{ROLE_LABEL(u.role)}</span>
                    {u.deactivated && (
                      <span className="pill" style={{ marginLeft: 4 }}>
                        {t('Deactivated')}
                      </span>
                    )}
                  </td>
                  <td className="small">{u.role === 'bot' ? '—' : u.totpEnabled ? t('On') : <span className="faint">{t('Off')}</span>}</td>
                  <td className="small faint">{u.presence !== 'offline' ? t('Online now') : u.lastSeenAt ? formatRelative(u.lastSeenAt) : t('Never')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="icon-btn" aria-label={t('Actions for {name}', { name: displayName(u) })} aria-haspopup="menu" onClick={(e) => setMenu({ user: u, el: e.currentTarget })}>
                      <MoreHorizontal size={17} />
                    </button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={6} className="faint" style={{ textAlign: 'center' }}>
                    {t('Nobody matches these filters.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} placement="bottom-end">
          <Menu title={`@${menu.user.username}`} items={actionsFor(menu.user)} onClose={() => setMenu(null)} />
        </Popover>
      )}
      {modal?.kind === 'edit' && <EditUserModal user={modal.user} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.kind === 'erase' && <EraseModal user={modal.user} onClose={() => setModal(null)} onDone={load} />}
      {modal?.kind === 'reset' && <ResetLinkModal link={modal.link} emailed={modal.emailed} onClose={() => setModal(null)} />}
    </>
  );
}
