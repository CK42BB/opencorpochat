// SPDX-License-Identifier: AGPL-3.0-only
// Search query syntax: free text plus filters
//   in:#channel  from:@user  before:YYYY-MM-DD  after:YYYY-MM-DD  on:YYYY-MM-DD
//   has:file  has:link  has:reaction  is:thread  is:pinned  is:saved

export interface SearchQuery {
  text: string;
  inChannels: string[];
  fromUsers: string[];
  before: string | null;
  after: string | null;
  has: Array<'file' | 'link' | 'reaction'>;
  is: Array<'thread' | 'pinned' | 'saved'>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseSearchQuery(raw: string): SearchQuery {
  const q: SearchQuery = { text: '', inChannels: [], fromUsers: [], before: null, after: null, has: [], is: [] };
  const words: string[] = [];
  // Respect "quoted phrases".
  const tokens = raw.match(/"[^"]*"|\S+/g) ?? [];
  for (const tok of tokens) {
    const m = /^(in|from|before|after|on|has|is):(.+)$/i.exec(tok);
    if (!m) {
      words.push(tok);
      continue;
    }
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    switch (key) {
      case 'in':
        q.inChannels.push(val.replace(/^#/, '').toLowerCase());
        break;
      case 'from':
        q.fromUsers.push(val.replace(/^@/, '').toLowerCase());
        break;
      case 'before':
        if (DATE_RE.test(val)) q.before = val;
        else words.push(tok);
        break;
      case 'after':
        if (DATE_RE.test(val)) q.after = val;
        else words.push(tok);
        break;
      case 'on':
        if (DATE_RE.test(val)) {
          q.after = val;
          const d = new Date(val + 'T00:00:00Z');
          d.setUTCDate(d.getUTCDate() + 1);
          q.before = d.toISOString().slice(0, 10);
        } else words.push(tok);
        break;
      case 'has':
        if (val === 'file' || val === 'link' || val === 'reaction') q.has.push(val);
        else words.push(tok);
        break;
      case 'is':
        if (val === 'thread' || val === 'pinned' || val === 'saved') q.is.push(val);
        else words.push(tok);
        break;
    }
  }
  q.text = words.join(' ').trim();
  return q;
}
