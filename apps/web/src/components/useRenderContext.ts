// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from 'react';
import { useStore } from '../lib/store';
import type { RenderContext } from '../lib/markdown';

export function useRenderContext(): RenderContext {
  const users = useStore((s) => s.users);
  const groups = useStore((s) => s.groups);
  const channels = useStore((s) => s.channels);
  const emoji = useStore((s) => s.emoji);
  const me = useStore((s) => s.me);
  return useMemo(
    () => ({
      usersByName: new Map(Object.values(users).map((u) => [u.username, u])),
      groupsByHandle: new Map(Object.values(groups).map((g) => [g.handle, g])),
      channelsByName: new Map(Object.values(channels).filter((c) => c.kind === 'public' || c.kind === 'private').map((c) => [c.name, c.id])),
      emoji: new Map(emoji.map((e) => [e.name, e])),
      meUsername: me?.username ?? '',
    }),
    [users, groups, channels, emoji, me?.username],
  );
}
