// SPDX-License-Identifier: AGPL-3.0-only
// ULID generation: 48-bit ms timestamp + 80 random bits, Crockford base32, monotonic within a ms.
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(t: number) {
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function randomDigits(): number[] {
  const bytes = randomBytes(16);
  return Array.from({ length: 16 }, (_, i) => bytes[i]! % 32);
}

/** New ULID. With an explicit timestamp (e.g. imports) no monotonic adjustment is applied. */
export function ulid(at?: number): string {
  if (at !== undefined)
    return (
      encodeTime(at) +
      randomDigits()
        .map((d) => ALPHABET[d])
        .join('')
    );
  let now = Date.now();
  if (now <= lastTime) {
    // Same (or earlier, clock skew) millisecond: increment the random part to keep ordering.
    now = lastTime;
    let i = 15;
    while (i >= 0 && lastRandom[i] === 31) {
      lastRandom[i] = 0;
      i--;
    }
    if (i >= 0) lastRandom[i]!++;
  } else {
    lastTime = now;
    lastRandom = randomDigits();
  }
  return encodeTime(now) + lastRandom.map((d) => ALPHABET[d]).join('');
}

/** Smallest ULID for a timestamp — useful for "messages after time T" queries. */
export function ulidFloor(ms: number) {
  return encodeTime(ms) + '0'.repeat(16);
}

export function ulidTime(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}
