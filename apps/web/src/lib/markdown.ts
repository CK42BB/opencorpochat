// SPDX-License-Identifier: AGPL-3.0-only
// Message rendering: a safe Markdown subset, mentions, channel links and custom emoji.
// Output is always sanitized with DOMPurify.
import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import csharp from 'highlight.js/lib/languages/csharp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import diff from 'highlight.js/lib/languages/diff';
import type { CustomEmoji, User, UserGroup } from '@ocpc/shared';

for (const [name, lang] of Object.entries({
  bash,
  css,
  go,
  java,
  javascript,
  json,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
  csharp,
  php,
  ruby,
  diff,
})) {
  hljs.registerLanguage(name, lang);
}
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export interface RenderContext {
  usersByName: Map<string, User>;
  groupsByHandle: Map<string, UserGroup>;
  channelsByName: Map<string, string>;
  emoji: Map<string, CustomEmoji>;
  meUsername: string;
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const language = lang && hljs.getLanguage(lang) ? lang : undefined;
      const html = language ? hljs.highlight(text, { language }).value : esc(text);
      return `<pre class="code"><code class="hljs${language ? ` language-${esc(language)}` : ''}">${html}</code></pre>`;
    },
    // Raw HTML is shown as text, never rendered.
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return esc(text);
    },
    heading({ tokens }: Tokens.Heading) {
      // Headings render as bold paragraphs so messages stay compact.
      return `<p><strong>${this.parser.parseInline(tokens)}</strong></p>`;
    },
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      if (!/^(https?:|mailto:|\/)/i.test(href)) return text;
      return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''} target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
    },
    image({ href, text }: Tokens.Image) {
      // Inline remote images are not loaded (privacy); render as a link.
      return /^https?:/i.test(href)
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(text || href)}</a>`
        : esc(text);
    },
  },
});

const MENTION_RE = /(^|[^\w@/])@([a-z0-9][a-z0-9._-]{0,31})(?![\w-])/gi;
const CHANNEL_RE = /(^|[^\w#&/])#([a-z0-9][a-z0-9_-]{0,79})(?![\w-])/gi;
const EMOJI_RE = /:([a-z0-9_+-]{1,64}):/g;

/** Decorate text nodes outside code/links with mention, channel and emoji markup. */
function decorate(root: HTMLElement, rc: RenderContext) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    if (n.parentElement?.closest('code, pre, a')) continue;
    if (/[@#:]/.test(n.data)) nodes.push(n);
  }
  for (const node of nodes) {
    let html = esc(node.data);
    html = html.replace(MENTION_RE, (whole, pre: string, raw: string) => {
      const name = raw.toLowerCase().replace(/[._-]+$/, '');
      const trail = raw.slice(name.length);
      if (['channel', 'here', 'everyone'].includes(name))
        return `${pre}<span class="mention mention-broadcast">@${name}</span>${trail}`;
      const u = rc.usersByName.get(name);
      if (u)
        return `${pre}<span class="mention${name === rc.meUsername ? ' mention-me' : ''}" data-user-id="${u.id}" role="button" tabindex="0">@${esc(u.displayName || u.username)}</span>${trail}`;
      const g = rc.groupsByHandle.get(name);
      if (g)
        return `${pre}<span class="mention mention-group" title="${esc(g.name)}">@${esc(g.handle)}</span>${trail}`;
      return whole;
    });
    html = html.replace(CHANNEL_RE, (whole, pre: string, name: string) => {
      const id = rc.channelsByName.get(name.toLowerCase());
      return id
        ? `${pre}<a class="channel-link" href="/c/${id}" data-channel-id="${id}">#${esc(name)}</a>`
        : whole;
    });
    html = html.replace(EMOJI_RE, (whole, name: string) => {
      const e = rc.emoji.get(name);
      return e
        ? `<img class="custom-emoji" src="${esc(e.url)}" alt=":${esc(name)}:" title=":${esc(name)}:" loading="lazy">`
        : whole;
    });
    if (html !== esc(node.data)) {
      const span = document.createElement('span');
      span.innerHTML = DOMPurify.sanitize(html, {
        ADD_ATTR: ['data-user-id', 'data-channel-id', 'tabindex', 'role'],
      });
      node.replaceWith(...Array.from(span.childNodes));
    }
  }
}

const cache = new Map<string, string>();

export function renderMarkdown(text: string, rc: RenderContext): string {
  const key = `${rc.meUsername}\u0000${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const raw = marked.parse(text, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'del',
      's',
      'code',
      'pre',
      'blockquote',
      'ul',
      'ol',
      'li',
      'a',
      'span',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'input',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'type', 'checked', 'disabled'],
  });
  const div = document.createElement('div');
  div.innerHTML = clean;
  decorate(div, rc);
  const out = div.innerHTML;
  if (cache.size > 2000) cache.clear();
  cache.set(key, out);
  return out;
}

/** True if a message is only emoji (rendered large). */
export function isJumboEmoji(text: string) {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  return (
    /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s|:[a-z0-9_+-]+:)+$/u.test(t) &&
    !/^[\d#*\s]+$/.test(t)
  );
}
