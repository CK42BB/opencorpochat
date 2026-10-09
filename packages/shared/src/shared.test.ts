// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseMentions, matchesKeyword, extractUrls } from './mentions.js';
import { parseSearchQuery } from './search.js';
import { replaceShortcodes } from './emoji.js';
import { canEditMessage, canPostInChannel, canViewChannel, canChangeRole } from './permissions.js';
import type { Membership } from './entities.js';

const member: Membership = {
  channelId: 'c',
  userId: 'u',
  role: 'member',
  notifyLevel: 'all',
  muted: false,
  starred: false,
  lastReadMessageId: null,
  joinedAt: '',
};

describe('parseMentions', () => {
  it('finds users, channel-wide and channel refs, ignoring code', () => {
    const r = parseMentions('hey @Alice and @bob. see #general, @here `@nobody` ```@ignored```');
    expect(r.usernames.sort()).toEqual(['alice', 'bob']);
    expect(r.here).toBe(true);
    expect(r.channel).toBe(false);
    expect(r.channelNames).toEqual(['general']);
  });
  it('does not treat emails as mentions', () => {
    expect(parseMentions('mail me at a@b.com').usernames).toEqual([]);
  });
  it('detects @everyone/@channel', () => {
    expect(parseMentions('@everyone hi').channel).toBe(true);
  });
});

describe('keywords and urls', () => {
  it('matches whole words', () => {
    expect(matchesKeyword('Deploy is broken', ['deploy'])).toBe(true);
    expect(matchesKeyword('redeployment', ['deploy'])).toBe(false);
  });
  it('extracts urls without trailing punctuation', () => {
    expect(extractUrls('see https://example.com/a. and http://x.org')).toEqual([
      'https://example.com/a',
      'http://x.org',
    ]);
  });
});

describe('parseSearchQuery', () => {
  it('parses filters', () => {
    const q = parseSearchQuery('budget in:#finance from:@ann has:file on:2026-01-31 "q1 plan"');
    expect(q.text).toBe('budget "q1 plan"');
    expect(q.inChannels).toEqual(['finance']);
    expect(q.fromUsers).toEqual(['ann']);
    expect(q.has).toEqual(['file']);
    expect(q.after).toBe('2026-01-31');
    expect(q.before).toBe('2026-02-01');
  });
});

describe('emoji', () => {
  it('replaces known shortcodes only', () => {
    expect(replaceShortcodes('ok :+1: :custom-thing:')).toBe('ok 👍 :custom-thing:');
  });
});

describe('permissions', () => {
  const alice = { id: 'u', role: 'member' as const };
  const guest = { id: 'g', role: 'guest' as const };
  it('guests cannot see public channels they are not in', () => {
    expect(canViewChannel(guest, { kind: 'public' }, null)).toBe(false);
    expect(canViewChannel(alice, { kind: 'public' }, null)).toBe(true);
    expect(canViewChannel(alice, { kind: 'private' }, null)).toBe(false);
  });
  it('readonly channels restrict posting', () => {
    const ch = { kind: 'public' as const, archived: false, isReadonly: true };
    expect(canPostInChannel(alice, ch, member)).toBe(false);
    expect(canPostInChannel({ id: 'a', role: 'admin' }, ch, member)).toBe(true);
  });
  it('edit window', () => {
    const msg = { userId: 'u', createdAt: new Date(0).toISOString() };
    expect(canEditMessage(alice, msg, null)).toBe(true);
    expect(canEditMessage(alice, msg, 5, 10 * 60_000)).toBe(false);
  });
  it('only owners grant ownership', () => {
    expect(canChangeRole({ id: 'a', role: 'admin' }, { id: 'b', role: 'member' }, 'owner')).toBe(
      false,
    );
    expect(canChangeRole({ id: 'a', role: 'owner' }, { id: 'b', role: 'member' }, 'owner')).toBe(
      true,
    );
  });
});
