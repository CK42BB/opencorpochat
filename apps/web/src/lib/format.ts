// SPDX-License-Identifier: AGPL-3.0-only
import { t } from './i18n';

const locale = typeof navigator !== 'undefined' ? navigator.language : 'en';

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

export function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('Today');
  if (d.toDateString() === yesterday.toDateString()) return t('Yesterday');
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function formatRelative(iso: string) {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 45) return t('just now');
  if (diff < 3600) return t('{n}m ago', { n: Math.round(diff / 60) });
  if (diff < 86400) return t('{n}h ago', { n: Math.round(diff / 3600) });
  if (diff < 7 * 86400) return t('{n}d ago', { n: Math.round(diff / 86400) });
  return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function localTimeIn(tz: string) {
  try {
    return new Date().toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    });
  } catch {
    return '';
  }
}

export const sameDay = (a: string, b: string) =>
  new Date(a).toDateString() === new Date(b).toDateString();
