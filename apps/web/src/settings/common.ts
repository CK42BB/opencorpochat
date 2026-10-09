// SPDX-License-Identifier: AGPL-3.0-only
import type { Me, UserPreferences } from '@ocpc/shared';
import { api } from '../lib/api';
import { toastError, useStore } from '../lib/store';

/** PATCH preferences and update the signed-in user. */
export async function savePrefs(patch: Partial<UserPreferences>) {
  const me = useStore.getState().me;
  // Optimistic: apply immediately so theme/density changes are instant.
  if (me) useStore.setState({ me: { ...me, preferences: { ...me.preferences, ...patch } } });
  try {
    const updated = await api.patch<Me>('/me/preferences', patch);
    useStore.setState({ me: updated });
  } catch (err) {
    if (me) useStore.setState({ me });
    toastError(err);
  }
}

/** Very small user-agent summary: "Firefox on macOS". */
export function describeUserAgent(ua: string) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|python/i.test(ua) ? 'Script' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}
