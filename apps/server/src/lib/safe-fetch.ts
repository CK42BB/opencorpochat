// SPDX-License-Identifier: AGPL-3.0-only
// Server-side fetch for untrusted URLs (link previews). Blocks private/loopback/link-local
// addresses at connect time (defeating DNS rebinding), limits size, time and redirects.
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224 ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return (
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    v.startsWith('fe8') ||
    v.startsWith('fe9') ||
    v.startsWith('fea') ||
    v.startsWith('feb') ||
    v.startsWith('ff')
  );
}

const safeLookup: typeof dnsLookup = ((hostname: string, options: unknown, cb: unknown) => {
  const callback = (typeof options === 'function' ? options : cb) as (
    err: Error | null,
    address?: unknown,
    family?: number,
  ) => void;
  const opts = typeof options === 'object' && options ? (options as object) : {};
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as unknown as { address: string; family: number }[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) return callback(new Error(`Blocked address for ${hostname}`));
    if ((opts as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}) as typeof dnsLookup;

export interface SafeResponse {
  status: number;
  url: string;
  contentType: string;
  body: Buffer;
}

export async function safeFetch(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; accept?: string } = {},
): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const timeoutMs = opts.timeoutMs ?? 5000;
  let current = new URL(url);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:')
      throw new Error('Unsupported protocol');
    if (
      net.isIP(current.hostname.replace(/^\[|\]$/g, '')) &&
      isPrivateAddress(current.hostname.replace(/^\[|\]$/g, ''))
    ) {
      throw new Error('Blocked address');
    }
    const res = await new Promise<SafeResponse | { redirect: string }>((resolve, reject) => {
      const mod = current.protocol === 'https:' ? https : http;
      const req = mod.get(
        current,
        {
          lookup: safeLookup,
          timeout: timeoutMs,
          headers: {
            'user-agent': 'OpenCorpoChat-LinkPreview/1.0',
            accept: opts.accept ?? 'text/html,*/*;q=0.5',
          },
        },
        (r) => {
          const status = r.statusCode ?? 0;
          if (status >= 300 && status < 400 && r.headers.location) {
            r.resume();
            return resolve({ redirect: new URL(r.headers.location, current).toString() });
          }
          const chunks: Buffer[] = [];
          let size = 0;
          r.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              r.destroy();
              resolve({
                status,
                url: current.toString(),
                contentType: String(r.headers['content-type'] ?? ''),
                body: Buffer.concat(chunks),
              });
              return;
            }
            chunks.push(c);
          });
          r.on('end', () =>
            resolve({
              status,
              url: current.toString(),
              contentType: String(r.headers['content-type'] ?? ''),
              body: Buffer.concat(chunks),
            }),
          );
          r.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', reject);
    });
    if ('redirect' in res) {
      current = new URL(res.redirect);
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

/** POST JSON to a trusted (admin-configured) integration URL. */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 5000,
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'OpenCorpoChat/1.0', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { text };
  }
  return { status: res.status, data };
}
