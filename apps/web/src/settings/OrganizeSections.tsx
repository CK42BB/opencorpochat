// SPDX-License-Identifier: AGPL-3.0-only
// Custom sidebar sections, scheduled messages and reminders.
import { useEffect, useState } from 'react';
import { AlarmClock, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Reminder, ScheduledMessage } from '@ocpc/shared';
import { api } from '../lib/api';
import { channelTitle, isDm, toastError, useStore } from '../lib/store';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { confirmDialog, EmptyState, Modal, Spinner } from '../components/ui';
import { ReminderModal } from '../components/modals';
import { savePrefs } from './common';

type Section = { id: string; name: string; channelIds: string[] };

function SectionEditor({ section, onSave, onClose }: { section: Section | null; onSave: (s: Section) => void; onClose: () => void }) {
  const channels = useStore((s) => s.channels);
  const meId = useStore((s) => s.me?.id);
  const [name, setName] = useState(section?.name ?? '');
  const [ids, setIds] = useState<string[]>(section?.channelIds ?? []);
  const [q, setQ] = useState('');
  const list = Object.values(channels)
    .map((c) => ({ c, title: channelTitle(c, meId) }))
    .filter((x) => x.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(isDm(a.c)) - Number(isDm(b.c)) || a.title.localeCompare(b.title));
  return (
    <Modal
      title={section ? t('Edit section') : t('New section')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave({ id: section?.id ?? Math.random().toString(36).slice(2, 10), name: name.trim(), channelIds: ids })}>
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="sec-name">{t('Section name')}</label>
        <input id="sec-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('e.g. Projects')} />
      </div>
      <div className="field">
        <label htmlFor="sec-q">{t('Conversations in this section')}</label>
        <input id="sec-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Filter')} />
        <div style={{ maxHeight: 280, overflowY: 'auto', marginTop: 6 }}>
          {list.map(({ c, title }) => (
            <label key={c.id} className="checkbox" style={{ marginBottom: 4 }}>
              <input type="checkbox" checked={ids.includes(c.id)} onChange={(e) => setIds(e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id))} />
              {isDm(c) ? title : `#${title}`}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function SidebarSectionsSection() {
  const sections = useStore((s) => s.me!.preferences.sidebarSections);
  const channels = useStore((s) => s.channels);
  const meId = useStore((s) => s.me?.id);
  const [editing, setEditing] = useState<Section | 'new' | null>(null);
  const save = (s: Section) => {
    // A conversation lives in at most one custom section.
    const others = sections.filter((x) => x.id !== s.id).map((x) => ({ ...x, channelIds: x.channelIds.filter((id) => !s.channelIds.includes(id)) }));
    const exists = sections.some((x) => x.id === s.id);
    savePrefs({ sidebarSections: exists ? sections.map((x) => (x.id === s.id ? s : others.find((o) => o.id === x.id)!)) : [...others, s] });
    setEditing(null);
  };
  const remove = async (s: Section) => {
    if (!(await confirmDialog({ title: t('Delete section “{name}”?', { name: s.name }), body: t('Its conversations move back to Channels and Direct messages.'), confirmLabel: t('Delete'), danger: true }))) return;
    savePrefs({ sidebarSections: sections.filter((x) => x.id !== s.id) });
  };
  const move = (i: number, dir: -1 | 1) => {
    const next = [...sections];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    savePrefs({ sidebarSections: next });
  };
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          {t('Sidebar sections')}
        </h3>
        <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')} disabled={sections.length >= 30}>
          <Plus size={14} /> {t('New section')}
        </button>
      </div>
      <p className="muted small">{t('Group channels and conversations into your own sections. Only you see them.')}</p>
      {sections.length === 0 ? (
        <EmptyState title={t('No custom sections')} />
      ) : (
        <div className="list-card" style={{ margin: 0 }}>
          {sections.map((s, i) => (
            <div key={s.id} className="list-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{s.name}</div>
                <div className="faint small ellipsis">
                  {s.channelIds
                    .map((id) => channels[id])
                    .filter(Boolean)
                    .map((c) => (isDm(c!) ? channelTitle(c!, meId) : `#${c!.name}`))
                    .join(', ') || t('Empty')}
                </div>
              </div>
              <button className="icon-btn icon-btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('Move up')}>
                ↑
              </button>
              <button className="icon-btn icon-btn-sm" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label={t('Move down')}>
                ↓
              </button>
              <button className="icon-btn icon-btn-sm" onClick={() => setEditing(s)} aria-label={t('Edit {name}', { name: s.name })}>
                <Pencil size={14} />
              </button>
              <button className="icon-btn icon-btn-sm" onClick={() => remove(s)} aria-label={t('Delete {name}', { name: s.name })}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && <SectionEditor section={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function ScheduledSection() {
  const [scheduled, setScheduled] = useState<ScheduledMessage[] | null>(null);
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [creating, setCreating] = useState(false);
  const channels = useStore((s) => s.channels);
  const meId = useStore((s) => s.me?.id);
  const load = () => {
    api.get<ScheduledMessage[]>('/scheduled').then(setScheduled).catch(toastError);
    api.get<Reminder[]>('/reminders').then(setReminders).catch(toastError);
  };
  useEffect(load, []);
  const where = (id: string) => {
    const c = channels[id];
    return c ? (isDm(c) ? channelTitle(c, meId) : `#${c.name}`) : t('Unknown conversation');
  };
  const del = async (path: string) => {
    try {
      await api.del(path);
      load();
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <>
      <div className="card">
        <h3>
          <Clock size={16} style={{ verticalAlign: -3 }} /> {t('Scheduled messages')}
        </h3>
        {!scheduled ? (
          <Spinner />
        ) : scheduled.length === 0 ? (
          <p className="muted small">{t('Nothing scheduled. Use the + menu in the message box to schedule a message.')}</p>
        ) : (
          <div className="list-card" style={{ margin: 0 }}>
            {scheduled.map((s) => (
              <div key={s.id} className="list-item">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="faint small">
                    {where(s.channelId)} · {formatDateTime(s.sendAt)}
                  </div>
                  <div className="ellipsis">{s.body}</div>
                </div>
                <button className="btn btn-sm" onClick={() => del(`/scheduled/${s.id}`)}>
                  {t('Cancel')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 className="grow" style={{ margin: 0 }}>
            <AlarmClock size={16} style={{ verticalAlign: -3 }} /> {t('Reminders')}
          </h3>
          <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> {t('New reminder')}
          </button>
        </div>
        {!reminders ? (
          <Spinner />
        ) : reminders.length === 0 ? (
          <p className="muted small">{t('No reminders. Set one from a message menu, with /remind, or here.')}</p>
        ) : (
          <div className="list-card" style={{ margin: 0 }}>
            {reminders.map((r) => (
              <div key={r.id} className="list-item">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="faint small">{formatDateTime(r.remindAt)}</div>
                  <div className="ellipsis">{r.text || (r.messageId ? t('About a message') : t('Reminder'))}</div>
                </div>
                <button className="icon-btn icon-btn-sm" onClick={() => del(`/reminders/${r.id}`)} aria-label={t('Delete reminder')}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {creating && <ReminderModal onClose={() => (setCreating(false), load())} />}
    </>
  );
}
