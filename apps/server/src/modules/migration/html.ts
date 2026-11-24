// SPDX-License-Identifier: AGPL-3.0-only
// Small, dependency-free HTML-to-Markdown converter for message bodies (Microsoft Graph
// returns chat messages as HTML). It understands the handful of tags chat messages use
// and drops everything else, keeping the text.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
};

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attrs(s: string) {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    out[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'source', 'wbr']);
const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'table',
  'tr',
  'ul',
  'ol',
]);

export interface HtmlOptions {
  /** <at id="N">Name</at> → replacement text (e.g. <@userId>), or undefined to keep @Name. */
  mention?: (id: string, text: string) => string | undefined;
  /** <img src> → replacement text ('' to drop it, e.g. when imported as an attachment). */
  image?: (src: string, alt: string) => string;
}

interface Frame {
  tag: string;
  a: Record<string, string>;
  buf: string;
  index: number;
}

export function htmlToMarkdown(html: string, opts: HtmlOptions = {}): string {
  const root: Frame = { tag: '#root', a: {}, buf: '', index: 0 };
  const stack: Frame[] = [root];
  const top = () => stack[stack.length - 1]!;
  const inPre = () => stack.some((f) => f.tag === 'pre');
  const nl = (f: Frame) => {
    if (f.buf && !f.buf.endsWith('\n')) f.buf += '\n';
  };

  /** Wrap text in an inline marker, keeping surrounding spaces outside the marker. */
  const wrap = (t: string, mark: string) => {
    const core = t.trim();
    if (!core) return t;
    const lead = /^\s/.test(t) ? ' ' : '';
    const trail = /\s$/.test(t) ? ' ' : '';
    return `${lead}${mark}${core}${mark}${trail}`;
  };

  const close = (f: Frame) => {
    const parent = top();
    const t = f.buf;
    switch (f.tag) {
      case 'emoji':
      case 'attachment':
      case 'script':
      case 'style':
        break;
      case 'b':
      case 'strong':
        parent.buf += wrap(t, '**');
        break;
      case 'i':
      case 'em':
        parent.buf += wrap(t, '_');
        break;
      case 's':
      case 'strike':
      case 'del':
        parent.buf += wrap(t, '~~');
        break;
      case 'code':
        parent.buf += inPre() ? t : `\`${t}\``;
        break;
      case 'pre':
        nl(parent);
        parent.buf += `\`\`\`\n${t.replace(/^\n+|\n+$/g, '')}\n\`\`\`\n`;
        break;
      case 'a': {
        const href = f.a.href ?? '';
        const label = t.trim();
        if (!/^(https?:|mailto:)/i.test(href)) parent.buf += label;
        else if (!label || label === href) parent.buf += href;
        else parent.buf += `[${label}](${href})`;
        break;
      }
      case 'at': {
        const r = opts.mention?.(f.a.id ?? '', t.trim());
        parent.buf += r ?? `@${t.trim()}`;
        break;
      }
      case 'blockquote':
        nl(parent);
        parent.buf += `${t
          .trim()
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n')}\n`;
        break;
      case 'li': {
        const list = top();
        const marker = list.tag === 'ol' ? `${++list.index}. ` : '- ';
        nl(parent);
        parent.buf += `${marker}${t.trim().replace(/\n/g, '\n   ')}\n`;
        break;
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        nl(parent);
        parent.buf += `**${t.trim()}**\n`;
        break;
      case 'td':
      case 'th':
        parent.buf += `${t.trim()} | `;
        break;
      case 'tr':
        nl(parent);
        parent.buf += `${t.replace(/ \| $/, '')}\n`;
        break;
      default:
        if (BLOCK.has(f.tag)) {
          nl(parent);
          parent.buf += t;
          nl(parent);
        } else parent.buf += t;
    }
  };

  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|([^<]+|<)/g;
  for (const m of html.matchAll(re)) {
    const [, slash, rawTag, rawAttrs, text] = m;
    if (text !== undefined) {
      const decoded = decodeEntities(text);
      top().buf += inPre() ? decoded : decoded.replace(/\s+/g, ' ');
      continue;
    }
    if (!rawTag) continue; // comment
    const tag = rawTag.toLowerCase();
    if (slash) {
      const idx = stack.map((f) => f.tag).lastIndexOf(tag);
      if (idx <= 0) continue;
      while (stack.length > idx) close(stack.pop()!);
      continue;
    }
    const a = attrs(rawAttrs ?? '');
    if (tag === 'br') {
      top().buf += '\n';
    } else if (tag === 'hr') {
      nl(top());
      top().buf += '---\n';
    } else if (tag === 'img') {
      const src = a.src ?? '';
      const alt = a.alt ?? '';
      top().buf += opts.image ? opts.image(src, alt) : alt;
    } else if (tag === 'emoji') {
      top().buf += a.alt ?? '';
      if (!/\/\s*$/.test(rawAttrs ?? '')) stack.push({ tag, a, buf: '', index: 0 });
    } else if (!VOID.has(tag) && !/\/\s*$/.test(rawAttrs ?? '')) {
      stack.push({ tag, a, buf: '', index: 0 });
    }
  }
  while (stack.length > 1) close(stack.pop()!);
  // Tidy whitespace left by collapsing HTML spaces, except inside code blocks.
  let fence = false;
  const lines = root.buf.split('\n').map((line) => {
    if (line.startsWith('```')) fence = !fence;
    return fence ? line : line.replace(/^ (?! )/, '').replace(/[ \t]+$/, '');
  });
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
