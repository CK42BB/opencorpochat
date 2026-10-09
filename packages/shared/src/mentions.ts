// SPDX-License-Identifier: AGPL-3.0-only
// Mention / reference extraction from raw message text.

export interface ParsedMentions {
  usernames: string[];
  channel: boolean; // @channel or @everyone
  here: boolean; // @here
  channelNames: string[];
}

const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g;
const USER_RE = /(^|[^\w@/])@([a-z0-9][a-z0-9._-]{0,31})(?![\w-])/gi;
const CHANNEL_RE = /(^|[^\w#&/])#([a-z0-9][a-z0-9_-]{0,79})(?![\w-])/gi;

/** Strip code spans/blocks so mentions inside code are ignored. */
export function stripCode(text: string) {
  return text.replace(CODE_RE, ' ');
}

export function parseMentions(text: string): ParsedMentions {
  const clean = stripCode(text);
  const usernames = new Set<string>();
  let channel = false;
  let here = false;
  for (const m of clean.matchAll(USER_RE)) {
    let name = m[2]!.toLowerCase();
    // Trailing punctuation like "@alice." is not part of the name.
    name = name.replace(/[._-]+$/, '');
    if (name === 'channel' || name === 'everyone') channel = true;
    else if (name === 'here') here = true;
    else if (name) usernames.add(name);
  }
  const channelNames = new Set<string>();
  for (const m of clean.matchAll(CHANNEL_RE))
    channelNames.add(m[2]!.toLowerCase().replace(/[_-]+$/, ''));
  return { usernames: [...usernames], channel, here, channelNames: [...channelNames] };
}

/** Case-insensitive whole-word keyword match. */
export function matchesKeyword(text: string, keywords: string[]) {
  const clean = stripCode(text).toLowerCase();
  return keywords.some((k) => {
    const kw = k.trim().toLowerCase();
    if (!kw) return false;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\W)${escaped}(\\W|$)`).test(clean);
  });
}

const URL_RE = /\bhttps?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/gi;
export function extractUrls(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const m of stripCode(text).matchAll(URL_RE)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= max) break;
  }
  return out;
}
