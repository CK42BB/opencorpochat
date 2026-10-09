// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { USERNAME_RE, type UserGroup } from '@ocpc/shared';
import { api } from '../lib/api';
import { displayName, toast, toastError, useStore } from '../lib/store';
import { t, plural } from '../lib/i18n';
import { confirmDialog, EmptyState, Modal } from '../components/ui';
import { UserMultiPicker } from '../components/modals';
import { SectionTitle } from './common';

function GroupModal({ group, onClose }: { group: UserGroup | null; onClose: () => void }) {
  const [form, setForm] = useState({
    handle: group?.handle ?? '',
    name: group?.name ?? '',
    description: group?.description ?? '',
    memberIds: group?.memberIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  const valid = USERNAME_RE.test(form.handle) && form.name.trim();
  const save = async () => {
    setBusy(true);
    try {
      if (group) await api.patch(`/groups/${group.id}`, form);
      else await api.post('/groups', form);
      toast(t('Group saved'), 'success');
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={group ? t('Edit @{handle}', { handle: group.handle }) : t('Create a group')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !valid}>
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="g-handle">{t('Handle')}</label>
        <input
          id="g-handle"
          className="input"
          value={form.handle}
          onChange={(e) => setForm({ ...form, handle: e.target.value.toLowerCase() })}
          placeholder="design"
        />
        <span className="hint">
          {t('People mention the group with @{handle}.', { handle: form.handle || 'handle' })}
        </span>
      </div>
      <div className="field">
        <label htmlFor="g-name">{t('Name')}</label>
        <input
          id="g-name"
          className="input"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder={t('Design team')}
        />
      </div>
      <div className="field">
        <label htmlFor="g-desc">{t('Description')}</label>
        <input
          id="g-desc"
          className="input"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          maxLength={300}
        />
      </div>
      <div className="field">
        <span className="label">{t('Members')}</span>
        <UserMultiPicker
          selected={form.memberIds}
          onChange={(memberIds) => setForm({ ...form, memberIds })}
        />
      </div>
    </Modal>
  );
}

export function Groups() {
  const groups = useStore((s) => s.groups);
  const users = useStore((s) => s.users);
  const [editing, setEditing] = useState<UserGroup | null | 'new'>(null);
  const list = Object.values(groups).sort((a, b) => a.handle.localeCompare(b.handle));
  const remove = async (g: UserGroup) => {
    if (
      !(await confirmDialog({
        title: t('Delete @{handle}?', { handle: g.handle }),
        confirmLabel: t('Delete'),
        danger: true,
      }))
    )
      return;
    try {
      await api.del(`/groups/${g.id}`);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <>
      <SectionTitle title={t('User groups')}>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <Plus size={15} /> {t('Create group')}
        </button>
      </SectionTitle>
      <p className="muted small" style={{ marginTop: 0 }}>
        {t('Groups let people notify a whole team at once, like @oncall or @design.')}
      </p>
      {list.length === 0 ? (
        <EmptyState title={t('No groups yet')} />
      ) : (
        <div className="list-card">
          {list.map((g) => (
            <div key={g.id} className="list-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div>
                  <strong>@{g.handle}</strong> <span className="muted">{g.name}</span>
                </div>
                <div className="faint small ellipsis">
                  {plural(g.memberIds.length, '{n} member', '{n} members')}
                  {g.memberIds.length > 0 &&
                    `: ${g.memberIds
                      .slice(0, 6)
                      .map((id) => displayName(users[id]))
                      .join(', ')}${g.memberIds.length > 6 ? '…' : ''}`}
                </div>
              </div>
              <button
                className="icon-btn"
                onClick={() => setEditing(g)}
                aria-label={t('Edit @{handle}', { handle: g.handle })}
              >
                <Pencil size={16} />
              </button>
              <button
                className="icon-btn"
                onClick={() => remove(g)}
                aria-label={t('Delete @{handle}', { handle: g.handle })}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <GroupModal group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
