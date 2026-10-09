// SPDX-License-Identifier: AGPL-3.0-only

export const nowIso = () => new Date().toISOString();
export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
