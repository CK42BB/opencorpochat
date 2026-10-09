// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { EMOJI_NAME_RE, type CustomEmoji } from '@ocpc/shared';
import { api, uploadFile } from '../lib/api';
import { displayName, toast, toastError, useStore } from '../lib/store';
import { t } from '../lib/i18n';
import { confirmDialog, EmptyState } from '../components/ui';
import { SectionTitle } from './common';

export function Emoji() {
  const emoji = useStore((s) => s.emoji);
  const users = useStore((s) => s.users);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const valid = EMOJI_NAME_RE.test(name) && !!file;

  const choose = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast(t('Choose an image file'), 'error');
    if (f.size > 256 * 1024) return toast(t('Emoji images must be under 256 KB'), 'error');
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_+-]/g, '_').slice(0, 64));
  };

  const add = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const info = await uploadFile(file).promise;
      const list = await api.post<CustomEmoji[]>('/emoji', { name, fileId: info.id });
      useStore.setState({ emoji: list });
      toast(t(':{name}: added', { name }), 'success');
      setName('');
      setFile(null);
      setPreview(null);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: CustomEmoji) => {
    if (!(await confirmDialog({ title: t('Remove :{name}:?', { name: e.name }), body: t('Messages that used it will show the text :{name}: instead.', { name: e.name }), confirmLabel: t('Remove'), danger: true }))) return;
    try {
      await api.del(`/emoji/${encodeURIComponent(e.name)}`);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <SectionTitle title={t('Custom emoji')} />
      <div className="card">
        <h3>{t('Add emoji')}</h3>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <button className="btn" onClick={() => input.current?.click()}>
            {preview ? <img src={preview} alt="" width={24} height={24} style={{ objectFit: 'contain' }} /> : <Upload size={15} />} {file ? t('Change image') : t('Choose image')}
          </button>
          <input ref={input} type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden onChange={(e) => (choose(e.target.files?.[0]), (e.target.value = ''))} />
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
            <label htmlFor="emoji-name">{t('Name')}</label>
            <input id="emoji-name" className="input" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="party_parrot" />
          </div>
          <button className="btn btn-primary" onClick={add} disabled={!valid || busy}>
            {t('Add')}
          </button>
        </div>
        <p className="hint small faint" style={{ marginBottom: 0 }}>
          {t('Square PNG, GIF or WebP under 256 KB. Names use lowercase letters, numbers, _ + and -. Only upload images you have the rights to use.')}
        </p>
      </div>
      {emoji.length === 0 ? (
        <EmptyState title={t('No custom emoji yet')} />
      ) : (
        <div className="admin-emoji-grid">
          {emoji.map((e) => (
            <div key={e.name} className="admin-emoji">
              <img src={e.url} alt={`:${e.name}:`} loading="lazy" />
              <code className="small">:{e.name}:</code>
              <span className="faint small ellipsis" style={{ maxWidth: '100%' }}>
                {displayName(users[e.createdBy])}
              </span>
              <button className="icon-btn icon-btn-sm del" onClick={() => remove(e)} aria-label={t('Remove :{name}:', { name: e.name })}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
