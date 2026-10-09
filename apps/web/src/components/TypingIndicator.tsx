// SPDX-License-Identifier: AGPL-3.0-only
import { displayName, useStore } from '../lib/store';
import { t } from '../lib/i18n';

export function TypingIndicator({
  channelId,
  threadRootId = null,
}: {
  channelId: string;
  threadRootId?: string | null;
}) {
  const typing = useStore((s) => s.typing[`${channelId}:${threadRootId ?? ''}`]);
  const users = useStore((s) => s.users);
  const ids = Object.entries(typing ?? {})
    .filter(([, exp]) => exp > Date.now())
    .map(([id]) => id);
  let text = '';
  if (ids.length === 1) text = t('{name} is typing…', { name: displayName(users[ids[0]!]) });
  else if (ids.length === 2)
    text = t('{a} and {b} are typing…', {
      a: displayName(users[ids[0]!]),
      b: displayName(users[ids[1]!]),
    });
  else if (ids.length > 2) text = t('Several people are typing…');
  return (
    <div className="typing" aria-live="polite">
      {text}
    </div>
  );
}
