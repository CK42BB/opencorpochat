// SPDX-License-Identifier: AGPL-3.0-only
// Minimal gettext-style i18n: the English text is the key. Add a locale by creating
// src/locales/<lang>.json mapping English strings to translations.
// Placeholders use {name} syntax: t('Hello {name}', { name }).

type Dict = Record<string, string>;
const locales = import.meta.glob<{ default: Dict }>('../locales/*.json', { eager: true });

function pickLocale(): Dict {
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const lang of langs) {
    for (const candidate of [lang, lang.split('-')[0]]) {
      const hit = locales[`../locales/${candidate}.json`];
      if (hit) return hit.default;
    }
  }
  return {};
}

const dict = pickLocale();

export function t(text: string, vars?: Record<string, string | number>): string {
  const s = dict[text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s;
}

export function plural(n: number, one: string, many: string, vars: Record<string, string | number> = {}) {
  return t(n === 1 ? one : many, { n, ...vars });
}
