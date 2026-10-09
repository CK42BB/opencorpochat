// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { t } from '../lib/i18n';

export interface ServerInfoFlags {
  smtp: boolean;
  oidc: boolean;
  s3: boolean;
  turn: boolean;
  livekit: boolean;
  database: string;
  maxUploadCapMb: number;
  publicUrl: string;
}

export function SectionTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
      <h3 style={{ margin: 0, fontSize: 18, flex: 1 }}>{title}</h3>
      {children}
    </div>
  );
}

/** Editable list of short strings shown as removable chips. */
export function ChipInput({
  value,
  onChange,
  placeholder,
  label,
  normalize = (s) => s.trim(),
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  label: string;
  normalize?: (s: string) => string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = normalize(draft);
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft('');
  };
  return (
    <div>
      {value.length > 0 && (
        <div className="admin-chips">
          {value.map((v) => (
            <span key={v} className="admin-chip">
              {v}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== v))}
                aria-label={t('Remove {name}', { name: v })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row">
        <input
          className="input"
          value={draft}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn" onClick={add} disabled={!draft.trim()}>
          {t('Add')}
        </button>
      </div>
    </div>
  );
}
