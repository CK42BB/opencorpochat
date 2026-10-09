// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ftsQuery, pgTsQuery } from './routes.js';

describe('search query builders', () => {
  it('FTS5: quotes terms and prefixes the last one', () => {
    expect(ftsQuery('budget rev')).toBe('"budget" "rev"*');
    expect(ftsQuery('"exact phrase" x')).toBe('"exact phrase" "x"*');
    expect(ftsQuery('a"b OR c')).toBe('"a" "b" "OR" "c"*');
  });
  it('Postgres: strips operators and prefixes the last term', () => {
    expect(pgTsQuery('budget rev')).toBe('budget & rev:*');
    expect(pgTsQuery('"q1 plan" & | !x')).toBe('(q1 <-> plan) & x:*');
    expect(pgTsQuery("it's")).toBe('it & s:*');
  });
});
