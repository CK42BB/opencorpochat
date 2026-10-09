// SPDX-License-Identifier: AGPL-3.0-only
// Link previews from Open Graph / HTML meta tags, fetched server-side (no client IP leaks).
import { extractUrls, type LinkPreview } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { safeFetch } from '../../lib/safe-fetch.js';
import { publishMessage } from './service.js';

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();

function meta(html: string, keys: string[]) {
  for (const key of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i');
    const m = re1.exec(html) ?? re2.exec(html);
    if (m?.[1]) return decode(m[1]);
  }
  return '';
}

export async function fetchPreview(url: string): Promise<LinkPreview | null> {
  const res = await safeFetch(url);
  if (res.status >= 400 || !res.contentType.includes('html')) return null;
  const html = res.body.toString('utf8');
  const head = html.slice(0, 200_000);
  const title = meta(head, ['og:title', 'twitter:title']) || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ?? '');
  if (!title) return null;
  let image = meta(head, ['og:image', 'og:image:url', 'twitter:image']);
  try {
    image = image ? new URL(image, res.url).toString() : '';
    if (image && !image.startsWith('https://')) image = '';
  } catch {
    image = '';
  }
  return {
    url,
    title: title.slice(0, 200),
    description: meta(head, ['og:description', 'description', 'twitter:description']).slice(0, 400),
    siteName: (meta(head, ['og:site_name']) || new URL(res.url).hostname).slice(0, 100),
    imageUrl: image || null,
  };
}

export async function unfurlMessage(ctx: Ctx, messageId: string) {
  if (!ctx.settings.get().linkPreviews) return;
  const msg = await ctx.db.selectFrom('messages').selectAll().where('id', '=', messageId).executeTakeFirst();
  if (!msg || msg.deleted_at || msg.kind === 'system' || msg.previews) return;
  const urls = extractUrls(msg.body, 3).filter((u) => !u.startsWith(ctx.config.publicUrl));
  if (!urls.length) return;
  const previews: LinkPreview[] = [];
  for (const u of urls) {
    try {
      const p = await fetchPreview(u);
      if (p) previews.push(p);
    } catch (err) {
      ctx.log.debug({ err, url: u }, 'link preview failed');
    }
  }
  if (!previews.length) return;
  await ctx.db.updateTable('messages').set({ previews: JSON.stringify(previews) }).where('id', '=', messageId).execute();
  const updated = await ctx.db.selectFrom('messages').selectAll().where('id', '=', messageId).executeTakeFirstOrThrow();
  await publishMessage(ctx, updated, 'message.updated');
}
