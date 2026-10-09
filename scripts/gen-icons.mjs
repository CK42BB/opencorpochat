// SPDX-License-Identifier: AGPL-3.0-only
// Rasterizes the app mark to PNG without any image libraries (for PWA / iOS icons).
// Usage: node scripts/gen-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 4x4 supersampling for smooth edges.
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const [pr, pg, pb, pa] = pixel(
            ((x + (sx + 0.5) / 4) / size) * 64,
            ((y + (sy + 0.5) / 4) / size) * 64,
          );
          r += pr * pa;
          g += pg * pa;
          b += pb * pa;
          a += pa;
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0;
      raw[o + 1] = a ? g / a : 0;
      raw[o + 2] = a ? b / a : 0;
      raw[o + 3] = (a / 16) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const BRAND = [74, 58, 255],
  WHITE = [255, 255, 255];
function mark(x, y, full) {
  if (!full && !inRoundRect(x, y, 0, 0, 64, 64, 14)) return [0, 0, 0, 0];
  const bubble =
    inRoundRect(x, y, 14, 12, 50, 40, 6) ||
    (y >= 38 &&
      y <= 48 &&
      x >= 19 &&
      x <= 28 &&
      x - 19 <= (48 - y) * (9 / 10) + 0.5 &&
      y <= 40 + (28 - x) * (8 / 9));
  if (bubble) {
    for (const cx of [24, 32, 40]) if ((x - cx) ** 2 + (y - 26) ** 2 <= 9) return [...BRAND, 1];
    return [...WHITE, 1];
  }
  return [...BRAND, 1];
}
for (const size of [192, 512])
  writeFileSync(
    `apps/web/public/icon-${size}.png`,
    png(size, (x, y) => mark(x, y, size === 512)),
  );
console.log('icons written');
