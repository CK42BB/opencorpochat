// SPDX-License-Identifier: AGPL-3.0-only
// STUB — implemented by the calls work package.
export function startCall(channelId: string) {
  window.dispatchEvent(new CustomEvent('ocpc:start-call', { detail: channelId }));
}
