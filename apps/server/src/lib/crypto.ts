// SPDX-License-Identifier: AGPL-3.0-only
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

function scrypt(pw: string, salt: Buffer, len: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Hash a password with scrypt. Format: scrypt$N$r$p$salt$hash (base64url). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: 128 * N * R * 2,
  });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(
  pw: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) {
    // Spend comparable time to avoid user enumeration by timing.
    await hashPassword(pw);
    return false;
  }
  const [alg, n, r, p, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const nN = Number(n);
  const nR = Number(r);
  const key = await scrypt(
    pw.normalize('NFKC'),
    Buffer.from(saltB64, 'base64url'),
    expected.length,
    {
      N: nN,
      r: nR,
      p: Number(p),
      maxmem: 128 * nN * nR * 2,
    },
  );
  return timingSafeEqual(key, expected);
}

/** A random, URL-safe secret token. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored as SHA-256 hashes so a DB leak does not leak live credentials. */
export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(key: string, value: string, enc: 'hex' | 'base64url' = 'hex') {
  return createHmac('sha256', key).update(value).digest(enc);
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------- TOTP (RFC 6238) ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, timeMs = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = h[h.length - 1]! & 0xf;
  const bin = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return bin.toString().padStart(digits, '0');
}

/** Accept the current code and one step either side for clock drift. */
export function verifyTotp(secret: string, code: string, timeMs = Date.now()) {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => safeEqual(totpCode(secret, timeMs + w * 30_000), c));
}

export function generateRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(6)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

// ---------- Minimal HS256 JWT (used for LiveKit access tokens) ----------

export function signJwtHs256(payload: Record<string, unknown>, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
