// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { Hash, Lock, UserPlus } from 'lucide-react';
import type { MyChannel } from '@ocpc/shared';
import { channelTitle, displayName, isDm, useStore } from '../lib/store';
import { formatDay } from '../lib/format';
import { t } from '../lib/i18n';
import { Avatar } from './ui';
import { AddMembersModal } from './modals';

export function ChannelIntro({ channel }: { channel: MyChannel }) {
  const me = useStore((s) => s.me);
  const users = useStore((s) => s.users);
  const [adding, setAdding] = useState(false);
  if (isDm(channel)) {
    const others = (channel.dmUserIds ?? []).filter((id) => id !== me?.id);
    const first = users[others[0] ?? me?.id ?? ''];
    return (
      <div className="messages-empty">
        <div className="row" style={{ marginBottom: 8 }}>
          {(others.length ? others : [me!.id]).slice(0, 4).map((id) => (
            <Avatar key={id} user={users[id]} size={56} presence />
          ))}
        </div>
        <h3>{channelTitle(channel, me?.id)}</h3>
        <p className="muted">
          {others.length === 0
            ? t('This is your space. Draft messages, keep notes, or save links for later.')
            : others.length === 1
              ? t('This is the very beginning of your direct message history with {name}.', { name: displayName(first) })
              : t('This is the very beginning of your group conversation.')}
        </p>
      </div>
    );
  }
  const creator = channel.createdBy ? users[channel.createdBy] : undefined;
  return (
    <div className="messages-empty">
      <h3 className="row">
        {channel.kind === 'private' ? <Lock size={22} /> : <Hash size={22} />}
        {channel.name}
      </h3>
      <p className="muted">
        {creator
          ? t('{name} created this channel on {date}.', { name: displayName(creator), date: formatDay(channel.createdAt) })
          : t('This channel was created on {date}.', { date: formatDay(channel.createdAt) })}{' '}
        {channel.description || t('This is the very beginning of #{name}.', { name: channel.name })}
      </p>
      {!channel.archived && me?.role !== 'guest' && (
        <button className="btn btn-sm" onClick={() => setAdding(true)}>
          <UserPlus size={14} /> {t('Add people')}
        </button>
      )}
      {adding && <AddMembersModal channel={channel} onClose={() => setAdding(false)} />}
    </div>
  );
}
